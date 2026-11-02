import { addMonths, buildSchedule, compareCandidateModes, formatMonthRu, formatRub, type LoanInput, monthsBetween, type PrepaymentInput, type PrepaymentMode, prepaymentTimingEffect, rub } from '@hypothec/core';
import { AlertTriangle, Plus, Star, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../api/auth.js';
import { useHh, useHhMutation } from '../../api/household.js';
import type { CompareDto, DashboardDto, LoanDto, PrepaymentScenarioDto } from '../../api/types.js';
import { LessonsFor, Term } from '../../components/learning.js';
import { Badge, Button, Card, ConfirmButton, cx, DateText, Empty, ErrorBox, Field, Input, Modal, Money, MoneyInput, PageHeader, Segmented, Select, Spinner } from '../../components/ui/index.js';
import { Tabs } from '../../layout/AppLayout.js';
import { chartTooltip, LOAN_TABS, rubAxis } from './LoanPage.js';

const MODE_LABEL: Record<PrepaymentMode, string> = {
  reduce_term: 'Сократить срок',
  reduce_payment: 'Уменьшить платёж',
  reduce_payment_keep_amount: 'Уменьшить платёж, платить прежнюю сумму',
};
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--muted)'];
const today = () => new Date().toISOString().slice(0, 10);

function toLoanInput(l: LoanDto): LoanInput {
  return { ...l, rateChanges: l.rateChanges ?? [] } as LoanInput;
}
/** Как в плане на сервере: отменённые досрочки в расчёт не идут, внесённые считаются по сумме, которую принял банк. */
function planned(list: PrepaymentScenarioDto['prepayments']) {
  return list.filter((p) => p.status !== 'skipped').map((p) => ({ ...p, amountKop: p.factAmountKop ?? p.amountKop })) as PrepaymentInput[];
}
function months(n: number) {
  const y = Math.floor(n / 12);
  const m = n % 12;
  return [y ? `${y} г.` : '', m ? `${m} мес.` : ''].filter(Boolean).join(' ') || '0';
}

export default function PrepaymentPage() {
  const loans = useHh<LoanDto[]>('/loans');
  const scenarios = useHh<PrepaymentScenarioDto[]>('/prepayment-scenarios');
  const dashboard = useHh<DashboardDto>('/dashboard');
  const [params, setParams] = useSearchParams();
  const simple = useAuth().uiMode === 'simple';
  if (loans.isLoading || scenarios.isLoading) return <Spinner />;
  if (loans.error || scenarios.error) return <ErrorBox error={loans.error ?? scenarios.error} />;
  const loan = loans.data?.[0];
  if (!loan) return <Empty title="Сначала добавьте кредит" />;
  const list = scenarios.data ?? [];
  const selectedId = params.get('scenario') ?? list.find((s) => s.isActive)?.id ?? list[0]?.id;
  const selected = list.find((s) => s.id === selectedId) ?? list[0];
  const cushion = dashboard.data?.cushion;

  return (
    <div>
      <Tabs items={LOAN_TABS} />
      <PageHeader
        title="Досрочное погашение"
        subtitle={simple ? 'Сколько сэкономит досрочный платёж и насколько раньше закроется кредит.' : 'Посчитайте разные варианты и сравните. Основной сценарий участвует в плане, остальные — черновики.'}
      />
      <div className="mb-4">
        <LessonsFor screen="prepayment" />
      </div>

      {cushion && !cushion.isFullReached && (
        <Card tone="warn" className="mb-4">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
            <p className="text-sm">
              <Term k="cushion">Подушка</Term> собрана на {String(cushion.monthsCovered).replace('.', ',')} из {cushion.targetMonths} мес. Деньги, внесённые в досрочку, обратно не забрать — сначала стоит собрать подушку.
            </p>
          </div>
        </Card>
      )}

      {simple ? (
        <SimplePrepayment loan={loan} scenario={list.find((x) => x.isActive) ?? list[0]} />
      ) : (
        <QuickCalculator loan={loan} existing={selected?.prepayments ?? []} scenario={selected} />
      )}

      {!simple && (
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Сценарии</h2>
        <ScenarioTabs list={list} selectedId={selected?.id} onSelect={(id) => setParams({ scenario: id })} />
        {selected && <ScenarioEditor key={selected.id} scenario={selected} loan={loan} />}
      </section>

      )}
      {!simple && <Compare loan={loan} list={list} />}
      <Timing loan={loan} existing={list.find((s) => s.isActive)?.prepayments ?? []} />
      {simple && (
        <p className="mt-4 text-sm text-ink-2">
          Несколько сценариев, сравнение и режим «уменьшить платёж» — в продвинутом режиме (переключатель в меню).
        </p>
      )}
    </div>
  );
}

/** Простой режим: одна сумма, одна дата, сокращение срока — и список досрочек в плане. */
function SimplePrepayment({ loan, scenario }: { loan: LoanDto; scenario?: PrepaymentScenarioDto }) {
  const [kind, setKind] = useState<'one_off' | 'monthly'>('one_off');
  const [amount, setAmount] = useState<number | null>(rub(300_000));
  const [date, setDate] = useState(() => (today() > loan.issueDate ? addMonths(today(), 1) : addMonths(loan.issueDate, 1)));
  const existing = planned(scenario?.prepayments ?? []);
  const add = useHhMutation<Record<string, unknown>>('POST', `/prepayment-scenarios/${scenario?.id}/prepayments`, { success: 'Добавлено в план' });
  const removePp = useHhMutation<{ _id: string }>('DELETE', (b) => `/prepayment-scenarios/${scenario?.id}/prepayments/${b._id}`, { success: 'Убрано из плана' });
  const r = useMemo(() => {
    if (!amount) return null;
    try {
      const input = toLoanInput(loan);
      const base = buildSchedule(input, existing);
      const next = buildSchedule(input, [...existing, { id: 'q', loanId: loan.id, kind, amountKop: amount, mode: 'reduce_term', ...(kind === 'one_off' ? { date } : { startDate: date }) }]);
      const contract = buildSchedule(input, []);
      return { savings: base.summary.totalInterestKop - next.summary.totalInterestKop, months: monthsBetween(next.summary.payoffDate, contract.summary.payoffDate), payoff: next.summary.payoffDate };
    } catch {
      return null;
    }
  }, [loan, existing, kind, amount, date]);
  return (
    <>
      <Card title="Сколько сэкономит досрочка">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Как платить" htmlFor="sq-kind">
            <Select id="sq-kind" value={kind} onChange={(e) => setKind(e.target.value as 'one_off' | 'monthly')}>
              <option value="one_off">Разовый платёж</option>
              <option value="monthly">Каждый месяц</option>
            </Select>
          </Field>
          <Field label={kind === 'one_off' ? 'Сумма' : 'Сумма в месяц'} htmlFor="sq-amount">
            <MoneyInput id="sq-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field label={kind === 'one_off' ? 'Дата' : 'Начиная с'} htmlFor="sq-date">
            <Input id="sq-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {r && (
          <div className="mt-4 rounded-xl bg-primary-soft p-4">
            <p className="text-sm text-ink-2">Переплата станет меньше на</p>
            <p className="text-2xl font-semibold text-ok">
              <Money kop={r.savings} />
            </p>
            <p className="mt-1 text-sm">{r.months > 0 ? `Кредит закроется на ${months(r.months)} раньше договора — ` : 'Кредит закроется в срок по договору — '}<DateText date={r.payoff} /></p>
            {scenario && (
              <Button size="sm" className="mt-3" loading={add.isPending} onClick={() => add.mutate({ loanId: loan.id, kind, amountKop: amount, mode: 'reduce_term', ...(kind === 'one_off' ? { date } : { startDate: date }) })}>
                Добавить в план
              </Button>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-muted">Считаем с сокращением срока — так экономия больше всего: платёж остаётся прежним, кредит закрывается раньше.</p>
      </Card>
      {existing.length > 0 && (
        <Card className="mt-4" title="Досрочки в плане">
          <ul className="divide-y divide-border">
            {scenario!.prepayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <Money kop={p.amountKop} className="font-medium" /> {p.kind === 'monthly' ? 'каждый месяц с ' : ''}
                  <DateText date={p.kind === 'monthly' ? p.startDate : p.date} />
                </span>
                <Button size="sm" variant="ghost" aria-label="Убрать досрочку" onClick={() => removePp.mutate({ _id: p.id })}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/** Мгновенный расчёт в браузере тем же ядром, что и на сервере. */
function QuickCalculator({ loan, existing, scenario }: { loan: LoanDto; existing: PrepaymentScenarioDto['prepayments']; scenario?: PrepaymentScenarioDto }) {
  const [kind, setKind] = useState<'one_off' | 'monthly'>('one_off');
  const [amount, setAmount] = useState<number | null>(rub(500_000));
  const [date, setDate] = useState(() => (today() > loan.issueDate ? addMonths(today(), 1) : addMonths(loan.issueDate, 1)));
  const add = useHhMutation<Record<string, unknown>>('POST', `/prepayment-scenarios/${scenario?.id}/prepayments`, { success: 'Добавлено в сценарий' });
  const result = useMemo(() => {
    if (!amount) return null;
    const p: PrepaymentInput = { id: 'quick', loanId: loan.id, kind, amountKop: amount, mode: 'reduce_term', ...(kind === 'one_off' ? { date } : { startDate: date }) };
    try {
      return compareCandidateModes(toLoanInput(loan), planned(existing), p);
    } catch {
      return null;
    }
  }, [loan, existing, kind, amount, date]);
  const stopsKeepAmount = planned(existing).some((p) => p.mode === 'reduce_payment_keep_amount');
  const hasPlan = planned(existing).length > 0;

  return (
    <Card title="Быстрый расчёт">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Как платить" htmlFor="q-kind">
          <Select id="q-kind" value={kind} onChange={(e) => setKind(e.target.value as 'one_off' | 'monthly')}>
            <option value="one_off">Разовый платёж</option>
            <option value="monthly">Каждый месяц</option>
          </Select>
        </Field>
        <Field label={kind === 'one_off' ? 'Сумма' : 'Сумма в месяц'} htmlFor="q-amount">
          <MoneyInput id="q-amount" value={amount} onChange={setAmount} />
        </Field>
        <Field label={kind === 'one_off' ? 'Дата' : 'Начиная с'} htmlFor="q-date">
          <Input id="q-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      {result && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(
            [
              ['reduce_term', result.reduceTerm],
              ['reduce_payment', result.reducePayment],
            ] as const
          ).map(([mode, r]) => (
            <div key={mode} className={cx('rounded-xl border p-3', mode === 'reduce_term' ? 'border-primary bg-primary-soft' : 'border-border')}>
              <p className="text-sm font-medium">{MODE_LABEL[mode]}</p>
              <p className={cx('mt-2 text-xl font-semibold', r.savingsKop < 0 ? 'text-warn' : 'text-ok')}>
                <Money kop={Math.abs(r.savingsKop)} />
              </p>
              <p className="text-xs text-ink-2">
                {r.savingsKop < 0 ? 'больше' : 'меньше'} переплата, чем {hasPlan ? 'по текущему плану' : 'по договору'}
              </p>
              {hasPlan && (
                <p className="mt-1 text-xs text-ink-2">
                  по сравнению с договором: {r.savingsVsContractKop < 0 ? 'больше' : 'меньше'} на <Money kop={Math.abs(r.savingsVsContractKop)} />
                </p>
              )}
              <p className="mt-2 text-sm">
                {r.monthsBeforeContract > 0 ? `на ${months(r.monthsBeforeContract)} раньше договора` : 'в срок по договору'} — {formatMonthRu(r.payoffDate)}
              </p>
              {r.paymentAfterKop > 0 ? (
                <>
                  <p className="mt-1 text-sm">
                    будете платить в месяц: <Money kop={r.monthlyOutlayKop} className="font-medium" />
                  </p>
                  <p className="text-sm text-ink-2">
                    обязательный платёж: <Money kop={r.paymentAfterKop} />
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-ink-2">кредит будет закрыт</p>
              )}
              {scenario && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3 w-full"
                  loading={add.isPending}
                  onClick={() => add.mutate({ loanId: loan.id, kind, amountKop: amount, mode, ...(kind === 'one_off' ? { date } : { startDate: date }) })}
                >
                  В сценарий «{scenario.name}»
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Банк снизил платёж, но вы можете и дальше платить прежнюю сумму — разница уйдёт в досрочку. Экономия тогда будет как при сокращении срока, а если доход упадёт, можно платить меньше.
        {stopsKeepAmount && ' У вас уже есть досрочка с прежней суммой: вариант «Уменьшить платёж» значит, что с этой даты вы перестаёте доплачивать, поэтому переплата по сравнению с текущим планом может вырасти, но срок по договору не меняется.'}
      </p>
    </Card>
  );
}

function ScenarioTabs({ list, selectedId, onSelect }: { list: PrepaymentScenarioDto[]; selectedId: string | undefined; onSelect(id: string): void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const create = useHhMutation<{ name: string; copyFromId?: string }, PrepaymentScenarioDto>('POST', '/prepayment-scenarios', { success: 'Сценарий создан' });
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {list.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s.id)}
          className={cx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm', s.id === selectedId ? 'border-primary bg-primary-soft text-primary' : 'border-border text-ink-2')}
        >
          {s.isActive && <Star className="size-3.5 fill-current" aria-label="основной" />}
          {s.name}
        </button>
      ))}
      <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
        <Plus className="size-4" aria-hidden /> Новый
      </Button>
      <Modal open={creating} onOpenChange={setCreating} title="Новый сценарий">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name, ...(selectedId ? { copyFromId: selectedId } : {}) }, { onSuccess: (s) => (setCreating(false), setName(''), onSelect(s.id)) });
          }}
        >
          <Field label="Название" htmlFor="sc-name" hint="Сценарий создастся копией выбранного — удобно менять одно и сравнивать">
            <Input id="sc-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, вычет в досрочку" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={create.isPending}>
              Создать
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function ScenarioEditor({ scenario, loan }: { scenario: PrepaymentScenarioDto; loan: LoanDto }) {
  const update = useHhMutation<Record<string, unknown>>('PATCH', `/prepayment-scenarios/${scenario.id}`, { success: 'Сохранено' });
  const remove = useHhMutation('DELETE', `/prepayment-scenarios/${scenario.id}`, { success: 'Сценарий удалён' });
  const removePp = useHhMutation<{ _id: string }>('DELETE', (b) => `/prepayment-scenarios/${scenario.id}/prepayments/${b._id}`);
  const fromTax = useHhMutation<Record<string, unknown>>('POST', '/prepayment-scenarios/from-tax', { success: 'Вычеты добавлены в сценарий' });
  const [adding, setAdding] = useState(false);
  const sim = useMemo(() => {
    try {
      const input = toLoanInput(loan);
      const s = buildSchedule(input, planned(scenario.prepayments));
      const b = buildSchedule(input, []);
      return { s, savings: b.summary.totalInterestKop - s.summary.totalInterestKop, monthsSaved: monthsBetween(s.summary.payoffDate, b.summary.payoffDate) };
    } catch {
      return null;
    }
  }, [loan, scenario.prepayments]);

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {scenario.name} {scenario.isActive && <Badge tone="primary">основной — участвует в плане</Badge>}
          </h3>
          {sim && (
            <p className="mt-1 text-sm text-ink-2">
              Экономия <Money kop={sim.savings} className="font-medium text-ok" /> · закрытие <DateText date={sim.s.summary.payoffDate} />
              {sim.monthsSaved > 0 && ` · на ${months(sim.monthsSaved)} раньше`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!scenario.isActive && (
            <Button size="sm" onClick={() => update.mutate({ isActive: true, version: scenario.version })}>
              Сделать основным
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => fromTax.mutate({ scenarioId: scenario.id, loanId: loan.id })} loading={fromTax.isPending}>
            + <Term k="tax_deduction">вычеты</Term>
          </Button>
          {!scenario.isActive && (
            <ConfirmButton confirm={`Удалить сценарий «${scenario.name}»?`} onConfirm={() => remove.mutate(undefined)}>
              <Trash2 className="size-4" aria-label="Удалить сценарий" />
            </ConfirmButton>
          )}
        </div>
      </div>
      {scenario.prepayments.length === 0 ? (
        <p className="text-sm text-ink-2">Досрочных платежей нет.</p>
      ) : (
        <ul className="divide-y divide-border">
          {scenario.prepayments.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="flex-1">
                <p className="font-medium">
                  <Money kop={p.amountKop} /> {p.kind === 'monthly' ? 'каждый месяц' : 'разово'}
                  {p.source === 'tax_refund' && <Badge tone="ok"> вычет</Badge>}
                  {p.status === 'done' && <Badge tone={p.confirmed ? 'ok' : 'warn'}>{p.confirmed ? ' внесена' : ' ждёт подтверждения'}</Badge>}
                  {p.status === 'skipped' && <Badge> не вносили</Badge>}
                </p>
                <p className="text-xs text-ink-2">
                  {p.kind === 'one_off' ? <DateText date={p.date} /> : <>с <DateText date={p.startDate} />{p.endDate && <> по <DateText date={p.endDate} /></>}</>} · {MODE_LABEL[p.mode]}
                </p>
              </div>
              <Button size="sm" variant="ghost" aria-label="Удалить досрочку" onClick={() => removePp.mutate({ _id: p.id })}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {sim && sim.s.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {sim.s.warnings.map((w, i) => (
            <li key={i} className="rounded-lg bg-warn-soft px-3 py-2 text-sm">
              {w.message}
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="secondary" className="mt-3" onClick={() => setAdding(true)}>
        <Plus className="size-4" aria-hidden /> Досрочный платёж
      </Button>
      {adding && <AddPrepayment scenario={scenario} loan={loan} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function AddPrepayment({ scenario, loan, onClose }: { scenario: PrepaymentScenarioDto; loan: LoanDto; onClose(): void }) {
  const [kind, setKind] = useState<'one_off' | 'monthly'>('one_off');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(addMonths(today(), 1));
  const [end, setEnd] = useState('');
  const [mode, setMode] = useState<PrepaymentMode>('reduce_term');
  const add = useHhMutation<Record<string, unknown>>('POST', `/prepayment-scenarios/${scenario.id}/prepayments`, { success: 'Добавлено' });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Досрочный платёж">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate({ loanId: loan.id, kind, amountKop: amount, mode, ...(kind === 'one_off' ? { date } : { startDate: date, ...(end ? { endDate: end } : {}) }) }, { onSuccess: onClose });
        }}
      >
        <Segmented label="Как платить" value={kind} onChange={setKind} options={[{ value: 'one_off', label: 'Разово' }, { value: 'monthly', label: 'Каждый месяц' }]} />
        <Field label="Сумма" htmlFor="pp-amount">
          <MoneyInput id="pp-amount" autoFocus value={amount} onChange={setAmount} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === 'one_off' ? 'Дата' : 'С какого месяца'} htmlFor="pp-date">
            <Input id="pp-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {kind === 'monthly' && (
            <Field label="До какого месяца" htmlFor="pp-end" hint="Пусто — до конца кредита">
              <Input id="pp-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label="Что пересчитать" htmlFor="pp-mode">
          <Select id="pp-mode" value={mode} onChange={(e) => setMode(e.target.value as PrepaymentMode)}>
            {Object.entries(MODE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={add.isPending} disabled={!amount}>
            Добавить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Compare({ loan, list }: { loan: LoanDto; list: PrepaymentScenarioDto[] }) {
  const [ids, setIds] = useState<string[]>(() => list.slice(0, 4).map((s) => s.id));
  const compare = useHhMutation<{ loanId: string; scenarioIds: string[] }, CompareDto>('POST', '/prepayment-scenarios/compare', { silent: true });
  const toggle = (id: string) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= 4 ? x : [...x, id]));
  const data = compare.data;
  const chart = useMemo(() => {
    if (!data) return [];
    const all = [data.baseline, ...data.scenarios];
    const dates = data.baseline.balances.map((b) => b.date).filter((_, i) => i % 6 === 0);
    return dates.map((date) => {
      const row: Record<string, number | string> = { date };
      all.forEach((s, i) => {
        const b = s.balances.find((x) => x.date >= date);
        row[`s${i}`] = b ? b.balanceKop : 0;
      });
      return row;
    });
  }, [data]);

  return (
    <Card className="mt-6" title="Сравнить сценарии">
      <p className="mb-3 text-sm text-ink-2">Выберите до 4 сценариев.</p>
      <div className="flex flex-wrap gap-2">
        {list.map((s) => (
          <label key={s.id} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm">
            <input type="checkbox" className="accent-[var(--primary)]" checked={ids.includes(s.id)} onChange={() => toggle(s.id)} />
            {s.name}
          </label>
        ))}
        <Button size="sm" onClick={() => compare.mutate({ loanId: loan.id, scenarioIds: ids })} disabled={!ids.length} loading={compare.isPending}>
          Сравнить
        </Button>
      </div>
      {data && (
        <>
          <div className="-mx-4 mt-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-4 py-2 font-normal sm:px-2">Сценарий</th>
                  <th className="px-2 py-2 text-right font-normal">Переплата</th>
                  <th className="px-2 py-2 text-right font-normal">Экономия</th>
                  <th className="px-2 py-2 text-right font-normal">Внесено досрочно</th>
                  <th className="px-4 py-2 text-right font-normal sm:px-2">Закрытие</th>
                </tr>
              </thead>
              <tbody>
                {[data.baseline, ...data.scenarios].map((s, i) => (
                  <tr key={s.scenarioId} className="border-t border-border">
                    <td className="px-4 py-2 sm:px-2">
                      <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: COLORS[i] }} />
                      {s.name}
                    </td>
                    <td className="num px-2 py-2 text-right">{formatRub(s.totalInterestKop, { kopecks: 'never' })}</td>
                    <td className="num px-2 py-2 text-right text-ok">{s.savingsKop ? formatRub(s.savingsKop, { kopecks: 'never' }) : '—'}</td>
                    <td className="num px-2 py-2 text-right">{s.totalPrepaidKop ? formatRub(s.totalPrepaidKop, { kopecks: 'never' }) : '—'}</td>
                    <td className="px-4 py-2 text-right sm:px-2">
                      {new Date(s.payoffDate).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })}
                      {s.monthsSaved > 0 && <span className="block text-xs text-ink-2">−{months(s.monthsSaved)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 h-60">
            <ResponsiveContainer>
              <LineChart data={chart}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0, 4)} minTickGap={40} stroke="var(--muted)" fontSize={12} />
                <YAxis tickFormatter={rubAxis} stroke="var(--muted)" fontSize={12} width={60} />
                <Tooltip {...chartTooltip} labelFormatter={(d) => new Date(String(d)).toLocaleDateString('ru-RU')} formatter={(v, n) => [formatRub(Number(v), { kopecks: 'never' }), String(n)]} />
                <Legend />
                {[data.baseline, ...data.scenarios].map((s, i) => (
                  <Line key={s.scenarioId} dataKey={`s${i}`} name={s.name} stroke={COLORS[i]} dot={false} strokeWidth={2} strokeDasharray={i === 0 ? '4 4' : undefined} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}

function Timing({ loan, existing }: { loan: LoanDto; existing: PrepaymentScenarioDto['prepayments'] }) {
  const [amount, setAmount] = useState<number | null>(rub(1_000_000));
  const points = useMemo(() => {
    if (!amount) return null;
    const start = today() > loan.issueDate ? today() : addMonths(loan.issueDate, 1);
    try {
      return prepaymentTimingEffect(toLoanInput(loan), amount, [start, addMonths(start, 12), addMonths(start, 36), addMonths(start, 60), addMonths(start, 120)], 'reduce_term', planned(existing));
    } catch {
      return null;
    }
  }, [loan, existing, amount]);
  const labels = ['сейчас', 'через год', 'через 3 года', 'через 5 лет', 'через 10 лет'];
  return (
    <Card className="mt-6" title="Сейчас или потом?">
      <div className="max-w-xs">
        <Field label="Сумма досрочки" htmlFor="tm-amount">
          <MoneyInput id="tm-amount" value={amount} onChange={setAmount} />
        </Field>
      </div>
      {points && (
        <ul className="mt-4 space-y-2">
          {points.map((p, i) => {
            const max = points[0]!.savingsKop || 1;
            return (
              <li key={p.date} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm">
                <span className="text-ink-2">{labels[i]}</span>
                <div className="h-2 rounded-full bg-surface-2">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (p.savingsKop / max) * 100)}%` }} />
                </div>
                <Money kop={p.savingsKop} className="w-28 text-right font-medium" />
              </li>
            );
          })}
        </ul>
      )}
      {points && points[0] && points[3] && amount && (
        <p className="mt-4 text-sm text-ink-2">
          <Money kop={amount} /> сейчас экономят <Money kop={points[0].savingsKop} className="font-medium text-ink" />, та же сумма через 5 лет — <Money kop={points[3].savingsKop} className="font-medium text-ink" />. В первые годы большая часть платежа — проценты.
        </p>
      )}
    </Card>
  );
}
