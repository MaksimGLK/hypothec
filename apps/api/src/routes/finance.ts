import {
  Account,
  BankScheduleUploadRequest,
  CreateAccountRequest,
  CreateExpenseRequest,
  CreateIncomeRequest,
  CreateLivingExpenseRequest,
  CreateLoanRequest,
  Expense,
  Income,
  LivingExpense,
  Loan,
  MarkTransferDoneRequest,
  ParseIncomeRequest,
  UpdateAccountRequest,
  UpdateExpenseRequest,
  UpdateIncomeRequest,
  UpdateLivingExpenseRequest,
  UpdateLoanRequest,
} from '@hypothec/api-contract';
import { buildSchedule, parseBankScheduleCsv, parseIncomeQuickInput, reconcileWithBank, type BankScheduleRow } from '@hypothec/core';
import { and, eq, sql } from 'drizzle-orm';
import type { GoalStep } from '@hypothec/core';
import type { DbOrTx } from '../db/client.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { todayInMoscow } from '../config.js';
import * as s from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { settingsOf, toLoanInput } from '../services/plan.js';
import { assertOwned, IdParams, mutate, registerCrud, stripNulls } from './helpers.js';

const SYSTEM_ACCOUNT_KINDS = new Set(['mortgage', 'cushion', 'setup', 'prepayment', 'life', 'annual_reserve', 'deal']);

export const financeRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = app.deps;
  const { db } = deps;

  registerCrud(app, {
    path: 'expenses',
    entity: 'expense',
    title: 'Расход',
    table: s.expenses,
    dto: Expense,
    create: CreateExpenseRequest,
    update: UpdateExpenseRequest,
    validate: async (tx, hid, v) => {
      await assertOwned(tx, s.stages, v.stageId as string | null, hid, 'Этап');
      await assertOwned(tx, s.loans, v.loanId as string | null, hid, 'Кредит');
    },
  });

  registerCrud(app, {
    path: 'living-expenses',
    entity: 'living',
    title: 'Категория бюджета',
    table: s.livingExpenses,
    dto: LivingExpense,
    create: CreateLivingExpenseRequest,
    update: UpdateLivingExpenseRequest,
    orderBy: s.livingExpenses.sort,
    toDto: (row) => {
      const { autoPayLastMonth: _m, ...rest } = row;
      return stripNulls(rest);
    },
    validate: async (tx, hid, v, existing) => {
      // включили автоплатёж (или сменили день) — начинаем с текущего месяца заново
      if (v.autoPayDay !== undefined && (!existing || v.autoPayDay !== existing.autoPayDay)) v.autoPayLastMonth = null;
    },
  });

  registerCrud(app, {
    path: 'incomes',
    entity: 'income',
    title: 'Доход',
    table: s.incomes,
    dto: Income,
    create: CreateIncomeRequest,
    update: UpdateIncomeRequest,
    validate: async (tx, hid, v, existing) => {
      await assertOwned(tx, s.householdMembers, v.memberId as string | null, hid, 'Участник');
      // при изменении суммы стабильного дохода запоминаем прежнюю — для рекомендации «доход вырос»
      if (existing && v.amountKop !== undefined && v.amountKop !== existing.amountKop && v.previousAmountKop === undefined) {
        v.previousAmountKop = existing.amountKop;
        v.changedAt = todayInMoscow(deps.now());
      }
    },
  });

  registerCrud(app, {
    path: 'accounts',
    entity: 'account',
    title: 'Счёт',
    table: s.accounts,
    dto: Account,
    create: CreateAccountRequest,
    update: UpdateAccountRequest,
    orderBy: s.accounts.sort,
    canDelete: (row) => (SYSTEM_ACCOUNT_KINDS.has(String(row.kind)) ? 'Основные счета удалить нельзя — их можно не использовать' : null),
    // своя цель сразу встаёт в порядок распределения — перед досрочкой
    afterCreate: (tx, hid, row) => updateSteps(tx, hid, (steps) => {
      const i = steps.findIndex((x) => x.target === 'prepayment');
      const step: GoalStep = { target: 'custom', accountId: String(row.id), sources: 'any', enabled: true };
      return i < 0 ? [...steps, step] : [...steps.slice(0, i), step, ...steps.slice(i)];
    }),
    beforeDelete: (tx, hid, row) => updateSteps(tx, hid, (steps) => steps.filter((x) => x.accountId !== row.id)),
  });

  registerCrud(app, {
    path: 'loans',
    entity: 'loan',
    title: 'Кредит',
    table: s.loans,
    dto: Loan,
    create: CreateLoanRequest,
    update: UpdateLoanRequest,
    toDto: (row) => {
      const { bankSchedule: _bs, ...rest } = row;
      return stripNulls(rest);
    },
    validate: async (_tx, _hid, v, existing) => {
      // проверяем, что график строится: ошибки параметров видны сразу, а не при пересчёте плана
      const merged = { ...(existing ?? {}), ...v } as typeof s.loans.$inferSelect;
      try {
        buildSchedule(toLoanInput({ ...merged, id: 'check', rateChanges: merged.rateChanges ?? [] }));
      } catch (e) {
        throw new AppError('validation_error', `Не получается построить график: ${(e as Error).message}`);
      }
    },
  });

  app.post(
    '/incomes/parse',
    { schema: { tags: ['income'], summary: 'Разобрать доход из строки «Премия 110 000 каждый месяц 15-го»', body: ParseIncomeRequest } },
    async (req) => parseIncomeQuickInput(req.body.text, todayInMoscow(deps.now())),
  );

  // ── отметка «перевёл» в календаре распределения ──
  app.get('/transfers/done', { schema: { tags: ['allocation'], summary: 'Отмеченные переводы', querystring: z.object({ from: z.string(), to: z.string() }) } }, async (req) => {
    const rows = await db.select().from(s.transfersDone).where(eq(s.transfersDone.householdId, req.household.id));
    return rows.filter((r) => r.date >= req.query.from && r.date <= req.query.to).map((r) => ({ date: r.date, incomeId: r.incomeId, accountId: r.accountId, amountKop: r.amountKop }));
  });

  app.post('/transfers/done', { schema: { tags: ['allocation'], summary: 'Отметить перевод выполненным', body: MarkTransferDoneRequest } }, async (req, reply) => {
    const { date, incomeId, accountId, amountKop } = req.body;
    await mutate(req, 'transfer', 'done', async (tx) => {
      await assertOwned(tx, s.incomes, incomeId, req.household.id, 'Доход');
      const [acc] = await tx.select().from(s.accounts).where(and(eq(s.accounts.id, accountId), eq(s.accounts.householdId, req.household.id)));
      if (!acc) throw notFound('Счёт');
      // только отметка в чек-листе: остатки счетов пользователь вводит сам, как в банковском приложении
      await tx
        .insert(s.transfersDone)
        .values({ householdId: req.household.id, date, incomeId, accountId, amountKop, doneBy: req.user.id })
        .onConflictDoNothing();
    });
    reply.code(204);
  });

  // ── график из банка ──
  app.post(
    '/loans/:id/bank-schedule',
    { bodyLimit: 3_000_000, schema: { tags: ['loan'], summary: 'Загрузить график платежей из банка (CSV)', params: IdParams, body: BankScheduleUploadRequest } },
    async (req) => {
      const parsed = parseBankScheduleCsv(req.body.csv);
      if (parsed.rows.length === 0) throw new AppError('validation_error', 'В файле не нашлось строк графика', parsed.errors);
      await mutate(req, 'loan', 'bank_schedule', async (tx) => {
        const rows = await tx
          .update(s.loans)
          .set({ bankSchedule: parsed.rows })
          .where(and(eq(s.loans.id, req.params.id), eq(s.loans.householdId, req.household.id)))
          .returning({ id: s.loans.id });
        if (!rows.length) throw notFound('Кредит');
        return rows[0]!;
      });
      return { imported: parsed.rows.length, errors: parsed.errors };
    },
  );

  app.get('/loans/:id/bank-schedule/diff', { schema: { tags: ['loan'], summary: 'Сверка графика банка с расчётным', params: IdParams } }, async (req) => {
    const [loan] = await db.select().from(s.loans).where(and(eq(s.loans.id, req.params.id), eq(s.loans.householdId, req.household.id)));
    if (!loan) throw notFound('Кредит');
    if (!loan.bankSchedule) throw new AppError('not_found', 'График банка ещё не загружен');
    return reconcileWithBank(loan.bankSchedule as BankScheduleRow[], buildSchedule(toLoanInput(loan)));
  });
};

async function updateSteps(tx: DbOrTx, householdId: string, fn: (steps: GoalStep[]) => GoalStep[]) {
  const [h] = await tx.select().from(s.households).where(eq(s.households.id, householdId)).limit(1);
  const settings = settingsOf(h!);
  settings.allocation.steps = fn(settings.allocation.steps);
  await tx.update(s.households).set({ settings, settingsVersion: sql`${s.households.settingsVersion} + 1` }).where(eq(s.households.id, householdId));
}
