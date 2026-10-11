import { CalendarQuery, IsoDate, Prepayment, StressTestRequest } from '@hypothec/api-contract';
import { addMonths, buildCalendar, buildPlan, buildSchedule, expandExpenses, expandIncomes, stressTest, type CalendarEvent, type PlanInput, type PlanResult } from '@hypothec/core';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as s from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { getPlan, loadPlanInput } from '../services/plan.js';
import { applyDuePrepayments } from '../services/prepayment-execution.js';
import { IdParams } from './helpers.js';

const MAX_RANGE_DAYS = 3 * 366;

function checkRange(from: string, to: string) {
  if (to < from) throw new AppError('validation_error', 'Конец периода раньше начала');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) throw new AppError('validation_error', 'Период — не больше трёх лет');
}

function toIcs(events: CalendarEvent[], name: string): string {
  const esc = (v: string) => v.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//hypothec//planner//RU', `X-WR-CALNAME:${esc(name)}`, 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    const d = e.date.replace(/-/g, '');
    const amount = e.amountKop ? ` — ${Math.round(e.amountKop / 100).toLocaleString('ru-RU')} ₽` : '';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@hypothec`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${esc(e.title + amount)}`,
      ...(e.details ? [`DESCRIPTION:${esc(e.details)}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export const planRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = app.deps;
  const tags = ['plan'];

  app.get('/dashboard', { schema: { tags, summary: 'Главный экран одним запросом' } }, async (req, reply) => {
    await applyDuePrepayments(deps, req.household.id);
    const { plan, revision } = await getPlan(deps, req.household.id);
    reply.header('x-household-revision', String(revision));
    return {
      today: plan.today,
      revision,
      ...plan.dashboard,
      loans: plan.loans.map((l) => ({
        loanId: l.loanId,
        name: l.name,
        currentBalanceKop: l.currentBalanceKop,
        nextPayment: l.nextPayment,
        payoffDate: l.schedule.summary.payoffDate,
        savingsKop: l.savingsKop,
        monthsSaved: l.monthsSaved,
      })),
      warnings: plan.allocation.warnings,
    };
  });

  /** Полный план. ETag = ревизия семьи + дата: клиент может не перекачивать неизменившийся план. */
  app.get('/projection', { schema: { tags, summary: 'Полный пересчитанный план' } }, async (req, reply) => {
    const { plan, revision } = await getPlan(deps, req.household.id);
    const etag = `W/"${revision}-${plan.today}"`;
    reply.header('etag', etag);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return { revision, ...plan, loans: plan.loans.map((l) => ({ ...l, baseline: { summary: l.baseline.summary } })) };
  });

  app.get(
    '/loans/:id/schedule',
    { schema: { tags, summary: 'График платежей (по активному или выбранному сценарию)', params: IdParams, querystring: z.object({ scenarioId: z.uuid().optional() }) } },
    async (req) => {
      const { input } = await loadPlanInput(deps, req.household.id);
      const loan = input.loans.find((l) => l.id === req.params.id);
      if (!loan) throw notFound('Кредит');
      const sc = req.query.scenarioId ? input.prepaymentScenarios.find((x) => x.id === req.query.scenarioId) : input.prepaymentScenarios.find((x) => x.isActive);
      if (req.query.scenarioId && !sc) throw notFound('Сценарий');
      const schedule = buildSchedule(loan, sc?.prepayments ?? []);
      const baseline = buildSchedule(loan, []);
      return { ...schedule, baseline: baseline.summary, scenarioId: sc?.id ?? null };
    },
  );

  app.get('/allocation-calendar', { schema: { tags, summary: 'Календарь распределения: сколько и на какой счёт перевести', querystring: CalendarQuery } }, async (req) => {
    checkRange(req.query.from, req.query.to);
    const { plan } = await getPlan(deps, req.household.id);
    const done = await deps.db.select().from(s.transfersDone).where(eq(s.transfersDone.householdId, req.household.id));
    const isDone = (date: string, incomeId: string, accountId: string) => done.some((d) => d.date === date && d.incomeId === incomeId && d.accountId === accountId);
    return {
      transfers: plan.allocation.transfers
        .filter((t) => t.date >= req.query.from && t.date <= req.query.to)
        .map((t) => ({ ...t, lines: t.lines.map((l) => ({ ...l, done: isDone(t.date, t.incomeId, l.accountId) })) })),
      deficits: plan.allocation.deficits.filter((d) => d.date >= req.query.from && d.date <= req.query.to),
      monthlyBalances: plan.allocation.monthlyBalances.filter((m) => m.month >= req.query.from.slice(0, 7) && m.month <= req.query.to.slice(0, 7)),
      goals: plan.allocation.goals,
      warnings: plan.allocation.warnings,
    };
  });

  app.get('/cushion', { schema: { tags, summary: 'Подушка безопасности' } }, async (req) => (await getPlan(deps, req.household.id)).plan.cushion);

  app.post('/stress-test', { schema: { tags, summary: 'Что будет, если пропадёт доход', body: StressTestRequest } }, async (req) => {
    const { plan, input } = await getPlan(deps, req.household.id);
    for (const id of req.body.removeIncomeIds) if (!input.incomes.some((i) => i.id === id)) throw notFound('Доход');
    const incomeEvents = expandIncomes(input.incomes, plan.today, addMonths(plan.today, req.body.months + 1), { keysDate: plan.keysDate });
    return stressTest({
      today: plan.today,
      months: req.body.months,
      incomeEvents,
      obligations: plan.allocation.obligations,
      removeIncomeIds: req.body.removeIncomeIds,
      cushionKop: plan.cushion.currentKop,
    });
  });

  app.get('/tax-deductions', { schema: { tags, summary: 'Налоговые вычеты по каждому супругу' } }, async (req) => (await getPlan(deps, req.household.id)).plan.tax);

  app.get('/calendar', { schema: { tags, summary: 'Единый календарь событий', querystring: CalendarQuery } }, async (req) => {
    checkRange(req.query.from, req.query.to);
    const { plan, input } = await getPlan(deps, req.household.id);
    return calendarFor(plan, input, req.query.from, req.query.to);
  });

  app.get('/calendar.ics', { schema: { tags, summary: 'Календарь в формате iCalendar на год вперёд' } }, async (req, reply) => {
    const { plan, input } = await getPlan(deps, req.household.id);
    const to = `${Number(plan.today.slice(0, 4)) + 1}${plan.today.slice(4)}`;
    const events = calendarFor(plan, input, plan.today, to).filter((e) => e.type !== 'income');
    reply.header('content-type', 'text/calendar; charset=utf-8').header('content-disposition', 'attachment; filename="hypothec.ics"');
    return toIcs(events, 'Ипотечный план');
  });

  /**
   * «Что если»: пересчёт без сохранения. Те же расчёты делает и клиент локально через ядро —
   * эндпоинт нужен для клиентов, которые не хотят тянуть ядро.
   */
  app.post(
    '/what-if',
    {
      schema: {
        tags,
        summary: 'Пересчёт плана без сохранения',
        body: z.object({
          activePrepayments: z.array(Prepayment.omit({ version: true })).max(200).optional(),
          keysDate: IsoDate.nullable().optional(),
          removeIncomeIds: z.array(z.uuid()).optional(),
        }),
      },
    },
    async (req) => {
      const { input } = await loadPlanInput(deps, req.household.id);
      const b = req.body;
      const patched = {
        ...input,
        scenario: b.keysDate !== undefined ? { ...input.scenario, keysDate: b.keysDate } : input.scenario,
        incomes: b.removeIncomeIds ? input.incomes.filter((i) => !b.removeIncomeIds!.includes(i.id)) : input.incomes,
        prepaymentScenarios: b.activePrepayments
          ? [{ id: 'what-if', name: 'Что если', isActive: true, prepayments: b.activePrepayments.map((p) => ({ ...p, date: p.date, startDate: p.startDate, endDate: p.endDate })) }]
          : input.prepaymentScenarios,
      };
      const plan = buildPlan(patched);
      return { dashboard: plan.dashboard, loans: plan.loans.map((l) => ({ loanId: l.loanId, summary: l.schedule.summary, savingsKop: l.savingsKop, monthsSaved: l.monthsSaved })), cushion: plan.cushion };
    },
  );
};

/** Календарь за произвольный период: в плане он посчитан только на 12 месяцев вперёд. */
function calendarFor(plan: PlanResult, input: PlanInput, from: string, to: string) {
  const loans = plan.loans;
  const active = input.prepaymentScenarios.find((x) => x.isActive)?.prepayments ?? [];
  const balanceAt = (loanId: string, date: string) => {
    const l = loans.find((x) => x.loanId === loanId);
    if (!l) return 0;
    let b = input.loans.find((x) => x.id === loanId)?.principalKop ?? 0;
    for (const r of l.schedule.rows) {
      if (r.date > date) break;
      b = r.balanceKop;
    }
    return b;
  };
  return buildCalendar({
    from,
    to,
    loans: input.loans,
    schedules: loans.map((l) => l.schedule),
    prepayments: active,
    incomeEvents: expandIncomes(input.incomes, from, to, { keysDate: plan.keysDate }),
    transfers: plan.allocation.transfers,
    stages: input.stages,
    expenseOccurrences: expandExpenses(input.expenses, from, to, {
      keysDate: plan.keysDate,
      loanPayoff: Object.fromEntries(loans.map((l) => [l.loanId, l.schedule.summary.payoffDate])),
      loanBalanceAt: balanceAt,
    }),
    tax: plan.tax,
  });
}

