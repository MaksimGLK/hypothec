import { formatRub, parseDate, type RateChange, formatDateNum } from '@hypothec/core';
import { Plus, Trash2, Upload } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../api/auth.js';
import { useHh, useHhMutation } from '../../api/household.js';
import type { LoanDto, ReconcileResult, ScheduleDto } from '../../api/types.js';
import { LessonsFor, Term } from '../../components/learning.js';
import { DateInput, Badge, Button, Card, cx, DateText, Empty, ErrorBox, Field, Input, Modal, Money, MoneyInput, PageHeader, Select, Spinner, Stat, Switch } from '../../components/ui/index.js';
import { Tabs } from '../../layout/AppLayout.js';

export const LOAN_TABS = [
  { to: '/loan', label: 'Кредит', end: true },
  { to: '/loan/prepayment', label: 'Досрочка' },
];

export const rubAxis = (v: number) => (v >= 100_000_000 ? `${(v / 100_000_000).toFixed(1).replace('.', ',')} млн` : `${Math.round(v / 100_000)} тыс`);
export const chartTooltip = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--ink)' } };

export default function LoanPage() {
  const loans = useHh<LoanDto[]>('/loans');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (loans.isLoading) return <Spinner />;
  if (loans.error) return <ErrorBox error={loans.error} />;
  const list = loans.data ?? [];
  const loan = list.find((l) => l.id === selected) ?? list[0];

  return (
    <div>
      <Tabs items={LOAN_TABS} />
      <PageHeader
        title="Кредит"
        action={
          <div className="flex gap-2">
            {list.length > 1 && (
              <Select aria-label="Кредит" className="h-9 w-auto" value={loan?.id} onChange={(e) => setSelected(e.target.value)}>
                {list.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
            <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> Ещё кредит
            </Button>
          </div>
        }
      />
      <div className="mb-4">
        <LessonsFor screen="loans" />
      </div>
      {!loan ? (
        <Empty title="Кредита пока нет" action={<Button onClick={() => setCreating(true)}>Добавить кредит</Button>}>
          Добавьте ипотеку с параметрами из одобрения или договора.
        </Empty>
      ) : (
        <LoanDetails key={loan.id} loan={loan} />
      )}
      {creating && (
        <Modal open onOpenChange={setCreating} title="Новый кредит">
          <LoanForm onDone={() => setCreating(false)} />
        </Modal>
      )}
    </div>
  );
}

function LoanDetails({ loan }: { loan: LoanDto }) {
  const advanced = useAuth().uiMode === 'advanced';
  const schedule = useHh<ScheduleDto>(`/loans/${loan.id}/schedule`);
  const [editing, setEditing] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const s = schedule.data;
  const today = new Date().toISOString().slice(0, 10);
  const next = s?.rows.find((r) => r.kind === 'payment' && r.date >= today);
  const balanceNow = s ? ([...s.rows].reverse().find((r) => r.date <= today)?.balanceKop ?? loan.principalKop) : loan.principalKop;

  const byYear = useMemo(() => {
    if (!s) return [];
    const map = new Map<number, { year: number; interest: number; principal: number; prepayment: number }>();
    for (const r of s.rows) {
      const y = parseDate(r.date).y;
      const x = map.get(y) ?? { year: y, interest: 0, principal: 0, prepayment: 0 };
      x.interest += r.interestKop;
      x.principal += r.principalKop;
      x.prepayment += r.prepaymentKop;
      map.set(y, x);
    }
    return [...map.values()];
  }, [s]);

  return (
    <div className="space-y-4">
      <Card
        title={loan.name}
        action={
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Изменить
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Сумма кредита" value={<Money kop={loan.principalKop} />} />
          <Stat label="Ставка" value={`${loan.annualRate.replace('.', ',')}%`} sub={(loan.rateChanges ?? []).length ? `меняется с ${formatDateNum(loan.rateChanges![0]!.fromDate)}` : undefined} />
          <Stat label="Срок" value={`${Math.round(loan.termMonths / 12)} лет`} sub={loan.type === 'annuity' ? 'аннуитет' : 'дифференцированный'} />
          <Stat label="Остаток долга" value={<Money kop={balanceNow} />} />
        </div>
        {s && (
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
            <Stat label={<Term k="annuity">Платёж</Term>} value={<Money kop={next?.paymentKop ?? s.summary.firstPaymentKop} />} sub={next ? <>следующий <DateText date={next.date} year={false} /></> : undefined} />
            <Stat label={<Term k="overpayment">Переплата</Term>} value={<Money kop={s.summary.totalInterestKop} />} sub={s.baseline.totalInterestKop > s.summary.totalInterestKop ? <>без досрочки <Money kop={s.baseline.totalInterestKop} /></> : undefined} />
            <Stat label="Закрытие" value={<DateText date={s.summary.payoffDate} />} />
            <Stat label="Всего платежей" value={s.summary.paymentsCount} />
          </div>
        )}
        {s && s.warnings.length > 0 && (
          <ul className="mt-3 space-y-1">
            {s.warnings.map((w, i) => (
              <li key={i} className="rounded-lg bg-warn-soft px-3 py-2 text-sm">
                {w.message}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {schedule.isLoading ? (
        <Spinner />
      ) : schedule.error ? (
        <ErrorBox error={schedule.error} onRetry={() => void schedule.refetch()} />
      ) : s ? (
        <>
          <Card title="Остаток долга">
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={s.rows.filter((r) => r.kind === 'payment')}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0, 4)} minTickGap={40} stroke="var(--muted)" fontSize={12} />
                  <YAxis tickFormatter={rubAxis} stroke="var(--muted)" fontSize={12} width={60} />
                  <Tooltip {...chartTooltip} labelFormatter={(d) => formatDateNum(String(d))} formatter={(v) => [formatRub(Number(v), { kopecks: 'never' }), 'Остаток']} />
                  <Area dataKey="balanceKop" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Куда уходят деньги по годам">
            <p className="mb-3 text-sm text-ink-2">В первые годы большая часть платежа — проценты. Поэтому досрочка в начале срока экономит больше всего.</p>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={byYear}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="year" stroke="var(--muted)" fontSize={12} minTickGap={10} />
                  <YAxis tickFormatter={rubAxis} stroke="var(--muted)" fontSize={12} width={60} />
                  <Tooltip {...chartTooltip} formatter={(v, n) => [formatRub(Number(v), { kopecks: 'never' }), String(n)]} />
                  <Legend />
                  <Bar dataKey="interest" name="Проценты" stackId="a" fill="var(--chart-2)" />
                  <Bar dataKey="principal" name="Основной долг" stackId="a" fill="var(--chart-1)" />
                  <Bar dataKey="prepayment" name="Досрочка" stackId="a" fill="var(--chart-3)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          {advanced && <ScheduleTable schedule={s} />}
        </>
      ) : null}

      {advanced && <Card title="График из банка" action={<Button size="sm" variant="secondary" onClick={() => setCsvOpen(true)}><Upload className="size-4" aria-hidden /> Загрузить CSV</Button>}>
        <p className="text-sm text-ink-2">Загрузите график платежей из личного кабинета банка, и мы сверим его с расчётом. Если банк считает проценты по дням, подскажем, что поменять.</p>
        <BankDiff loanId={loan.id} />
      </Card>}

      {editing && (
        <Modal open onOpenChange={setEditing} title="Параметры кредита">
          <LoanForm loan={loan} onDone={() => setEditing(false)} />
        </Modal>
      )}
      {csvOpen && <CsvUpload loanId={loan.id} onClose={() => setCsvOpen(false)} />}
    </div>
  );
}

function ScheduleTable({ schedule }: { schedule: ScheduleDto }) {
  const years = [...new Set(schedule.rows.map((r) => r.date.slice(0, 4)))];
  const [year, setYear] = useState(years[0] ?? '');
  const rows = schedule.rows.filter((r) => r.date.startsWith(year));
  return (
    <Card title="График платежей" action={<Select aria-label="Год" className="h-9 w-auto" value={year} onChange={(e) => setYear(e.target.value)}>{years.map((y) => <option key={y}>{y}</option>)}</Select>}>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-4 py-2 font-normal sm:px-2">Дата</th>
              <th className="px-2 py-2 text-right font-normal">Платёж</th>
              <th className="px-2 py-2 text-right font-normal">Проценты</th>
              <th className="px-2 py-2 text-right font-normal">Долг</th>
              <th className="px-2 py-2 text-right font-normal">Досрочно</th>
              <th className="px-4 py-2 text-right font-normal sm:px-2">Остаток</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind + r.date} className={cx('border-t border-border', r.kind === 'prepayment' && 'bg-primary-soft')}>
                <td className="px-4 py-2 sm:px-2">{formatDateNum(r.date)}</td>
                <td className="num px-2 py-2 text-right">{r.paymentKop ? formatRub(r.paymentKop) : '—'}</td>
                <td className="num px-2 py-2 text-right text-ink-2">{formatRub(r.interestKop)}</td>
                <td className="num px-2 py-2 text-right text-ink-2">{formatRub(r.principalKop)}</td>
                <td className="num px-2 py-2 text-right">{r.prepaymentKop ? formatRub(r.prepaymentKop) : ''}</td>
                <td className="num px-4 py-2 text-right sm:px-2">{formatRub(r.balanceKop)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

type LoanFormValue = Omit<LoanDto, 'id' | 'version'> & { id?: string; version?: number };

export function LoanForm({ loan, onDone }: { loan?: LoanDto; onDone(): void }) {
  const advanced = useAuth().uiMode === 'advanced';
  const [v, setV] = useState<LoanFormValue>(
    loan ?? { name: 'Ипотека', principalKop: 0, annualRate: '', termMonths: 240, type: 'annuity', issueDate: new Date().toISOString().slice(0, 10), interestMode: 'monthly', rateChanges: [] },
  );
  const save = useHhMutation<Record<string, unknown>>(loan ? 'PATCH' : 'POST', loan ? `/loans/${loan.id}` : '/loans', { success: 'Сохранено, план пересчитан' });
  const remove = useHhMutation('DELETE', `/loans/${loan?.id}`, { success: 'Кредит удалён' });
  const set = <K extends keyof LoanFormValue>(k: K, val: LoanFormValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const rules = v.bankRules ?? { onlyOnPaymentDate: false, minAmountKop: 0, noticeDays: 0 };
  const changes: RateChange[] = v.rateChanges ?? [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: v.name,
      bank: v.bank ?? null,
      principalKop: v.principalKop,
      annualRate: v.annualRate.replace(',', '.'),
      termMonths: v.termMonths,
      type: v.type,
      issueDate: v.issueDate,
      ...(v.paymentDay ? { paymentDay: v.paymentDay } : {}),
      interestMode: v.interestMode,
      rateChanges: changes.filter((c) => c.fromDate && c.annualRate).map((c) => ({ ...c, annualRate: c.annualRate.replace(',', '.') })),
      bankRules: rules,
      ...(loan ? { version: loan.version } : {}),
    };
    save.mutate(body, { onSuccess: onDone });
  };
  const err = save.error;
  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Название" htmlFor="ln-name">
          <Input id="ln-name" required value={v.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Банк" htmlFor="ln-bank" hint="Для себя — сервис не связан с банками">
          <Input id="ln-bank" value={v.bank ?? ''} onChange={(e) => set('bank', e.target.value || null)} />
        </Field>
        <Field label="Сумма кредита" htmlFor="ln-sum" error={err?.field('principalKop')}>
          <MoneyInput id="ln-sum" value={v.principalKop || null} onChange={(k) => set('principalKop', k ?? 0)} />
        </Field>
        <Field label="Ставка, % годовых" htmlFor="ln-rate" error={err?.field('annualRate')}>
          <Input id="ln-rate" inputMode="decimal" required value={v.annualRate} onChange={(e) => set('annualRate', e.target.value.replace(/[^\d.,]/g, ''))} />
        </Field>
        <Field label="Срок, месяцев" htmlFor="ln-term" hint={`${(v.termMonths / 12).toFixed(1).replace('.0', '').replace('.', ',')} лет`}>
          <Input id="ln-term" type="number" min={1} max={600} required value={v.termMonths} onChange={(e) => set('termMonths', Number(e.target.value))} />
        </Field>
        <Field label="Вид платежа" htmlFor="ln-type">
          <Select id="ln-type" value={v.type} onChange={(e) => set('type', e.target.value as LoanDto['type'])}>
            <option value="annuity">Аннуитетный (равными платежами)</option>
            <option value="differentiated">Дифференцированный</option>
          </Select>
        </Field>
        <Field label="Дата выдачи" htmlFor="ln-issue">
          <DateInput id="ln-issue" required value={v.issueDate} onChange={(e) => set('issueDate', e.target.value)} />
        </Field>
        <Field label="День платежа" htmlFor="ln-day" hint="По умолчанию — день выдачи">
          <Input id="ln-day" type="number" min={1} max={31} value={v.paymentDay ?? ''} onChange={(e) => set('paymentDay', e.target.value ? Number(e.target.value) : undefined)} />
        </Field>
{advanced && (
        <Field label="Как банк считает проценты" htmlFor="ln-mode" hint="Смотрите в договоре или сверьте с графиком банка">
          <Select id="ln-mode" value={v.interestMode} onChange={(e) => set('interestMode', e.target.value as LoanDto['interestMode'])}>
            <option value="monthly">Ставка ÷ 12 каждый месяц</option>
            <option value="daily">По фактическим дням</option>
          </Select>
        </Field>
        )}
      </div>

      {advanced && (<>
      <div className="rounded-xl bg-surface-2 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">Изменение ставки</h3>
          <Button type="button" size="sm" variant="ghost" onClick={() => set('rateChanges', [...changes, { fromDate: '', annualRate: '' }])}>
            <Plus className="size-4" aria-hidden /> Добавить
          </Button>
        </div>
        {changes.length === 0 && <p className="text-xs text-muted">Например, после окончания льготного периода или если ставка выросла из-за страховки.</p>}
        {changes.map((c, i) => (
          <div key={i} className="mt-2 flex items-end gap-2">
            <Field label="С даты" htmlFor={`rc-d-${i}`}>
              <DateInput id={`rc-d-${i}`} value={c.fromDate} onChange={(e) => set('rateChanges', changes.map((x, j) => (j === i ? { ...x, fromDate: e.target.value } : x)))} />
            </Field>
            <Field label="Ставка, %" htmlFor={`rc-r-${i}`}>
              <Input id={`rc-r-${i}`} inputMode="decimal" value={c.annualRate} onChange={(e) => set('rateChanges', changes.map((x, j) => (j === i ? { ...x, annualRate: e.target.value.replace(/[^\d.,]/g, '') } : x)))} />
            </Field>
            <Button type="button" variant="ghost" aria-label="Удалить изменение ставки" onClick={() => set('rateChanges', changes.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-surface-2 p-3">
        <h3 className="mb-1 text-sm font-medium">Правила банка для <Term k="prepayment">досрочки</Term></h3>
        <Switch checked={rules.onlyOnPaymentDate} onChange={(c) => set('bankRules', { ...rules, onlyOnPaymentDate: c })} label="Только в дату ежемесячного платежа" />
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label="Минимальная сумма" htmlFor="br-min">
            <MoneyInput id="br-min" value={rules.minAmountKop || null} onChange={(k) => set('bankRules', { ...rules, minAmountKop: k ?? 0 })} />
          </Field>
          <Field label="Заявление за, дней" htmlFor="br-notice" hint="Напомним заранее">
            <Input id="br-notice" type="number" min={0} max={90} value={rules.noticeDays} onChange={(e) => set('bankRules', { ...rules, noticeDays: Number(e.target.value) })} />
          </Field>
        </div>
      </div>
      </>)}

      <div className="flex justify-between gap-2">
        {loan ? (
          <Button type="button" variant="ghost" onClick={() => remove.mutate(undefined, { onSuccess: onDone })}>
            Удалить кредит
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" loading={save.isPending} disabled={!v.principalKop || !v.annualRate}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}

function CsvUpload({ loanId, onClose }: { loanId: string; onClose(): void }) {
  const upload = useHhMutation<{ csv: string }, { imported: number; errors: { line: number; message: string }[] }>('POST', `/loans/${loanId}/bank-schedule`);
  const [result, setResult] = useState<{ imported: number; errors: { line: number; message: string }[] } | null>(null);
  const onFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    // банки часто отдают CSV в Windows-1251
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf);
    upload.mutate({ csv: text }, { onSuccess: setResult });
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="График из банка" description="Нужен файл CSV с колонками «Дата» и «Сумма платежа»; проценты, основной долг и остаток — если есть.">
      <input type="file" accept=".csv,text/csv" aria-label="Файл графика" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} className="block w-full text-sm" />
      {upload.isPending && <Spinner />}
      {result && (
        <div className="mt-4 text-sm">
          <p>Загружено строк: {result.imported}</p>
          {result.errors.length > 0 && <p className="text-warn">Не удалось прочитать строк: {result.errors.length}</p>}
          <Button className="mt-3" onClick={onClose}>
            Посмотреть сверку
          </Button>
        </div>
      )}
    </Modal>
  );
}

function BankDiff({ loanId }: { loanId: string }) {
  const diff = useHh<ReconcileResult>(`/loans/${loanId}/bank-schedule/diff`);
  if (diff.error || !diff.data) return null;
  const d = diff.data;
  const bad = d.items.filter((i) => !i.ok).slice(0, 10);
  return (
    <div className="mt-4 space-y-2 text-sm">
      <p>
        Совпало строк: <Badge tone="ok">{d.matched}</Badge> · расхождений: <Badge tone={d.mismatched ? 'warn' : 'ok'}>{d.mismatched}</Badge>
      </p>
      {d.hint && <p className="rounded-lg bg-info-soft p-3">{d.hint}</p>}
      {bad.length > 0 && (
        <ul className="space-y-1 text-ink-2">
          {bad.map((i) => (
            <li key={i.bank.date}>
              {formatDateNum(i.bank.date)}: {i.calculatedDate === null ? 'нет такой даты в расчёте' : <>платёж {i.paymentDiffKop ? formatRub(i.paymentDiffKop) : 'совпадает'}{i.interestDiffKop ? `, проценты ${formatRub(i.interestDiffKop)}` : ''}</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
