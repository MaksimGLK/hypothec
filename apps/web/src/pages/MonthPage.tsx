import { addMonths, type BudgetMonth, type CalendarEvent, endOfMonth, formatDateRu, formatMonthRu, type IncomeDistribution, type SpendingDraft } from '@hypothec/core';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.js';
import { useHh, useHhMutation, useHousehold } from '../api/household.js';
import type { AccountDto, IncomeDto, LivingDto, SettingsDto } from '../api/types.js';
import { DistributionCard } from '../components/distribution.js';
import { PendingPrepayments } from '../components/pending-prepayments.js';
import { DateCell, DayCell, FactCell, MoneyCell, TextCell } from '../components/inline.js';
import { Term } from '../components/learning.js';
import { Badge, Button, Card, cx, DateInput, Input, Money, MoneyInput, Segmented, Spinner } from '../components/ui/index.js';
import { useToast } from '../components/ui/toast.js';
import { useQueryClient } from '@tanstack/react-query';

interface SpendingDto {
  id: string;
  categoryId: string | null;
  date: string;
  amountKop: number;
  note?: string;
  source?: string;
  version: number;
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const RELIABILITY: Record<IncomeDto['reliability'], { label: string; tone: 'ok' | 'warn' | 'neutral'; next: IncomeDto['reliability'] }> = {
  stable: { label: 'стабильный', tone: 'ok', next: 'unstable' },
  unstable: { label: 'нестабильный', tone: 'warn', next: 'expected' },
  expected: { label: 'ожидаемый', tone: 'neutral', next: 'stable' },
};
const BILL_KEYS = new Set(['utilities', 'rent', 'mobile', 'kids_activities', 'kids_school', 'subscriptions']);

/**
 * «Мой месяц» — всё движение денег на одной странице, как в семейной таблице:
 * доходы, расходы на жизнь, платежи, траты вне плана, копилка и остаток. Всё правится прямо в строках.
 */
export default function MonthPage() {
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const dist = useHh<IncomeDistribution>(`/budget/distribution?month=${month}`);
  const d = dist.data;
  const seg = (k: string) => d?.segments.find((s) => s.key === k)?.amountKop ?? 0;
  const spent = seg('mortgage') + seg('obligatory') + seg('life') + seg('unplanned');
  const contributions = useHh<{ amountKop: number }[]>(`/budget/contributions?month=${month}`);
  const factTotal = (contributions.data ?? []).reduce((sum, c) => sum + c.amountKop, 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Мой месяц</h1>
          <p className="mt-1 text-sm text-ink-2">Все деньги месяца на одной странице. Нажмите на сумму или название, чтобы изменить.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Предыдущий месяц" onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-32 text-center text-sm font-medium capitalize">{formatMonthRu(`${month}-01`)}</span>
          <Button size="sm" variant="ghost" aria-label="Следующий месяц" onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </header>

      {d && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Доходы" kop={d.incomeKop} />
          <Tile label="Расходы и платежи" kop={spent} />
          <Tile label="Копилка" kop={seg('savings')} tone="primary" sub={factTotal ? <>отложено по факту <Money kop={factTotal} /></> : 'расчёт'} />
          <Tile label="Остаток" kop={seg('free') - d.shortfallKop} tone={seg('free') - d.shortfallKop < 0 ? 'danger' : 'ok'} />
        </div>
      )}

      <Section n={1} title="Доходы" hint="Зарплаты, авансы, аренда, премии — с днём поступления. Разовые деньги — с датой.">
        <Incomes month={month} onMonth={setMonth} />
      </Section>

      <Section
        n={2}
        title="Расходы на жизнь"
        hint="План на месяц по категориям и сколько уже потрачено."
        action={
          <Link to="/budget/import" className="shrink-0 rounded-xl border border-border px-3 py-1.5 text-sm text-primary hover:bg-surface-2">
            Загрузить выписку
          </Link>
        }
      >
        <Living month={month} />
      </Section>

      <Section n={3} title="Платежи месяца" hint="Ипотека, страховки и расходы сделки по плану.">
        <Payments month={month} />
      </Section>

      <Section n={4} title="Вне плана" hint="Дни рождения, поездки, бронь — всё, чего не было в плане. Сюда же попадают траты, для которых не нашлась категория: их можно перенести. Уменьшает копилку.">
        <Unplanned month={month} />
      </Section>

      <Section n={5} title="Копилка" hint="Всё, что остаётся после платежей и расходов, — на подушку, досрочку и цели. Ниже видно, откуда сумма, и можно настроить, как её делить.">
        <Savings d={d} month={month} />
      </Section>

      {dist.isLoading ? <Spinner /> : <DistributionCard month={month} />}
    </div>
  );
}

function Tile({ label, kop, tone, sub }: { label: string; kop: number; tone?: 'primary' | 'ok' | 'danger'; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <Money kop={kop} className={cx('mt-0.5 block text-lg font-semibold', tone === 'primary' && 'text-primary', tone === 'ok' && 'text-ok', tone === 'danger' && 'text-danger')} />
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

function Section({ n, title, hint, children, action }: { n: number; title: string; hint: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">{n}</span>
        <div className="flex-1">
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-ink-2">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Total({ label, kop }: { label: string; kop: number }) {
  return (
    <div className="mt-2 flex justify-between border-t border-border px-2 pt-2 text-sm font-semibold">
      <span>{label}</span>
      <Money kop={kop} />
    </div>
  );
}

// ── 1. Доходы ──
function Incomes({ month, onMonth }: { month: string; onMonth(month: string): void }) {
  const incomes = useHh<IncomeDto[]>('/incomes');
  const add = useHhMutation<Record<string, unknown>>('POST', '/incomes', { success: 'Доход добавлен' });
  const [name, setName] = useState('');
  const [day, setDay] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [kind, setKind] = useState<'monthly' | 'once'>('monthly');
  const [date, setDate] = useState('');
  if (incomes.isLoading) return <Spinner />;
  const today = todayIso();
  const onceDate = date || (today.startsWith(month) ? today : `${month}-01`);
  // по дню поступления; разовые — только в своём месяце; квартальные и годовые — без дня в месяце, идут в конце
  const dayOf = (i: IncomeDto) => (i.periodicity === 'monthly' ? (i.dayOfMonth ?? 32) : i.periodicity === 'once' && i.date ? Number(i.date.slice(8, 10)) : 32);
  const list = (incomes.data ?? [])
    .filter((i) => i.periodicity !== 'once' || i.date?.startsWith(month))
    .sort((a, b) => dayOf(a) - dayOf(b) || a.name.localeCompare(b.name, 'ru'));
  const monthly = list.filter((i) => i.periodicity === 'monthly').reduce((s, i) => s + i.amountKop, 0);
  const once = list.filter((i) => i.periodicity === 'once').reduce((s, i) => s + i.amountKop, 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !amount) return;
    if (kind === 'once') {
      add.mutate(
        { name: name.trim(), type: 'one_off', amountKop: amount, periodicity: 'once', date: onceDate, reliability: 'unstable' },
        {
          onSuccess: () => {
            setName(''), setDate(''), setAmount(null);
            // добавили на другой месяц — показываем его, иначе строка просто не появится
            if (!onceDate.startsWith(month)) onMonth(onceDate.slice(0, 7));
          },
        },
      );
      return;
    }
    const dayNum = Math.max(1, Math.min(31, Number(day) || 1));
    add.mutate(
      { name: name.trim(), type: /аванс/i.test(name) ? 'advance' : /прем/i.test(name) ? 'bonus' : /аренд|квартирант/i.test(name) ? 'rent' : 'salary', amountKop: amount, periodicity: 'monthly', dayOfMonth: dayNum, reliability: /прем|подработ/i.test(name) ? 'unstable' : 'stable' },
      { onSuccess: () => (setName(''), setDay(''), setAmount(null)) },
    );
  };
  return (
    <>
      <ul className="divide-y divide-border">
        {list.map((i) => (
          <IncomeRow key={i.id} income={i} />
        ))}
      </ul>
      <div className="mt-2">
        <Segmented label="Новый доход" value={kind} onChange={setKind} options={[{ value: 'monthly', label: 'Каждый месяц' }, { value: 'once', label: 'Разовый' }]} />
      </div>
      <form className={cx('mt-2 grid gap-2', kind === 'once' ? 'grid-cols-[150px_1fr_auto] sm:grid-cols-[1fr_150px_120px_auto]' : 'grid-cols-[64px_1fr_auto] sm:grid-cols-[1fr_64px_120px_auto]')} onSubmit={submit}>
        <Input aria-label="Новый доход: название" placeholder={kind === 'once' ? 'Например, Продажа машины' : 'Например, Зарплата Максим'} className="col-span-3 h-9 sm:col-span-1" value={name} onChange={(e) => setName(e.target.value)} />
        {kind === 'once' ? (
          <DateInput aria-label="Новый доход: дата" className="h-9" value={onceDate} onChange={(e) => setDate(e.target.value)} />
        ) : (
          <Input aria-label="Новый доход: день" placeholder="день" inputMode="numeric" className="h-9 text-center" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        )}
        <MoneyInput aria-label="Новый доход: сумма" value={amount} onChange={setAmount} />
        <Button type="submit" size="sm" aria-label="Добавить доход" disabled={!name.trim() || !amount} loading={add.isPending}>
          <Plus className="size-4" />
        </Button>
      </form>
      <Total label="Каждый месяц" kop={monthly} />
      {once > 0 && <Total label="Разово в этом месяце" kop={once} />}
      <p className="mt-1 px-2 text-xs text-muted">
        <Term k="reliability">Надёжность</Term>: нажмите на метку, чтобы поменять. Нестабильные деньги (премии, разовые) идут на цели, а не на ипотеку. Квартальные и годовые поступления —
        в разделе <Link to="/money/incomes" className="text-primary">Доходы</Link>.
      </p>
    </>
  );
}

function IncomeRow({ income }: { income: IncomeDto }) {
  const save = useHhMutation<Record<string, unknown>>('PATCH', `/incomes/${income.id}`, { silent: false });
  const remove = useHhMutation('DELETE', `/incomes/${income.id}`, { success: 'Удалено' });
  const r = RELIABILITY[income.reliability];
  const patch = (v: Record<string, unknown>) => save.mutate({ ...v, version: income.version });
  return (
    <li className="flex flex-wrap items-center gap-1 py-1 text-sm">
      <TextCell value={income.name} label="Название дохода" className="min-w-[40%] flex-1" onSave={(name) => patch({ name })} />
      {income.periodicity === 'monthly' ? (
        <DayCell value={income.dayOfMonth} label="День поступления" onSave={(dayOfMonth) => patch({ dayOfMonth })} />
      ) : income.periodicity === 'once' ? (
        <DateCell value={income.date} label="Дата поступления" onSave={(date) => patch({ date })} />
      ) : (
        <span className="w-14 text-center text-xs text-muted">{income.periodicity === 'quarterly' ? 'квартал' : 'год'}</span>
      )}
      <button type="button" onClick={() => patch({ reliability: r.next })} aria-label={`Надёжность: ${r.label}. Поменять`} className="hidden sm:block">
        <Badge tone={r.tone}>{r.label}</Badge>
      </button>
      <MoneyCell value={income.amountKop} label="Сумма дохода" onSave={(amountKop) => amountKop > 0 && patch({ amountKop })} className="w-28" />
      <Button size="sm" variant="ghost" aria-label={`Удалить: ${income.name}`} onClick={() => remove.mutate(undefined)}>
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

// ── 2. Расходы на жизнь ──
function Living({ month }: { month: string }) {
  const cats = useHh<LivingDto[]>('/living-expenses');
  const summary = useHh<BudgetMonth>(`/budget/summary?month=${month}`);
  const add = useHhMutation<Record<string, unknown>>('POST', '/living-expenses', { success: 'Категория добавлена' });
  const bootstrap = useHhMutation<Record<string, never>>('POST', '/budget/bootstrap', { success: 'Добавили типовые категории — впишите суммы' });
  const parse = useHhMutation<{ text: string }, SpendingDraft>('POST', '/budget/parse', { silent: true });
  const addSpending = useHhMutation<Record<string, unknown>>('POST', '/budget/spendings');
  const toast = useToast();
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<number | null>(null);
  const [line, setLine] = useState('');
  if (cats.isLoading) return <Spinner />;
  const list = (cats.data ?? []).filter((c) => c.catalogKey !== 'unplanned');
  const isCurrent = month === todayIso().slice(0, 7);
  const factOf = (id: string) => summary.data?.categories.find((c) => c.categoryId === id)?.factKop ?? 0;
  const totalPlan = list.reduce((s, c) => s + c.amountKop, 0);
  const totalFact = list.reduce((s, c) => s + factOf(c.id), 0);

  const quickAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!line.trim()) return;
    const d = await parse.mutateAsync({ text: line });
    if (!d.amountKop) return toast.show('Не нашли сумму — напишите, например, «продукты 1 250»', 'error');
    await addSpending.mutateAsync({ categoryId: d.categoryId, amountKop: d.amountKop, date: isCurrent ? todayIso() : `${month}-01`, note: d.note || null });
    toast.show(`Записали в «${list.find((c) => c.id === d.categoryId)?.name ?? 'без категории'}»`);
    setLine('');
  };

  if (list.length === 0) {
    return (
      <div className="text-sm">
        <p className="text-ink-2">Расходов пока нет. Начните с типовых категорий — коммуналка, продукты, транспорт, кружки — и впишите суммы.</p>
        <Button size="sm" className="mt-3" onClick={() => bootstrap.mutate({})} loading={bootstrap.isPending}>
          Добавить типовые категории
        </Button>
      </div>
    );
  }
  return (
    <>
      <div className="mb-1 hidden grid-cols-[1fr_112px_100px_auto] gap-1 px-2 text-xs text-muted sm:grid">
        <span>Категория</span>
        <span className="text-right">План</span>
        <span className="text-right">Потрачено</span>
        <span className="w-24" />
      </div>
      <ul className="divide-y divide-border">
        {list.map((c) => (
          <LivingRow key={c.id} cat={c} fact={factOf(c.id)} isCurrent={isCurrent} month={month} />
        ))}
      </ul>
      <form
        className="mt-2 grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_120px_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate({ name: name.trim(), amountKop: plan ?? 0, essential: true, group: 'other' }, { onSuccess: () => (setName(''), setPlan(null)) });
        }}
      >
        <Input aria-label="Новая категория: название" placeholder="Новая категория, например Обеды" className="col-span-2 h-9 sm:col-span-1" value={name} onChange={(e) => setName(e.target.value)} />
        <MoneyInput aria-label="Новая категория: план" value={plan} onChange={setPlan} />
        <Button type="submit" size="sm" aria-label="Добавить категорию" disabled={!name.trim()} loading={add.isPending}>
          <Plus className="size-4" />
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 border-t border-border px-2 pt-2 text-sm font-semibold">
        <span>Итого</span>
        <span>
          план <Money kop={totalPlan} /> · потрачено <Money kop={totalFact} className={cx(totalFact > totalPlan && 'text-danger')} />
        </span>
      </div>
      <p className="mt-2 px-2 text-xs text-muted">
        «Потрачено» можно править прямо в ячейке: впишите итог за месяц («7500») или добавьте к уже потраченному — «+2500».
      </p>
      <form className="mt-3 flex flex-col gap-2 rounded-xl bg-surface-2 p-3 sm:flex-row" onSubmit={quickAdd}>
        <Input aria-label="Внести трату" placeholder="Внести трату: «пятёрочка 1 250», «бензин 2500»" className="h-9" value={line} onChange={(e) => setLine(e.target.value)} />
        <Button type="submit" size="sm" loading={parse.isPending || addSpending.isPending}>
          Внести
        </Button>
      </form>
    </>
  );
}

function LivingRow({ cat, fact, isCurrent, month }: { cat: LivingDto; fact: number; isCurrent: boolean; month: string }) {
  const save = useHhMutation<Record<string, unknown>>('PATCH', `/living-expenses/${cat.id}`);
  const remove = useHhMutation('DELETE', `/living-expenses/${cat.id}`, { success: 'Категория удалена' });
  const pay = useHhMutation<Record<string, unknown>>('POST', '/budget/spendings', { success: `«${cat.name}» — оплачено` });
  const setTotal = useHhMutation<{ month: string; totalKop: number }>('POST', `/budget/categories/${cat.id}/month-total`);
  const bill = Boolean(cat.autoPayDay) || !cat.catalogKey || BILL_KEYS.has(cat.catalogKey);
  return (
    <li className="grid grid-cols-[1fr_1fr_auto] items-center gap-1 py-1 text-sm sm:grid-cols-[1fr_112px_100px_auto]">
      <span className="col-span-3 flex min-w-0 items-center gap-1 sm:col-span-1">
        <TextCell value={cat.name} label="Название категории" onSave={(name) => save.mutate({ name, version: cat.version })} />
        {cat.autoPayDay && <span className="shrink-0 text-xs text-muted">авто {cat.autoPayDay}-го</span>}
      </span>
      <span className="flex items-center gap-1 sm:block">
        <span className="text-xs text-muted sm:hidden">план</span>
        <MoneyCell value={cat.amountKop} label={`План: ${cat.name}`} onSave={(amountKop) => save.mutate({ amountKop, version: cat.version })} />
      </span>
      <span className="flex items-center justify-end gap-1 sm:block sm:text-right">
        <span className="text-xs text-muted sm:hidden">потрачено</span>
        <FactCell value={fact} label={`Потрачено: ${cat.name}`} over={fact > cat.amountKop && cat.amountKop > 0} onSave={(totalKop) => setTotal.mutate({ month, totalKop })} />
      </span>
      <span className="col-span-3 flex items-center justify-end sm:col-span-1 sm:w-24">
        {isCurrent && bill && fact === 0 && cat.amountKop > 0 ? (
          <Button size="sm" variant="secondary" onClick={() => pay.mutate({ categoryId: cat.id, amountKop: cat.amountKop, date: todayIso(), source: 'plan', note: 'Оплачено по плану' })} aria-label={`Отметить «${cat.name}» оплаченной`}>
            Оплачено
          </Button>
        ) : fact >= cat.amountKop && fact > 0 ? (
          <span className="text-xs text-ok">✓</span>
        ) : null}
        <Button size="sm" variant="ghost" aria-label={`Удалить категорию: ${cat.name}`} onClick={() => remove.mutate(undefined)}>
          <Trash2 className="size-4" />
        </Button>
      </span>
    </li>
  );
}

// ── 3. Платежи ──
function useNextMortgage() {
  const dash = useHh<{ nextPayment: { date: string; amountKop: number } | null }>('/dashboard');
  return dash.data?.nextPayment ?? null;
}

function Payments({ month }: { month: string }) {
  const events = useHh<CalendarEvent[]>(`/calendar?from=${month}-01&to=${endOfMonth(`${month}-01`)}`);
  const next = useNextMortgage();
  if (events.isLoading) return <Spinner />;
  const list = (events.data ?? []).filter((e) => ['loan_payment', 'insurance', 'expense', 'prepayment'].includes(e.type));
  const hasMortgage = list.some((e) => e.type === 'loan_payment');
  return (
    <>
      <div className="mb-3">
        <PendingPrepayments />
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-ink-2">В этом месяце платежей по плану нет.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {list.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-2 py-2">
              <span className="w-20 shrink-0 text-ink-2 sm:w-24">{formatDateRu(e.date, { year: false })}</span>
              <span className="flex-1">
                {e.title}
                {e.type === 'prepayment' && (
                  <span className="block text-xs text-muted">
                    платится из накоплений на счёте «Досрочка», а не из доходов месяца; в день досрочки сумма спишется со счёта сама
                  </span>
                )}
              </span>
              <Money kop={e.amountKop ?? 0} className="font-medium" />
            </li>
          ))}
        </ul>
      )}
      {!hasMortgage && next && next.date.slice(0, 7) > month && (
        <p className="mt-2 rounded-xl bg-info-soft px-3 py-2 text-sm">
          Ближайший платёж по ипотеке — {formatDateRu(next.date, { year: false })}, <Money kop={next.amountKop} />. Деньги на него начинают откладываться уже в этом месяце — это
          строка «на ипотеку» в копилке ниже.
        </p>
      )}
      {list.length > 0 && <Total label="Итого" kop={list.reduce((s, e) => s + (e.amountKop ?? 0), 0)} />}
      <p className="mt-1 px-2 text-xs text-muted">
        Изменить кредит — в разделе <Link to="/loan" className="text-primary">Кредит</Link>, досрочку — в <Link to="/loan/prepayment" className="text-primary">Досрочке</Link>.
      </p>
    </>
  );
}

// ── 4. Вне плана ──
function Unplanned({ month }: { month: string }) {
  const { hid } = useHousehold();
  const qc = useQueryClient();
  const toast = useToast();
  const cats = useHh<LivingDto[]>('/living-expenses');
  const spendings = useHh<SpendingDto[]>(`/budget/spendings?month=${month}`);
  const remove = useHhMutation<{ _id: string }>('DELETE', (b) => `/budget/spendings/${b._id}`, { success: 'Удалено' });
  const move = useHhMutation<{ _id: string; categoryId: string; version: number }>('PATCH', (b) => `/budget/spendings/${b._id}`, { success: 'Перенесли в категорию' });
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const summary = useHh<BudgetMonth>(`/budget/summary?month=${month}`);
  const unplannedCat = cats.data?.find((c) => c.catalogKey === 'unplanned');
  const items = (spendings.data ?? []).filter((s) => (unplannedCat && s.categoryId === unplannedCat.id) || !s.categoryId);
  // перерасход по обычным категориям тоже «вне плана» — так же он считается в копилке
  const overspends = (summary.data?.categories ?? []).filter((c) => c.leftKop < 0 && c.categoryId !== unplannedCat?.id);
  const unplannedCatOver = summary.data?.categories.find((c) => c.categoryId === unplannedCat?.id);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim() || !amount) return;
    setBusy(true);
    try {
      let catId = unplannedCat?.id;
      if (!catId) {
        await api(`/households/${hid}/budget/bootstrap`, { method: 'POST', body: { keys: ['unplanned'] } });
        const fresh = await api<LivingDto[]>(`/households/${hid}/living-expenses`);
        catId = fresh.find((c) => c.catalogKey === 'unplanned')?.id;
      }
      const isCurrent = month === todayIso().slice(0, 7);
      await api(`/households/${hid}/budget/spendings`, { method: 'POST', body: { categoryId: catId ?? null, amountKop: amount, date: isCurrent ? todayIso() : `${month}-01`, note: note.trim() } });
      await qc.invalidateQueries({ queryKey: ['h', hid] });
      setNote('');
      setAmount(null);
    } catch (err) {
      toast.show((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {items.length > 0 && (
        <ul className="divide-y divide-border text-sm">
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-2 py-1.5">
              <span className="w-20 shrink-0 text-ink-2 sm:w-24">{formatDateRu(s.date, { year: false })}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{s.note || 'Без описания'}</span>
                <select
                  aria-label={`Перенести «${s.note || 'трату'}» в категорию`}
                  className="mt-0.5 max-w-full bg-transparent text-xs text-primary"
                  value=""
                  onChange={(e) => e.target.value && move.mutate({ _id: s.id, categoryId: e.target.value, version: s.version })}
                >
                  <option value="">{s.categoryId ? 'вне плана — перенести в категорию…' : 'без категории — перенести в категорию…'}</option>
                  {(cats.data ?? [])
                    .filter((c) => c.catalogKey !== 'unplanned')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </span>
              <Money kop={s.amountKop} className="font-medium" />
              <Button size="sm" variant="ghost" aria-label="Удалить трату" onClick={() => remove.mutate({ _id: s.id })}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="mt-2 grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_120px_auto]" onSubmit={submit}>
        <Input aria-label="Вне плана: на что" placeholder="На что, например ДР Максима" className="col-span-2 h-9 sm:col-span-1" value={note} onChange={(e) => setNote(e.target.value)} />
        <MoneyInput aria-label="Вне плана: сумма" value={amount} onChange={setAmount} />
        <Button type="submit" size="sm" aria-label="Добавить трату вне плана" disabled={!note.trim() || !amount} loading={busy}>
          <Plus className="size-4" />
        </Button>
      </form>
      {overspends.length > 0 && (
        <ul className="mt-2 divide-y divide-border text-sm">
          {overspends.map((c) => (
            <li key={c.categoryId} className="flex items-center gap-3 px-2 py-1.5">
              <span className="w-20 shrink-0 text-xs text-muted sm:w-24">сверх плана</span>
              <span className="min-w-0 flex-1 truncate">
                {c.name} <span className="text-xs text-muted">(план <Money kop={c.planKop} />, потрачено <Money kop={c.factKop} />)</span>
              </span>
              <Money kop={-c.leftKop} className="font-medium text-danger" />
            </li>
          ))}
        </ul>
      )}
      {(items.length > 0 || overspends.length > 0) && (
        <Total
          label="Всего вне плана"
          kop={items.filter((x) => x.categoryId !== unplannedCat?.id).reduce((s, x) => s + x.amountKop, 0) + Math.max(0, -(unplannedCatOver?.leftKop ?? 0)) + overspends.reduce((s, c) => s - c.leftKop, 0)}
        />
      )}
    </>
  );
}

// ── 5. Копилка ──
const GOAL_NAMES: Record<string, string> = {
  min_cushion: 'Подушка: минимум',
  full_cushion: 'Подушка полностью',
  priority_setup: 'Обустройство: самое нужное',
  setup: 'Обустройство',
  prepayment: 'Досрочка',
  custom: 'Своя цель',
};

function Savings({ d, month }: { d: IncomeDistribution | undefined; month: string }) {
  const next = useNextMortgage();
  const seg = (k: string) => d?.segments.find((x) => x.key === k)?.amountKop ?? 0;
  const savings = d?.segments.find((x) => x.key === 'savings');
  const free = seg('free') - (d?.shortfallKop ?? 0);
  if (!d) return <Spinner />;
  return (
    <>
      {/* откуда берётся сумма — та же арифметика, что в семейной таблице */}
      <div className="rounded-xl bg-surface-2 p-3 text-sm">
        <p className="mb-1 text-xs text-muted">Откуда сумма</p>
        <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
          <span>Доходы месяца</span>
          <Money kop={d.incomeKop} />
          {seg('mortgage') > 0 && (
            <>
              <span>
                − откладываем к платежу по ипотеке
                {next && <span className="block text-xs text-muted">ближайший платёж {formatDateRu(next.date, { year: false })} — <Money kop={next.amountKop} />; часть откладывается из доходов этого месяца, остальное — из поступлений до даты платежа</span>}
              </span>
              <Money kop={seg('mortgage')} />
            </>
          )}
          {seg('obligatory') > 0 && (
            <>
              <span>− другие обязательные платежи</span>
              <Money kop={seg('obligatory')} />
            </>
          )}
          {seg('life') > 0 && (
            <>
              <span>− расходы на жизнь (план)</span>
              <Money kop={seg('life')} />
            </>
          )}
          {seg('unplanned') > 0 && (
            <>
              <span>− вне плана (факт)</span>
              <Money kop={seg('unplanned')} />
            </>
          )}
          <span className="border-t border-border pt-1 font-semibold">= в копилку и остаток</span>
          <Money kop={seg('savings') + free} className="border-t border-border pt-1 font-semibold" />
        </div>
      </div>

      <GoalsPlanFact month={month} parts={savings?.parts ?? []} />
      {d.savingsReducedKop > 0 && <p className="mt-1 px-2 text-xs text-warn">Траты вне плана уменьшили копилку на <Money kop={d.savingsReducedKop} />.</p>}
      <div className={cx('mt-3 flex justify-between rounded-xl px-3 py-2 text-sm font-semibold', free < 0 ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok')}>
        <span>Остаток — свободные деньги</span>
        <Money kop={free} />
      </div>
      <SavingsSettings />
    </>
  );
}

interface ContributionDto {
  accountId: string;
  month: string;
  amountKop: number;
}

/**
 * Копилка по целям: план (расчёт сервиса) и факт (сколько реально отложили). Факт правится в ячейке — итогом или «+сумма»;
 * остаток счёта цели меняется на ту же разницу.
 */
function GoalsPlanFact({ month, parts }: { month: string; parts: { name: string; amountKop: number; accountId?: string }[] }) {
  const accounts = useHh<AccountDto[]>('/accounts');
  const facts = useHh<ContributionDto[]>(`/budget/contributions?month=${month}`);
  const setFact = useHhMutation<{ accountId: string; month: string; amountKop: number }>('PUT', '/budget/contributions', { success: 'Факт сохранён — остаток счёта обновлён' });
  const factOf = (id: string) => facts.data?.find((f) => f.accountId === id)?.amountKop ?? 0;
  const goalKinds = new Set(['cushion', 'prepayment', 'setup', 'custom']);
  // цели с планом в этом месяце + цели, куда уже вписан факт
  const ids = [...new Set([...parts.map((p) => p.accountId!).filter(Boolean), ...(facts.data ?? []).map((f) => f.accountId)])];
  const rows = ids.map((id) => ({
    id,
    name: accounts.data?.find((a) => a.id === id)?.name ?? parts.find((p) => p.accountId === id)?.name ?? 'Цель',
    plan: parts.find((p) => p.accountId === id)?.amountKop ?? 0,
    fact: factOf(id),
  }));
  const other = (accounts.data ?? []).filter((a) => goalKinds.has(a.kind) && !ids.includes(a.id));
  const totalPlan = rows.reduce((sum, r) => sum + r.plan, 0);
  const totalFact = rows.reduce((sum, r) => sum + r.fact, 0);
  if (!rows.length && !other.length) return <p className="mt-3 text-sm text-ink-2">В этом месяце на цели денег не остаётся — всё уходит на расходы и платежи.</p>;
  return (
    <div className="mt-3">
      <div className="mb-1 grid grid-cols-[1fr_100px_112px_90px] gap-1 px-2 text-xs text-muted">
        <span>Цель</span>
        <span className="text-right">План</span>
        <span className="text-right">Факт</span>
        <span className="text-right">Разница</span>
      </div>
      <ul className="divide-y divide-border text-sm">
        {rows.map((r) => {
          const diff = r.fact - r.plan;
          return (
            <li key={r.id} className="grid grid-cols-[1fr_100px_112px_90px] items-center gap-1 py-1">
              <span className="min-w-0 truncate px-2">{r.name}</span>
              <Money kop={r.plan} className="text-right text-ink-2" />
              <span className="text-right">
                <FactCell value={r.fact} label={`Факт: ${r.name}`} onSave={(amountKop) => setFact.mutate({ accountId: r.id, month, amountKop })} />
              </span>
              <span className={cx('px-1 text-right text-xs', r.fact === 0 ? 'text-muted' : diff >= 0 ? 'text-ok' : 'text-warn')}>
                {r.fact === 0 ? '—' : `${diff >= 0 ? '+' : '−'}${Math.abs(Math.round(diff / 100)).toLocaleString('ru-RU')} ₽`}
              </span>
            </li>
          );
        })}
      </ul>
      {other.length > 0 && (
        <p className="mt-1 px-2 text-xs text-muted">
          Отложили на другую цель?{' '}
          {other.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ', '}
              <button type="button" className="text-primary" onClick={() => setFact.mutate({ accountId: a.id, month, amountKop: 0 })}>
                {a.name}
              </button>
            </span>
          ))}{' '}
          — нажмите, чтобы добавить строку.
        </p>
      )}
      <div className="mt-2 grid grid-cols-[1fr_100px_112px_90px] gap-1 border-t border-border px-2 pt-2 text-sm font-semibold">
        <span>В копилку за месяц</span>
        <Money kop={totalPlan} className="text-right" />
        <Money kop={totalFact} className="px-2 text-right" />
        <span className={cx('text-right text-xs', totalFact - totalPlan >= 0 ? 'text-ok' : 'text-warn')}>
          {totalFact ? `${totalFact - totalPlan >= 0 ? '+' : '−'}${Math.abs(Math.round((totalFact - totalPlan) / 100)).toLocaleString('ru-RU')} ₽` : ''}
        </span>
      </div>
      <p className="mt-1 px-2 text-xs text-muted">
        План — расчёт сервиса. Факт — сколько вы реально отложили: впишите итог («75000») или добавьте «+10000». Остаток счёта цели обновится сам.
      </p>
    </div>
  );
}

/** Как делить копилку — прямо здесь: по очереди или долями, какие цели включены. */
function SavingsSettings() {
  const settings = useHh<SettingsDto>('/settings');
  const save = useHhMutation<Record<string, unknown>>('PATCH', '/settings', { success: 'Сохранено — копилка пересчитана' });
  const [draft, setDraft] = useState<Record<number, string>>({});
  if (!settings.data) return null;
  const st = settings.data;
  const steps = st.allocation.steps;
  const split = st.allocation.distribution === 'split';
  const patch = (allocation: Partial<SettingsDto['allocation']>) => save.mutate({ allocation: { ...st.allocation, ...allocation }, version: st.version });
  const setMode = (mode: 'sequential' | 'split') => {
    if (mode === 'split' && !steps.some((x) => x.enabled && (x.sharePercent ?? 0) > 0)) {
      const n = steps.filter((x) => x.enabled).length || 1;
      const each = Math.floor(100 / n);
      let rest = 100 - each * n;
      patch({ distribution: mode, steps: steps.map((x) => (x.enabled ? { ...x, sharePercent: each + (rest-- > 0 ? 1 : 0) } : x)) });
    } else patch({ distribution: mode });
  };
  const commit = (i: number) => {
    const raw = draft[i];
    if (raw === undefined) return;
    const v = Math.max(0, Math.min(100, Number(raw.replace(/\D/g, '')) || 0));
    setDraft(({ [i]: _x, ...rest }) => rest);
    patch({ steps: steps.map((x, j) => (j === i ? { ...x, sharePercent: v } : x)) });
  };
  const total = steps.filter((x) => x.enabled).reduce((sum, x) => sum + (x.sharePercent ?? 0), 0);
  return (
    <div className="mt-4 rounded-xl border border-border p-3">
      <p className="text-sm font-medium">Как делить копилку</p>
      <div className="mt-2">
        <Segmented
          label="Как делить копилку"
          value={split ? 'split' : 'sequential'}
          onChange={setMode}
          options={[
            { value: 'sequential', label: 'По очереди' },
            { value: 'split', label: 'Долями' },
          ]}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted">{split ? 'Каждое поступление делится по процентам. Собранная цель отдаёт свою долю остальным.' : 'Сверху вниз: следующая цель получает деньги, когда собрана предыдущая.'}</p>
      <ul className="mt-2 space-y-1">
        {steps.map((x, i) => (
          <li key={x.target + (x.accountId ?? '')} className={cx('flex items-center gap-2 text-sm', !x.enabled && 'text-muted')}>
            <input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label={`Включить: ${GOAL_NAMES[x.target]}`} checked={x.enabled} onChange={(e) => patch({ steps: steps.map((y, j) => (j === i ? { ...y, enabled: e.target.checked } : y)) })} />
            <span className="flex-1">{GOAL_NAMES[x.target] ?? x.target}</span>
            {split && x.enabled && (
              <label className="flex items-center gap-1">
                <Input
                  aria-label={`Доля копилки: ${GOAL_NAMES[x.target]}`}
                  inputMode="numeric"
                  className="h-8 w-14 text-right"
                  value={draft[i] ?? String(x.sharePercent ?? 0)}
                  onChange={(e) => setDraft({ ...draft, [i]: e.target.value })}
                  onBlur={() => commit(i)}
                  onKeyDown={(e) => e.key === 'Enter' && commit(i)}
                />
                %
              </label>
            )}
          </li>
        ))}
      </ul>
      {split && total !== 100 && <p className="mt-1 text-xs text-warn">Сумма долей — {total}%. Делим пропорционально.</p>}
      <p className="mt-2 text-xs text-muted">
        Цель подушки — {st.allocation.minCushionMonths} мес. обязательных расходов (минимум) и {st.allocation.cushionMonths} мес. (полностью). Когда цель собрана, деньги на неё больше не идут. Порядок целей и
        остальные настройки — в <Link to="/money/allocation" className="text-primary">Счетах и переводах</Link>.
      </p>
    </div>
  );
}
