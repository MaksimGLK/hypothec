import { beforeAll, describe, expect, it } from 'vitest';
import { client, register, setupApp, WIZARD, type Session } from './helpers.js';

const ctx = setupApp();

describe('путь семьи: мастер → доходы → план', () => {
  let s: Session;
  let api: ReturnType<typeof client>;
  let hid: string;
  let loanId: string;
  const path = (p: string) => `/households/${hid}${p}`;

  beforeAll(async () => {
    s = await register(ctx);
    api = client(ctx, s.token);
    hid = s.householdId;
  });

  it('мастер собирает сценарий, этапы с документами, расходы и кредит', async () => {
    const res = await api('POST', path('/wizard'), WIZARD);
    expect(res.statusCode, res.body).toBe(200);
    loanId = res.data.loanId;
    expect(res.data.scenario).toMatchObject({ housingType: 'secondary', priceKop: 900_000_000 });
    const keys = res.data.stages.map((x: { templateKey: string }) => x.templateKey);
    expect(keys).toEqual(expect.arrayContaining(['bank_approval', 'property_check', 'appraisal', 'registration', 'tax_deduction']));
    expect(res.data.stages[0].documents.length).toBeGreaterThan(0);

    const loans = await api('GET', path('/loans'));
    expect(loans.data).toHaveLength(1);
    expect(loans.data[0]).toMatchObject({ principalKop: 700_000_000, annualRate: '16', termMonths: 240 });
    const expenses = await api('GET', path('/expenses'));
    const insurance = expenses.data.find((e: { catalogKey: string }) => e.catalogKey === 'property_insurance');
    expect(insurance).toMatchObject({ recurrence: 'yearly', loanId, percentOfLoanBalance: '0.15' });
  });

  it('повторный запуск мастера не плодит дубли и не трогает свои этапы', async () => {
    await api('POST', path('/stages'), { title: 'Купить шторы', plannedDate: '2027-01-10' });
    await api('POST', path('/wizard'), { ...WIZARD, priceKop: 950_000_000 });
    const stages = (await api('GET', path('/stages'))).data;
    expect(stages.filter((x: { templateKey: string }) => x.templateKey === 'bank_approval')).toHaveLength(1);
    expect(stages.some((x: { title: string }) => x.title === 'Купить шторы')).toBe(true);
    expect((await api('GET', path('/loans'))).data).toHaveLength(1);
    expect((await api('GET', path('/loans'))).data[0].principalKop).toBe(750_000_000);
  });

  it('быстрый ввод дохода одной строкой → черновик → сохранение', async () => {
    const parsed = await api('POST', path('/incomes/parse'), { text: 'Зарплата Ивана 250 000 каждый месяц 10-го' });
    expect(parsed.data.draft).toMatchObject({ type: 'salary', amountKop: 25_000_000, dayOfMonth: 10, reliability: 'stable' });
    const created = await api('POST', path('/incomes'), parsed.data.draft);
    expect(created.statusCode, created.body).toBe(201);
    await api('POST', path('/incomes'), { name: 'Зарплата Марии', type: 'salary', amountKop: 15_000_000, periodicity: 'monthly', dayOfMonth: 25, reliability: 'stable' });
    await api('POST', path('/incomes'), { name: 'Премия', type: 'bonus', amountKop: 30_000_000, periodicity: 'quarterly', date: '2026-12-20', reliability: 'unstable' });
    await api('POST', path('/living-expenses'), { name: 'Базовые траты', amountKop: 12_000_000 });
  });

  it('главный экран: следующий платёж, подушка, цели, этапы, рекомендации', async () => {
    const d = await api('GET', path('/dashboard'));
    expect(d.statusCode, d.body).toBe(200);
    expect(d.data.today).toBe('2026-10-08');
    expect(d.data.nextPayment.amountKop).toBeGreaterThan(10_000_000);
    expect(d.data.cushion.targetMonths).toBe(6);
    expect(d.data.upcomingStages).toHaveLength(3);
    expect(d.data.recommendations.length).toBeGreaterThan(0);
    // подушки нет — первая рекомендация про неё
    expect(d.data.recommendations[0].ruleKey).toBe('cushion_low');
    expect(d.data.recommendations[0].explanation.facts).toHaveProperty('cushionMonths');
  });

  it('полный план с ETag: неизменившийся план не перекачивается', async () => {
    const p = await api('GET', path('/projection'));
    expect(p.statusCode).toBe(200);
    const etag = p.headers.etag as string;
    expect((await api('GET', path('/projection'), undefined, { 'if-none-match': etag })).statusCode).toBe(304);
    await api('POST', path('/living-expenses'), { name: 'Транспорт', amountKop: 1_000_000 });
    expect((await api('GET', path('/projection'), undefined, { 'if-none-match': etag })).statusCode).toBe(200);
  });

  it('календарь распределения: к дате платежа на ипотечном счёте нужная сумма; отметка «перевёл»', async () => {
    // кредит выдаётся в дату подписания (декабрь) — ипотечные переводы начинаются перед первым платежом
    const r = await api('GET', path('/allocation-calendar?from=2026-10-08&to=2027-03-31'));
    expect(r.statusCode, r.body).toBe(200);
    const hasMortgage = (t: { lines: { accountKind: string }[] }) => t.lines.some((l) => l.accountKind === 'mortgage');
    const first = r.data.transfers.find(hasMortgage);
    const mortgageLine = first.lines.find((l: { accountKind: string }) => l.accountKind === 'mortgage');
    expect(mortgageLine.done).toBe(false);
    expect((await api('POST', path('/transfers/done'), { date: first.date, incomeId: first.incomeId, accountId: mortgageLine.accountId, amountKop: mortgageLine.amountKop })).statusCode).toBe(204);
    const again = await api('GET', path('/allocation-calendar?from=2026-10-08&to=2027-03-31'));
    expect(again.data.transfers.find(hasMortgage).lines.find((l: { accountKind: string }) => l.accountKind === 'mortgage').done).toBe(true);
    // премия (нестабильная) не идёт на ипотеку
    const bonus = r.data.transfers.find((t: { incomeName: string }) => t.incomeName === 'Премия');
    expect(bonus.lines.every((l: { purpose: string }) => l.purpose !== 'obligation')).toBe(true);
  });

  it('досрочка: сценарии, сравнение, «сейчас или через 5 лет», основной сценарий меняет план', async () => {
    const scenarios = await api('GET', path('/prepayment-scenarios'));
    const main = scenarios.data.find((x: { isActive: boolean }) => x.isActive);
    const alt = await api('POST', path('/prepayment-scenarios'), { name: 'Миллион сразу' });
    const added = await api('POST', path(`/prepayment-scenarios/${alt.data.id}/prepayments`), { loanId, kind: 'one_off', amountKop: 100_000_000, date: '2027-01-15', mode: 'reduce_term' });
    expect(added.statusCode, added.body).toBe(201);
    const monthly = await api('POST', path('/prepayment-scenarios'), { name: '20 тыс. в месяц' });
    await api('POST', path(`/prepayment-scenarios/${monthly.data.id}/prepayments`), { loanId, kind: 'monthly', amountKop: 2_000_000, startDate: '2026-11-01', mode: 'reduce_payment_keep_amount' });

    const cmp = await api('POST', path('/prepayment-scenarios/compare'), { loanId, scenarioIds: [main.id, alt.data.id, monthly.data.id] });
    expect(cmp.statusCode, cmp.body).toBe(200);
    expect(cmp.data.scenarios).toHaveLength(3);
    expect(cmp.data.scenarios[1].savingsKop).toBeGreaterThan(0);
    expect(cmp.data.scenarios[1].balances.length).toBeLessThan(cmp.data.baseline.balances.length);

    const timing = await api('POST', path('/prepayment-timing'), { loanId, amountKop: 100_000_000, dates: ['2027-01-15', '2032-01-15'] });
    expect(timing.data[0].savingsKop).toBeGreaterThan(timing.data[1].savingsKop);

    const before = (await api('GET', path('/dashboard'))).data.payoff;
    await api('PATCH', path(`/prepayment-scenarios/${alt.data.id}`), { isActive: true, version: alt.data.version });
    const after = (await api('GET', path('/dashboard'))).data.payoff;
    expect(after.savingsKop).toBeGreaterThan(before.savingsKop);
    expect(after.date < before.date).toBe(true);
    const all = (await api('GET', path('/prepayment-scenarios'))).data;
    expect(all.filter((x: { isActive: boolean }) => x.isActive)).toHaveLength(1);
  });

  it('график платежей кредита по выбранному сценарию', async () => {
    const r = await api('GET', path(`/loans/${loanId}/schedule`));
    expect(r.data.rows.length).toBeGreaterThan(100);
    expect(r.data.baseline.totalInterestKop).toBeGreaterThan(r.data.summary.totalInterestKop);
  });

  it('параметры кредита, по которым график не строится, отклоняются сразу', async () => {
    const loan = (await api('GET', path('/loans'))).data[0];
    const bad = await api('PATCH', path(`/loans/${loan.id}`), { termMonths: 0, version: loan.version });
    expect(bad.statusCode).toBe(400);
  });

  it('стресс-тест: без зарплаты Ивана', async () => {
    const incomes = (await api('GET', path('/incomes'))).data;
    const ivan = incomes.find((i: { name: string }) => i.name.startsWith('Зарплата Ивана'));
    const r = await api('POST', path('/stress-test'), { removeIncomeIds: [ivan.id], months: 12 });
    expect(r.statusCode, r.body).toBe(200);
    // одной зарплаты Марии не хватает, как только начинаются платежи по кредиту
    expect(r.data.firstDeficitMonth).not.toBeNull();
    expect(r.data.monthlyGapKop).toBeGreaterThan(0);
    expect(r.data.months).toHaveLength(12);
  });

  it('«что если»: сдвиг ключей и досрочка без сохранения', async () => {
    const rev = (await api('GET', path(''))).data.revision;
    const r = await api('POST', path('/what-if'), {
      activePrepayments: [{ id: 'x', loanId, kind: 'one_off', amountKop: 300_000_000, date: '2027-01-15', mode: 'reduce_term' }],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.data.loans[0].savingsKop).toBeGreaterThan(0);
    expect((await api('GET', path(''))).data.revision).toBe(rev);
  });

  it('вычеты: данные супругов → расчёт → направить в досрочку', async () => {
    const members = (await api('GET', path('/members'))).data;
    const tm = await api('GET', path('/tax-members'));
    const saved = await api('PUT', path('/tax-members'), {
      version: tm.data.version,
      members: [
        {
          memberId: members[0].id,
          name: 'Иван',
          annualTaxableIncomeKop: 300_000_000,
          ndflRatePercent: '13',
          propertyDeductionUsedKop: 0,
          interestDeductionUsed: false,
          costSharePercent: '100',
          interestSharePercent: '100',
          claimed: false,
        },
      ],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    // без даты ключей права ещё нет; ставим дату ключей через этап «Ключи и переезд»
    const stages = (await api('GET', path('/stages'))).data;
    const moveIn = stages.find((x: { templateKey: string }) => x.templateKey === 'move_in');
    const done = await api('PATCH', path(`/stages/${moveIn.id}`), { status: 'done', actualDate: '2027-02-01', version: moveIn.version });
    expect(done.statusCode, done.body).toBe(200);
    expect((await api('GET', path('/scenario'))).data.keysDate).toBe('2027-02-01');

    const tax = await api('GET', path('/tax-deductions'));
    expect(tax.data.members[0].propertyRefundTotalKop).toBe(26_000_000);
    const sc = (await api('GET', path('/prepayment-scenarios'))).data.find((x: { isActive: boolean }) => x.isActive);
    const res = await api('POST', path('/prepayment-scenarios/from-tax'), { scenarioId: sc.id, loanId });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.data.prepayments.filter((p: { source: string }) => p.source === 'tax_refund').length).toBeGreaterThan(0);
  });

  it('рекомендации: отложить, вернуть, применить действие в отдельном сценарии', async () => {
    const list = await api('GET', path('/recommendations'));
    const cushion = list.data.items.find((r: { ruleKey: string }) => r.ruleKey === 'cushion_low');
    expect(cushion).toBeDefined();
    expect((await api('PUT', path('/recommendations/cushion_low/state'), { status: 'snoozed', until: '2026-11-01' })).statusCode).toBe(204);
    expect((await api('GET', path('/recommendations'))).data.items.some((r: { ruleKey: string }) => r.ruleKey === 'cushion_low')).toBe(false);
    await api('DELETE', path('/recommendations/cushion_low/state'));
    expect((await api('GET', path('/recommendations'))).data.items.some((r: { ruleKey: string }) => r.ruleKey === 'cushion_low')).toBe(true);

    const tax = (await api('GET', path('/recommendations'))).data.items.find((r: { ruleKey: string }) => r.ruleKey === 'tax_deduction_unclaimed');
    expect(tax).toBeDefined();
    const applied = await api('POST', path('/recommendations/tax_deduction_unclaimed/apply'), { patch: 'tax_to_prepayment' });
    expect(applied.statusCode, applied.body).toBe(200);
    const created = (await api('GET', path('/prepayment-scenarios'))).data.find((x: { id: string }) => x.id === applied.data.scenarioId);
    expect(created).toMatchObject({ name: 'Вычеты в досрочку', isActive: false });
    expect((await api('POST', path('/recommendations/tax_deduction_unclaimed/apply'), { patch: 'unknown' })).statusCode).toBe(400);
  });

  it('единый календарь и выгрузка .ics', async () => {
    const r = await api('GET', path('/calendar?from=2026-10-08&to=2027-03-31'));
    const types = new Set(r.data.map((e: { type: string }) => e.type));
    for (const t of ['loan_payment', 'income', 'transfer', 'stage', 'prepayment']) expect(types).toContain(t);
    expect((await api('GET', path('/calendar?from=2026-10-08&to=2032-01-01'))).statusCode).toBe(400);
    const ics = await api('GET', path('/calendar.ics'));
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.body).toContain('BEGIN:VEVENT');
  });

  it('импорт графика из банка (CSV) и сверка', async () => {
    const sched = (await api('GET', path(`/loans/${loanId}/schedule?scenarioId=${(await api('GET', path('/prepayment-scenarios'))).data.find((x: { name: string }) => x.name === 'Основной план').id}`))).data;
    const rows = sched.rows.slice(0, 3) as { date: string; paymentKop: number; interestKop: number; principalKop: number; balanceKop: number }[];
    const rub = (k: number) => (k / 100).toFixed(2).replace('.', ',');
    const csv = ['Дата;Сумма платежа;Проценты;Основной долг;Остаток', ...rows.map((x) => [x.date.split('-').reverse().join('.'), rub(x.paymentKop), rub(x.interestKop), rub(x.principalKop), rub(x.balanceKop)].join(';'))].join('\n');
    const up = await api('POST', path(`/loans/${loanId}/bank-schedule`), { csv });
    expect(up.data.imported).toBe(3);
    const diff = await api('GET', path(`/loans/${loanId}/bank-schedule/diff`));
    expect(diff.data.mismatched).toBe(0);
  });
});

describe('досрочка в свой день', () => {
  it('списывается со счёта «Досрочка», ждёт подтверждения; «сумма другая» и «не вносил» пересчитывают остаток и график', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    // кредит выдан раньше, чтобы досрочка была в прошлом относительно «сегодня» (8 октября)
    const loan = (await api('POST', p('/loans'), { name: 'Ипотека', principalKop: 500_000_000, annualRate: '16', termMonths: 240, type: 'annuity', issueDate: '2026-06-15' })).data;
    const accounts = (await api('GET', p('/accounts'))).data;
    const prepayAcc = accounts.find((a: { kind: string }) => a.kind === 'prepayment');
    await api('PATCH', p(`/accounts/${prepayAcc.id}`), { balanceKop: 8_000_000, version: prepayAcc.version });
    const sc = (await api('GET', p('/prepayment-scenarios'))).data.find((x: { isActive: boolean }) => x.isActive);
    const added = await api('POST', p(`/prepayment-scenarios/${sc.id}/prepayments`), { loanId: loan.id, kind: 'one_off', amountKop: 5_000_000, date: '2026-10-05', mode: 'reduce_term' });
    expect(added.statusCode, added.body).toBe(201);
    const balance = async () => (await api('GET', p('/accounts'))).data.find((a: { kind: string }) => a.kind === 'prepayment').balanceKop;

    const pending = (await api('GET', p('/prepayments/pending'))).data;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ date: '2026-10-05', amountKop: 5_000_000 });
    expect(await balance()).toBe(3_000_000);
    // повторный запрос — без двойного списания
    await api('GET', p('/dashboard'));
    expect(await balance()).toBe(3_000_000);

    const savingsWith = (await api('GET', p('/dashboard'))).data.payoff.savingsKop;
    // банк принял 4,5 млн — остаток и график по факту
    expect((await api('POST', p(`/prepayments/${pending[0].id}/confirm`), { action: 'amount', amountKop: 4_500_000 })).statusCode).toBe(200);
    expect(await balance()).toBe(3_500_000);
    const savingsFact = (await api('GET', p('/dashboard'))).data.payoff.savingsKop;
    expect(savingsFact).toBeLessThan(savingsWith);
    expect((await api('GET', p('/prepayments/pending'))).data).toHaveLength(0);
  });

  it('«не вносил» — деньги возвращаются на счёт, досрочка уходит из расчёта', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    const loan = (await api('POST', p('/loans'), { name: 'Ипотека', principalKop: 500_000_000, annualRate: '16', termMonths: 240, type: 'annuity', issueDate: '2026-06-15' })).data;
    const sc = (await api('GET', p('/prepayment-scenarios'))).data.find((x: { isActive: boolean }) => x.isActive);
    await api('POST', p(`/prepayment-scenarios/${sc.id}/prepayments`), { loanId: loan.id, kind: 'one_off', amountKop: 5_000_000, date: '2026-10-05', mode: 'reduce_term' });
    const pending = (await api('GET', p('/prepayments/pending'))).data;
    await api('POST', p(`/prepayments/${pending[0].id}/confirm`), { action: 'skip' });
    expect((await api('GET', p('/dashboard'))).data.payoff.savingsKop).toBe(0);
    const list = (await api('GET', p('/prepayment-scenarios'))).data.find((x: { isActive: boolean }) => x.isActive).prepayments;
    expect(list[0].status).toBe('skipped');
  });
});
