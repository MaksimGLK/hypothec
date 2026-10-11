import { addMonths, BUDGET_GROUP_LABELS, type BudgetCatalogItem, type BudgetMonth, formatDateRu, formatMonthRu, formatRub, type SpendingDraft } from '@hypothec/core';
import { ChevronLeft, ChevronRight, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useAuth } from '../api/auth.js';
import { useHh, useHhMutation } from '../api/household.js';
import type { LivingDto } from '../api/types.js';
import { Term } from '../components/learning.js';
import { Badge, Button, Card, ConfirmButton, cx, Empty, ErrorBox, Field, Input, Modal, Money, MoneyInput, PageHeader, Progress, Select, Spinner, Switch } from '../components/ui/index.js';
import { useToast } from '../components/ui/toast.js';
import { Tabs } from '../layout/AppLayout.js';
import { DistributionCard } from '../components/distribution.js';
import { MONEY_TABS } from './money/IncomesPage.js';

interface SpendingDto {
  id: string;
  categoryId: string | null;
  date: string;
  amountKop: number;
  note?: string;
  source?: 'manual' | 'plan' | 'auto';
  version: number;
}
type Summary = BudgetMonth & { averages: Record<string, { averageKop: number; months: number }> };

const today = () => new Date().toISOString().slice(0, 10);

export default function BudgetPage() {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const cats = useHh<LivingDto[]>('/living-expenses');
  const summary = useHh<Summary>(`/budget/summary?month=${month}`);
  const spendings = useHh<SpendingDto[]>(`/budget/spendings?month=${month}`);
  const bootstrap = useHhMutation<Record<string, never>>('POST', '/budget/bootstrap', { success: 'Категории добавлены — впишите, сколько примерно уходит в месяц' });
  const [edit, setEdit] = useState<Partial<LivingDto> | null>(null);
  const [adding, setAdding] = useState(false);
  const isCurrent = month === today().slice(0, 7);

  if (cats.isLoading) return <Spinner />;
  if (cats.error) return <ErrorBox error={cats.error} />;
  const list = cats.data ?? [];
  const s = summary.data;
  const catName = (id: string | null) => list.find((c) => c.id === id)?.name ?? 'Без категории';
  // в основном списке — категории с планом или тратами; пустые свёрнуты, чтобы не мешали
  const hasActivity = (c: LivingDto) => c.amountKop > 0 || (s?.categories.find((r) => r.categoryId === c.id)?.factKop ?? 0) > 0;
  const withPlan = list.filter(hasActivity);
  const withoutPlan = list.filter((c) => !hasActivity(c));

  return (
    <div>
      <Tabs items={MONEY_TABS} />
      <PageHeader
        title="Бюджет"
        subtitle="Сколько уходит на жизнь: план на месяц и сколько потрачено на самом деле."
        action={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Предыдущий месяц" onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="w-32 text-center text-sm font-medium capitalize">{formatMonthRu(`${month}-01`)}</span>
            <Button size="sm" variant="ghost" aria-label="Следующий месяц" onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      {list.length === 0 ? (
        <Empty
          title="Бюджет пока пустой"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => bootstrap.mutate({})} loading={bootstrap.isPending}>
                Начать с типовых категорий
              </Button>
              <Button variant="secondary" onClick={() => setAdding(true)}>
                Своя категория
              </Button>
            </div>
          }
        >
          Коммуналка, продукты, транспорт, кружки детей, кафе — впишите, сколько примерно уходит в месяц. Без этого подушка и распределение доходов считают только ипотеку.
        </Empty>
      ) : (
        <div className="space-y-4">
          <DistributionCard month={month} />
          {s && <SummaryCard s={s} isCurrent={isCurrent} />}
          <QuickAdd categories={list} month={month} isCurrent={isCurrent} />

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Категории</h2>
              <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden /> Категория
              </Button>
            </div>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {withPlan.map((c) => (
                <CategoryRow key={c.id} cat={c} row={s?.categories.find((r) => r.categoryId === c.id)} avg={s?.averages[c.id]} onEdit={() => setEdit(c)} isCurrentMonth={isCurrent} />
              ))}
            </ul>
            {withoutPlan.length > 0 && (
              <details className="mt-3 rounded-2xl border border-dashed border-border" open={withPlan.length === 0}>
                <summary className="cursor-pointer px-4 py-3 text-sm text-ink-2">
                  Без плана: {withoutPlan.map((c) => c.name).join(', ')} — нажмите, чтобы вписать сумму
                </summary>
                <ul className="divide-y divide-border border-t border-border">
                  {withoutPlan.map((c) => (
                    <CategoryRow key={c.id} cat={c} row={s?.categories.find((r) => r.categoryId === c.id)} avg={s?.averages[c.id]} onEdit={() => setEdit(c)} isCurrentMonth={isCurrent} />
                  ))}
                </ul>
              </details>
            )}
            <p className="mt-2 text-xs text-muted">
              <Badge>обязательно</Badge> — траты, без которых не обойтись: они входят в <Term k="cushion">подушку безопасности</Term>. Остальные в трудный месяц можно урезать.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">Траты за месяц</h2>
            {spendings.isLoading ? (
              <Spinner />
            ) : (spendings.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-2">Пока ничего не внесено.</p>
            ) : (
              <SpendingList items={spendings.data!} catName={catName} />
            )}
          </section>
        </div>
      )}

      {edit && <CategoryModal value={edit} onClose={() => setEdit(null)} />}
      {adding && <AddCategoryModal existing={list} onClose={() => setAdding(false)} onCustom={() => (setAdding(false), setEdit({ name: '', amountKop: 0, essential: true }))} />}
    </div>
  );
}

function SummaryCard({ s, isCurrent }: { s: Summary; isCurrent: boolean }) {
  const over = s.leftKop < 0;
  return (
    <Card>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-muted">План</div>
          <Money kop={s.planKop} className="text-lg font-semibold" />
        </div>
        <div>
          <div className="text-xs text-muted">Потрачено</div>
          <Money kop={s.factKop} className="text-lg font-semibold" />
        </div>
        <div>
          <div className="text-xs text-muted">{over ? 'Сверх плана' : 'Осталось'}</div>
          <Money kop={Math.abs(s.leftKop)} className={cx('text-lg font-semibold', over ? 'text-danger' : 'text-ok')} />
        </div>
      </div>
      <div className="mt-3">
        <Progress value={s.planKop ? s.factKop / s.planKop : 0} tone={over ? 'warn' : 'primary'} label="Бюджет месяца" />
      </div>
      <PlanBreakdown s={s} />
      {isCurrent && s.daysLeft !== null && s.planKop > 0 && (
        <p className="mt-2 text-sm text-ink-2">
          {over ? (
            <>План уже превышен. Посмотрите, в каких категориях, — может, план стоит поправить на реальные цифры.</>
          ) : (
            <>
              До конца месяца {s.daysLeft} дн. — чтобы уложиться, можно тратить около <Money kop={s.dailyAllowanceKop} className="font-medium text-ink" /> в день.
            </>
          )}
        </p>
      )}
      {s.planKop === 0 && <p className="mt-2 text-sm text-warn">Впишите план по категориям — нажмите на категорию.</p>}
    </Card>
  );
}

const SEGMENT_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', '#7a8a6a', '#b07a5a', '#6a7fa0', '#9a6a8a'];

/** Из чего складывается план месяца: полоса долей и список категорий с суммами. */
function PlanBreakdown({ s }: { s: Summary }) {
  const parts = s.categories.filter((c) => c.planKop > 0).sort((a, b) => b.planKop - a.planKop);
  if (!parts.length) return null;
  const essential = parts.filter((c) => c.essential).reduce((sum, c) => sum + c.planKop, 0);
  const flexible = s.planKop - essential;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-sm font-medium">Из чего складывается план</p>
      <div className="flex h-3 w-full overflow-hidden rounded-full" role="img" aria-label="Доли категорий в плане">
        {parts.map((c, i) => (
          <div key={c.categoryId} style={{ width: `${(c.planKop / s.planKop) * 100}%`, background: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }} title={c.name} />
        ))}
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {parts.map((c, i) => (
          <li key={c.categoryId} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }} aria-hidden />
            <span className="flex-1 truncate">{c.name}</span>
            <Money kop={c.planKop} className="text-ink-2" />
            <span className="w-10 text-right text-xs text-muted">{Math.round((c.planKop / s.planKop) * 100)}%</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Обязательные — <Money kop={essential} />
        {flexible > 0 && (
          <>
            , необязательные — <Money kop={flexible} />
          </>
        )}
        . В подушку безопасности входят только обязательные.
      </p>
    </div>
  );
}

function QuickAdd({ categories, month, isCurrent }: { categories: LivingDto[]; month: string; isCurrent: boolean }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [manual, setManual] = useState<{ categoryId: string; amountKop: number | null; date: string; note: string } | null>(null);
  const parse = useHhMutation<{ text: string }, SpendingDraft>('POST', '/budget/parse', { silent: true });
  const add = useHhMutation<Record<string, unknown>>('POST', '/budget/spendings');
  const defaultDate = isCurrent ? today() : `${month}-01`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const d = await parse.mutateAsync({ text });
    if (d.categoryId && d.amountKop) {
      await add.mutateAsync({ categoryId: d.categoryId, amountKop: d.amountKop, date: defaultDate, note: d.note || null });
      toast.show(`${formatRub(d.amountKop, { kopecks: 'auto' })} → «${categories.find((c) => c.id === d.categoryId)?.name}»`);
      setText('');
    } else {
      // не узнали категорию или сумму — уточняем вручную
      setManual({ categoryId: d.categoryId ?? categories[0]?.id ?? '', amountKop: d.amountKop, date: defaultDate, note: d.note });
    }
  };

  return (
    <Card title="Добавить трату">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <Input aria-label="Трата одной строкой" placeholder="Например: продукты 3 450 или бассейн 4000" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" className="shrink-0" loading={parse.isPending || add.isPending}>
          <Sparkles className="size-4" aria-hidden /> Добавить
        </Button>
      </form>
      <button type="button" className="mt-2 text-sm text-primary" onClick={() => setManual({ categoryId: categories[0]?.id ?? '', amountKop: null, date: defaultDate, note: '' })}>
        Выбрать категорию вручную
      </button>
      {manual && (
        <Modal open onOpenChange={(o) => !o && setManual(null)} title="Трата">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate(
                { categoryId: manual.categoryId || null, amountKop: manual.amountKop, date: manual.date, note: manual.note || null },
                { onSuccess: () => (setManual(null), setText(''), toast.show('Трата добавлена')) },
              );
            }}
          >
            <Field label="Категория" htmlFor="sp-cat">
              <Select id="sp-cat" value={manual.categoryId} onChange={(e) => setManual({ ...manual, categoryId: e.target.value })}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="">Без категории</option>
              </Select>
            </Field>
            <Field label="Сумма" htmlFor="sp-amount">
              <MoneyInput id="sp-amount" autoFocus value={manual.amountKop} onChange={(k) => setManual({ ...manual, amountKop: k })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Дата" htmlFor="sp-date">
                <Input id="sp-date" type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
              </Field>
              <Field label="Комментарий" htmlFor="sp-note">
                <Input id="sp-note" value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={add.isPending} disabled={!manual.amountKop}>
                Сохранить
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}

/** Постоянные счета, которые платят одним платежом в месяц, — для них есть кнопка «Оплачено». */
const BILL_KEYS = new Set(['utilities', 'rent', 'mobile', 'kids_activities', 'kids_school', 'subscriptions']);
const isBill = (c: LivingDto) => Boolean(c.autoPayDay) || !c.catalogKey || BILL_KEYS.has(c.catalogKey);

function CategoryRow({ cat, row, avg, onEdit, isCurrentMonth }: { cat: LivingDto; row: BudgetMonth['categories'][number] | undefined; avg: { averageKop: number; months: number } | undefined; onEdit(): void; isCurrentMonth: boolean }) {
  const { uiMode } = useAuth();
  const setPlan = useHhMutation<{ amountKop: number; version: number }>('PATCH', `/living-expenses/${cat.id}`, { success: 'План обновлён' });
  const pay = useHhMutation<Record<string, unknown>>('POST', '/budget/spendings', { success: `«${cat.name}» — отмечено оплаченным` });
  const fact = row?.factKop ?? 0;
  const plan = row?.planKop ?? cat.amountKop;
  const over = fact > plan && plan > 0;
  const avgDiffers = avg && avg.months >= 2 && Math.abs(avg.averageKop - cat.amountKop) > Math.max(100_000, cat.amountKop * 0.15);
  return (
    <li className="px-4 py-3">
      <button type="button" onClick={onEdit} className="flex w-full items-start justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="font-medium">{cat.name}</span>{' '}
          {cat.essential !== false && <Badge>обязательно</Badge>}
          {cat.autoPayDay && <span className="ml-1 text-xs text-muted">автоплатёж {cat.autoPayDay}-го</span>}
          {cat.endsAtKeys && <span className="ml-1 text-xs text-muted">до переезда</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-sm">
          <span className={over ? 'text-danger' : 'text-ink-2'}>
            <Money kop={fact} /> из {plan ? <Money kop={plan} /> : <span className="text-warn">впишите план</span>}
          </span>
          <Pencil className="size-4 text-muted" aria-hidden />
        </span>
      </button>
      {plan > 0 && (
        <div className="mt-2 flex items-center gap-3">
          <div className="flex-1">
            <Progress value={fact / plan} tone={over ? 'warn' : 'primary'} label={`${cat.name}: потрачено`} />
          </div>
          {isCurrentMonth && fact === 0 && isBill(cat) && (
            <Button
              size="sm"
              variant="secondary"
              loading={pay.isPending}
              onClick={() => pay.mutate({ categoryId: cat.id, amountKop: plan, date: new Date().toISOString().slice(0, 10), source: 'plan', note: 'Оплачено по плану' })}
              aria-label={`Отметить «${cat.name}» оплаченной на ${Math.round(plan / 100)} рублей`}
            >
              Оплачено
            </Button>
          )}
          {fact >= plan && fact > 0 && <span className="text-xs text-ok">✓ оплачено</span>}
        </div>
      )}
      {avgDiffers && (
        <p className="mt-2 text-xs text-ink-2">
          По факту за {avg!.months} мес. в среднем <Money kop={avg!.averageKop} className="font-medium" />.{' '}
          <button type="button" className="text-primary" onClick={() => setPlan.mutate({ amountKop: avg!.averageKop, version: cat.version })}>
            Поставить в план
          </button>
        </p>
      )}
      {uiMode === 'advanced' && cat.group && <p className="mt-1 text-xs text-muted">{BUDGET_GROUP_LABELS[cat.group as keyof typeof BUDGET_GROUP_LABELS] ?? cat.group}</p>}
    </li>
  );
}

function SpendingList({ items, catName }: { items: SpendingDto[]; catName(id: string | null): string }) {
  const byDate = useMemo(() => {
    const m = new Map<string, SpendingDto[]>();
    for (const s of items) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return [...m.entries()];
  }, [items]);
  return (
    <div className="space-y-3">
      {byDate.map(([date, list]) => (
        <div key={date}>
          <p className="mb-1 text-xs font-medium text-muted">{formatDateRu(date, { year: false })}</p>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {list.map((s) => (
              <SpendingRow key={s.id} s={s} catName={catName} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SpendingRow({ s, catName }: { s: SpendingDto; catName(id: string | null): string }) {
  const remove = useHhMutation('DELETE', `/budget/spendings/${s.id}`, { success: 'Удалено' });
  const update = useHhMutation<{ amountKop: number; version: number }>('PATCH', `/budget/spendings/${s.id}`, { success: 'Сумма исправлена' });
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState<number | null>(s.amountKop);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block">
          {catName(s.categoryId)} {s.source === 'auto' && <Badge tone="primary">автоплатёж</Badge>}
          {s.source === 'plan' && <Badge>по плану</Badge>}
        </span>
        {s.note && s.source === 'manual' && <span className="block truncate text-xs text-muted">{s.note}</span>}
      </span>
      <button type="button" onClick={() => setEditing(true)} className="font-medium underline-offset-2 hover:underline" aria-label="Изменить сумму">
        <Money kop={s.amountKop} kopecks="auto" />
      </button>
      {editing && (
        <Modal open onOpenChange={setEditing} title={`${catName(s.categoryId)}: сумма`}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (amount) update.mutate({ amountKop: amount, version: s.version }, { onSuccess: () => setEditing(false) });
            }}
          >
            <MoneyInput aria-label="Сумма" autoFocus value={amount} onChange={setAmount} />
            <p className="text-xs text-muted">Например, счёт за коммуналку пришёл не на плановую сумму.</p>
            <div className="flex justify-end">
              <Button type="submit" loading={update.isPending} disabled={!amount}>
                Сохранить
              </Button>
            </div>
          </form>
        </Modal>
      )}
      <Button size="sm" variant="ghost" aria-label="Удалить трату" onClick={() => remove.mutate(undefined)}>
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

function CategoryModal({ value, onClose }: { value: Partial<LivingDto>; onClose(): void }) {
  const [v, setV] = useState(value);
  const [unit, setUnit] = useState<number | null>(null);
  const [times, setTimes] = useState(0);
  const isEdit = Boolean(value.id);
  const save = useHhMutation<Record<string, unknown>>(isEdit ? 'PATCH' : 'POST', isEdit ? `/living-expenses/${value.id}` : '/living-expenses', { success: 'Сохранено' });
  const remove = useHhMutation('DELETE', `/living-expenses/${value.id}`, { success: 'Категория удалена' });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={isEdit ? v.name || 'Категория' : 'Новая категория'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            {
              name: v.name,
              amountKop: v.amountKop ?? 0,
              essential: v.essential ?? true,
              endsAtKeys: v.endsAtKeys ?? false,
              autoPayDay: v.autoPayDay ?? null,
              ...(isEdit ? { version: value.version } : { group: 'other' }),
            },
            { onSuccess: onClose },
          );
        }}
      >
        <Field label="Название" htmlFor="bc-name">
          <Input id="bc-name" required value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="План на месяц" htmlFor="bc-plan" hint="Примерно, сколько уходит в обычный месяц">
          <MoneyInput id="bc-plan" autoFocus value={v.amountKop ?? null} onChange={(k) => setV({ ...v, amountKop: k ?? 0 })} />
        </Field>
        <details className="rounded-xl bg-surface-2 px-3 py-2">
          <summary className="cursor-pointer text-sm text-primary">Посчитать: цена × сколько раз в месяц</summary>
          <div className="mt-2 grid grid-cols-[1fr_auto_90px] items-end gap-2">
            <Field label="Цена" htmlFor="bc-price">
              <MoneyInput id="bc-price" value={unit} onChange={(k) => (setUnit(k), k && times && setV({ ...v, amountKop: k * times }))} />
            </Field>
            <span className="pb-3 text-muted">×</span>
            <Field label="Раз в месяц" htmlFor="bc-times">
              <Input id="bc-times" inputMode="numeric" value={times || ''} onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '')) || 0; setTimes(n); if (unit && n) setV({ ...v, amountKop: unit * n }); }} />
            </Field>
          </div>
          <p className="mt-1 text-xs text-muted">Например, обед 500 ₽ × 22 рабочих дня = 11 000 ₽, закупка продуктов 7 000 ₽ × 4 раза.</p>
        </details>
        <Switch checked={v.essential ?? true} onChange={(c) => setV({ ...v, essential: c })} label="Обязательная трата (входит в подушку безопасности)" />
        <Switch checked={v.endsAtKeys ?? false} onChange={(c) => setV({ ...v, endsAtKeys: c })} label="Закончится после переезда (например, аренда)" />
        <div className="rounded-xl bg-surface-2 p-3">
          <Switch checked={Boolean(v.autoPayDay)} onChange={(c) => setV({ ...v, autoPayDay: c ? (v.autoPayDay ?? 10) : null })} label="Автоплатёж каждый месяц" />
          {v.autoPayDay ? (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <label htmlFor="bc-day">Какого числа</label>
              <Input id="bc-day" type="number" min={1} max={31} className="h-9 w-20" value={v.autoPayDay} onChange={(e) => setV({ ...v, autoPayDay: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })} />
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            Для постоянных счетов — коммуналка, связь, аренда, кружки. В этот день сама запишется трата на сумму плана. Если уже отметили оплату вручную — второй раз не запишется. Сумму можно поправить в списке трат.
          </p>
        </div>
        <div className="flex justify-between gap-2">
          {isEdit ? (
            <ConfirmButton confirm={`Удалить категорию «${v.name}»? Траты останутся без категории.`} onConfirm={() => remove.mutate(undefined, { onSuccess: onClose })}>
              Удалить
            </ConfirmButton>
          ) : (
            <span />
          )}
          <Button type="submit" loading={save.isPending}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AddCategoryModal({ existing, onClose, onCustom }: { existing: LivingDto[]; onClose(): void; onCustom(): void }) {
  const catalog = useHh<BudgetCatalogItem[]>('/budget/catalog');
  const add = useHhMutation<{ keys: string[] }>('POST', '/budget/bootstrap', { success: 'Категория добавлена' });
  const have = new Set(existing.map((e) => e.catalogKey));
  const items = (catalog.data ?? []).filter((c) => !have.has(c.key));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Добавить категорию">
      <ul className="divide-y divide-border">
        {items.map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-3 py-2.5">
            <span>
              {c.name} {c.essential && <Badge>обязательно</Badge>}
            </span>
            <Button size="sm" variant="secondary" onClick={() => add.mutate({ keys: [c.key] })}>
              Добавить
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" className="mt-3" onClick={onCustom}>
        <Plus className="size-4" aria-hidden /> Своя категория
      </Button>
    </Modal>
  );
}
