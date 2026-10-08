import { expenseTotals, type ExpenseCatalogItem, type ExpenseInput } from '@hypothec/core';
import { useQuery } from '@tanstack/react-query';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '../../api/client.js';
import { useHh, useHhMutation } from '../../api/household.js';
import type { ExpenseDto, LivingDto, LoanDto, StageDto } from '../../api/types.js';
import { Term } from '../../components/learning.js';
import { Badge, Button, Card, ConfirmButton, DateText, Empty, ErrorBox, Field, Input, Modal, Money, MoneyInput, PageHeader, Segmented, Select, Spinner, Switch } from '../../components/ui/index.js';
import { Tabs } from '../../layout/AppLayout.js';
import { MONEY_TABS } from './IncomesPage.js';

type Section = 'deal' | 'after' | 'monthly';
const PRIORITY: Record<number, { label: string; tone: 'danger' | 'warn' | 'neutral' }> = {
  1: { label: 'сначала', tone: 'danger' },
  2: { label: 'потом', tone: 'warn' },
  3: { label: 'может подождать', tone: 'neutral' },
};

export default function ExpensesPage() {
  const expenses = useHh<ExpenseDto[]>('/expenses');
  const living = useHh<LivingDto[]>('/living-expenses');
  const [section, setSection] = useState<Section>('deal');
  const [edit, setEdit] = useState<Partial<ExpenseDto> | null>(null);
  const [editLiving, setEditLiving] = useState<Partial<LivingDto> | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  if (expenses.isLoading || living.isLoading) return <Spinner />;
  if (expenses.error) return <ErrorBox error={expenses.error} />;
  const all = expenses.data ?? [];
  const deal = all.filter((e) => e.category !== 'after_keys');
  const after = all.filter((e) => e.category === 'after_keys').sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
  const dealTotals = expenseTotals(deal.filter((e) => e.recurrence === 'once') as ExpenseInput[]);
  const afterTotals = expenseTotals(after as ExpenseInput[]);
  const livingTotal = (living.data ?? []).reduce((s, l) => s + l.amountKop, 0);

  return (
    <div>
      <Tabs items={MONEY_TABS} />
      <PageHeader
        title="Расходы"
        action={
          section === 'monthly' ? (
            <Button size="sm" variant="secondary" onClick={() => setEditLiving({ name: '', amountKop: 0 })}>
              <Plus className="size-4" aria-hidden /> Добавить
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setCatalogOpen(true)}>
                Из справочника
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEdit({ category: section === 'after' ? 'after_keys' : 'mandatory', recurrence: 'once', planKop: 0, name: '', ...(section === 'after' ? { priority: 2 as const } : {}) })}>
                <Plus className="size-4" aria-hidden /> Свой
              </Button>
            </div>
          )
        }
      />
      <div className="mb-4">
        <Segmented
          label="Раздел"
          value={section}
          onChange={setSection}
          options={[
            { value: 'deal', label: 'Сделка' },
            { value: 'after', label: 'После ключей' },
            { value: 'monthly', label: 'Каждый месяц' },
          ]}
        />
      </div>

      {section === 'deal' && (
        <>
          <Totals plan={dealTotals.planKop} fact={dealTotals.factKop} left={dealTotals.unpaidPlanKop} overspend={dealTotals.overspendKop} />
          {(['mandatory', 'optional'] as const).map((cat) => {
            const items = deal.filter((e) => e.category === cat);
            if (!items.length) return null;
            return (
              <section key={cat} className="mt-5">
                <h2 className="mb-2 text-sm font-medium text-muted">{cat === 'mandatory' ? 'Обязательные' : 'По желанию'}</h2>
                <ExpenseList items={items} onEdit={setEdit} />
              </section>
            );
          })}
          {deal.length === 0 && <Empty title="Расходов сделки нет">Добавьте их из справочника: оценка, страховка, госпошлина и другие.</Empty>}
        </>
      )}

      {section === 'after' && (
        <>
          <p className="mb-3 text-sm text-ink-2">Сначала — то, без чего жить неудобно: кухня, кровати, свет. Остальное — по мере накоплений на счёте «Обустройство».</p>
          <Totals plan={afterTotals.planKop} fact={afterTotals.factKop} left={afterTotals.unpaidPlanKop} overspend={afterTotals.overspendKop} />
          <div className="mt-4">{after.length ? <ExpenseList items={after} onEdit={setEdit} /> : <Empty title="Пока пусто" />}</div>
        </>
      )}

      {section === 'monthly' && (
        <>
          <Card className="mb-4">
            <p className="text-sm text-ink-2">
              Базовые траты семьи в месяц: еда, коммуналка, транспорт, аренда до переезда. Нужны, чтобы посчитать <Term k="cushion">подушку</Term> и распределение доходов.
            </p>
            <p className="mt-2 text-lg font-semibold">
              Итого: <Money kop={livingTotal} /> в месяц
            </p>
          </Card>
          {(living.data ?? []).length === 0 ? (
            <Empty title="Не указаны траты" action={<Button size="sm" onClick={() => setEditLiving({ name: 'Базовые траты', amountKop: 0 })}>Указать</Button>}>
              Можно одной суммой — примерно, сколько уходит в месяц на жизнь.
            </Empty>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {living.data!.map((l) => (
                <LivingRow key={l.id} item={l} onEdit={() => setEditLiving(l)} />
              ))}
            </ul>
          )}
        </>
      )}

      {edit && <ExpenseModal value={edit} onClose={() => setEdit(null)} />}
      {editLiving && <LivingModal value={editLiving} onClose={() => setEditLiving(null)} />}
      {catalogOpen && <CatalogModal existing={all} onClose={() => setCatalogOpen(false)} afterKeys={section === 'after'} />}
    </div>
  );
}

function Totals({ plan, fact, left, overspend }: { plan: number; fact: number; left: number; overspend: number }) {
  return (
    <div className="grid grid-cols-3 gap-3 rounded-2xl border border-border bg-surface p-4">
      <div>
        <div className="text-xs text-muted">План</div>
        <Money kop={plan} className="font-semibold" />
      </div>
      <div>
        <div className="text-xs text-muted">Потрачено</div>
        <Money kop={fact} className="font-semibold" />
        {overspend !== 0 && <div className={`text-xs ${overspend > 0 ? 'text-danger' : 'text-ok'}`}>{overspend > 0 ? 'больше плана на ' : 'меньше плана на '}{Math.abs(Math.round(overspend / 100)).toLocaleString('ru-RU')} ₽</div>}
      </div>
      <div>
        <div className="text-xs text-muted">Осталось оплатить</div>
        <Money kop={left} className="font-semibold" />
      </div>
    </div>
  );
}

function ExpenseList({ items, onEdit }: { items: ExpenseDto[]; onEdit(e: ExpenseDto): void }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {items.map((e) => (
        <ExpenseRow key={e.id} e={e} onEdit={() => onEdit(e)} />
      ))}
    </ul>
  );
}

function ExpenseRow({ e, onEdit }: { e: ExpenseDto; onEdit(): void }) {
  const pay = useHhMutation<{ factKop: number | null; version: number }>('PATCH', `/expenses/${e.id}`);
  const remove = useHhMutation('DELETE', `/expenses/${e.id}`, { success: 'Удалено' });
  const paid = e.factKop !== null && e.factKop !== undefined;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        onClick={() => pay.mutate({ factKop: paid ? null : e.planKop, version: e.version })}
        aria-label={paid ? 'Отметить неоплаченным' : 'Отметить оплаченным по плану'}
        className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${paid ? 'border-ok bg-ok text-white' : 'border-border'}`}
      >
        {paid && <Check className="size-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={paid ? 'text-ink-2' : 'font-medium'}>{e.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-2">
          {e.recurrence === 'yearly' && <Badge>каждый год</Badge>}
          {e.recurrence === 'monthly' && <Badge>каждый месяц</Badge>}
          {e.priority && e.category === 'after_keys' && <Badge tone={PRIORITY[e.priority]!.tone}>{PRIORITY[e.priority]!.label}</Badge>}
          {e.credit && <Badge tone="warn">в кредит</Badge>}
          {e.atKeys ? 'к ключам' : e.date && <DateText date={e.date} />}
        </p>
      </div>
      <div className="text-right">
        {e.percentOfLoanBalance ? <span className="text-sm text-ink-2">{e.percentOfLoanBalance.replace('.', ',')}% от долга</span> : <Money kop={paid ? e.factKop : e.planKop} className="font-medium" />}
        {paid && e.factKop !== e.planKop && !e.percentOfLoanBalance && <div className="text-xs text-muted">план <Money kop={e.planKop} /></div>}
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Изменить: ${e.name}`}>
        <Pencil className="size-4" />
      </Button>
      <ConfirmButton confirm={`Удалить «${e.name}»?`} onConfirm={() => remove.mutate(undefined)}>
        <Trash2 className="size-4" aria-label="Удалить" />
      </ConfirmButton>
    </li>
  );
}

function ExpenseModal({ value, onClose }: { value: Partial<ExpenseDto>; onClose(): void }) {
  const [v, setV] = useState(value);
  const stages = useHh<StageDto[]>('/stages');
  const loans = useHh<LoanDto[]>('/loans');
  const isEdit = Boolean(value.id);
  const save = useHhMutation<Record<string, unknown>>(isEdit ? 'PATCH' : 'POST', isEdit ? `/expenses/${value.id}` : '/expenses', { success: 'Сохранено' });
  const set = <K extends keyof ExpenseDto>(k: K, val: ExpenseDto[K] | undefined) => setV((x) => ({ ...x, [k]: val }));
  const pct = Boolean(v.percentOfLoanBalance);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: v.name,
      category: v.category,
      planKop: v.planKop ?? 0,
      factKop: v.factKop ?? null,
      date: v.atKeys ? null : (v.date ?? null),
      recurrence: v.recurrence,
      stageId: v.stageId ?? null,
      loanId: v.loanId ?? null,
      percentOfLoanBalance: v.percentOfLoanBalance ?? null,
      credit: v.credit ?? null,
      atKeys: v.atKeys ?? false,
      ...(v.priority ? { priority: v.priority } : {}),
      ...(isEdit ? { version: value.version } : {}),
    };
    save.mutate(body, { onSuccess: onClose });
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={isEdit ? 'Расход' : 'Новый расход'}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Название" htmlFor="ex-name">
          <Input id="ex-name" required value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Раздел" htmlFor="ex-cat">
            <Select id="ex-cat" value={v.category} onChange={(e) => set('category', e.target.value as ExpenseDto['category'])}>
              <option value="mandatory">Обязательный</option>
              <option value="optional">По желанию</option>
              <option value="after_keys">После ключей</option>
            </Select>
          </Field>
          <Field label="Повторяется" htmlFor="ex-rec">
            <Select id="ex-rec" value={v.recurrence} onChange={(e) => set('recurrence', e.target.value as ExpenseDto['recurrence'])}>
              <option value="once">Разово</option>
              <option value="monthly">Каждый месяц</option>
              <option value="yearly">Каждый год</option>
            </Select>
          </Field>
          {pct ? (
            <Field label="% от остатка долга" htmlFor="ex-pct" hint="Страховка дешевеет вместе с долгом">
              <Input id="ex-pct" inputMode="decimal" value={v.percentOfLoanBalance ?? ''} onChange={(e) => set('percentOfLoanBalance', e.target.value.replace(',', '.'))} />
            </Field>
          ) : (
            <Field label="Сумма по плану" htmlFor="ex-plan">
              <MoneyInput id="ex-plan" value={v.planKop ?? null} onChange={(k) => set('planKop', k ?? 0)} />
            </Field>
          )}
          <Field label="Потрачено по факту" htmlFor="ex-fact" hint="Оставьте пустым, пока не оплачено">
            <MoneyInput id="ex-fact" value={v.factKop ?? null} onChange={(k) => set('factKop', k)} />
          </Field>
          <Field label="Дата" htmlFor="ex-date">
            <Input id="ex-date" type="date" disabled={v.atKeys} value={v.date ?? ''} onChange={(e) => set('date', e.target.value || null)} />
          </Field>
          <Field label="Этап" htmlFor="ex-stage">
            <Select id="ex-stage" value={v.stageId ?? ''} onChange={(e) => set('stageId', e.target.value || null)}>
              <option value="">без этапа</option>
              {stages.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </Select>
          </Field>
          {v.category === 'after_keys' && (
            <Field label="Приоритет" htmlFor="ex-prio">
              <Select id="ex-prio" value={v.priority ?? 2} onChange={(e) => set('priority', Number(e.target.value) as 1 | 2 | 3)}>
                <option value={1}>Сначала (самое нужное)</option>
                <option value={2}>Потом</option>
                <option value={3}>Может подождать</option>
              </Select>
            </Field>
          )}
          {v.recurrence === 'yearly' && (loans.data?.length ?? 0) > 0 && (
            <Field label="Страховка по кредиту" htmlFor="ex-loan" hint="Повторяется, пока не погашен кредит">
              <Select id="ex-loan" value={v.loanId ?? ''} onChange={(e) => set('loanId', e.target.value || null)}>
                <option value="">не привязана</option>
                {loans.data!.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div className="space-y-2 rounded-xl bg-surface-2 p-3">
          {v.category === 'after_keys' && <Switch checked={v.atKeys ?? false} onChange={(c) => set('atKeys', c)} label="Дата — когда получим ключи" />}
          {v.recurrence === 'yearly' && <Switch checked={pct} onChange={(c) => set('percentOfLoanBalance', c ? '0.15' : null)} label="Сумма — процент от остатка долга" />}
          <Switch checked={Boolean(v.credit)} onChange={(c) => set('credit', c ? { annualRate: '20', months: 12 } : null)} label="Покупаю в кредит или рассрочку" />
          {v.credit && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ставка, %" htmlFor="ex-cr">
                <Input id="ex-cr" inputMode="decimal" value={v.credit.annualRate} onChange={(e) => set('credit', { ...v.credit!, annualRate: e.target.value.replace(',', '.') || '0' })} />
              </Field>
              <Field label="Срок, мес." htmlFor="ex-cm">
                <Input id="ex-cm" type="number" min={1} max={120} value={v.credit.months} onChange={(e) => set('credit', { ...v.credit!, months: Number(e.target.value) || 1 })} />
              </Field>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" loading={save.isPending}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CatalogModal({ existing, onClose, afterKeys }: { existing: ExpenseDto[]; onClose(): void; afterKeys: boolean }) {
  const catalog = useQuery({ queryKey: ['catalog-expenses'], queryFn: () => api<ExpenseCatalogItem[]>('/catalog/expenses'), staleTime: Infinity });
  const loans = useHh<LoanDto[]>('/loans');
  const add = useHhMutation<Record<string, unknown>>('POST', '/expenses', { success: 'Добавлено' });
  const have = new Set(existing.map((e) => e.catalogKey));
  const items = (catalog.data ?? []).filter((i) => (afterKeys ? i.category === 'after_keys' : i.category !== 'after_keys') && i.key !== 'down_payment');
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Справочник расходов" description="Суммы — ориентир для плана, поменяйте на свои.">
      <ul className="divide-y divide-border">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {i.name} {i.category === 'mandatory' && <Badge tone="primary">обязательно</Badge>}
              </p>
              <p className="mt-0.5 text-sm text-ink-2">{i.hint}</p>
            </div>
            <Button
              size="sm"
              variant={have.has(i.key) ? 'ghost' : 'secondary'}
              disabled={have.has(i.key)}
              onClick={() =>
                add.mutate({
                  name: i.name,
                  category: i.category,
                  catalogKey: i.key,
                  planKop: i.defaultPlanKop,
                  recurrence: i.recurrence,
                  ...(i.priority ? { priority: i.priority } : {}),
                  ...(i.percentOfLoanBalance ? { percentOfLoanBalance: i.percentOfLoanBalance, loanId: loans.data?.[0]?.id ?? null } : {}),
                  ...(i.category === 'after_keys' ? { atKeys: true } : {}),
                })
              }
            >
              {have.has(i.key) ? 'Есть' : 'Добавить'}
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function LivingRow({ item, onEdit }: { item: LivingDto; onEdit(): void }) {
  const remove = useHhMutation('DELETE', `/living-expenses/${item.id}`, { success: 'Удалено' });
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.name}</p>
        {(item.endsAtKeys || item.startsAtKeys || item.endDate) && (
          <p className="text-xs text-ink-2">{item.endsAtKeys ? 'до переезда' : item.startsAtKeys ? 'после переезда' : item.endDate ? `до ${new Date(item.endDate).toLocaleDateString('ru-RU')}` : ''}</p>
        )}
      </div>
      <Money kop={item.amountKop} className="font-medium" />
      <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Изменить: ${item.name}`}>
        <Pencil className="size-4" />
      </Button>
      <ConfirmButton confirm={`Удалить «${item.name}»?`} onConfirm={() => remove.mutate(undefined)}>
        <Trash2 className="size-4" aria-label="Удалить" />
      </ConfirmButton>
    </li>
  );
}

function LivingModal({ value, onClose }: { value: Partial<LivingDto>; onClose(): void }) {
  const [v, setV] = useState(value);
  const isEdit = Boolean(value.id);
  const save = useHhMutation<Record<string, unknown>>(isEdit ? 'PATCH' : 'POST', isEdit ? `/living-expenses/${value.id}` : '/living-expenses', { success: 'Сохранено' });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Траты в месяц">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            { name: v.name, amountKop: v.amountKop ?? 0, kind: v.kind ?? 'other', endsAtKeys: v.endsAtKeys ?? false, startsAtKeys: v.startsAtKeys ?? false, endDate: v.endDate ?? null, ...(isEdit ? { version: value.version } : {}) },
            { onSuccess: onClose },
          );
        }}
      >
        <Field label="Название" htmlFor="lv-name">
          <Input id="lv-name" required value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Сумма в месяц" htmlFor="lv-amount">
          <MoneyInput id="lv-amount" value={v.amountKop ?? null} onChange={(k) => setV({ ...v, amountKop: k ?? 0 })} />
        </Field>
        <Switch checked={v.endsAtKeys ?? false} onChange={(c) => setV({ ...v, endsAtKeys: c, kind: c ? 'rent' : v.kind })} label="Закончится после переезда (например, аренда)" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" loading={save.isPending}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}
