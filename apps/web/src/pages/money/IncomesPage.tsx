import { INCOME_TYPE_LABELS, monthlyEquivalent, type IncomeInput } from '@hypothec/core';
import { Pencil, Sparkles, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useHh, useHhMutation } from '../../api/household.js';
import type { IncomeDraft, IncomeDto, MemberDto } from '../../api/types.js';
import { Term } from '../../components/learning.js';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, Field, Input, Modal, Money, MoneyInput, PageHeader, Segmented, Select, Spinner, Switch } from '../../components/ui/index.js';
import { Tabs } from '../../layout/AppLayout.js';

export const MONEY_TABS = [
  { to: '/money/allocation', label: 'Счета и переводы' },
  { to: '/money/incomes', label: 'Доходы' },
  { to: '/money/expenses', label: 'Расходы' },
];

const PERIOD_LABEL: Record<IncomeDto['periodicity'], string> = { monthly: 'каждый месяц', quarterly: 'раз в квартал', yearly: 'раз в год', once: 'разово' };
const RELIABILITY: Record<IncomeDto['reliability'], { label: string; tone: 'ok' | 'warn' | 'neutral'; hint: string }> = {
  stable: { label: 'стабильный', tone: 'ok', hint: 'Приходит регулярно и предсказуемо. Из таких денег планируется ипотека.' },
  unstable: { label: 'нестабильный', tone: 'warn', hint: 'Может не прийти или меняется. Идёт на цели, а не на ипотеку.' },
  expected: { label: 'ожидаемый', tone: 'neutral', hint: 'Ещё не начал приходить. Учитывается только для целей.' },
};

const TEMPLATES: { label: string; text: string }[] = [
  { label: 'Зарплата', text: 'Зарплата 100 000 каждый месяц 10-го' },
  { label: 'Аванс', text: 'Аванс 60 000 каждый месяц 25-го' },
  { label: 'Премия', text: 'Премия 110 000 раз в квартал' },
  { label: 'Подработка', text: 'Подработка 20 000 в месяц нестабильно' },
  { label: 'Сдача квартиры', text: 'Аренда 35 000 ежемесячно 5-го' },
  { label: 'Налоговый вычет', text: 'Налоговый вычет 260 000 в мае' },
  { label: 'Продажа квартиры', text: 'Продажа квартиры 6 000 000 разово' },
];

type FormValue = Omit<IncomeInput, 'id'> & { id?: string; version?: number };

function describe(i: Pick<IncomeDto, 'periodicity' | 'dayOfMonth' | 'date'>) {
  if (i.periodicity === 'monthly') return `${PERIOD_LABEL.monthly}${i.dayOfMonth ? `, ${i.dayOfMonth}-го` : ''}`;
  if (i.periodicity === 'once') return i.date ? `разово, ${new Date(i.date).toLocaleDateString('ru-RU')}` : 'разово';
  return `${PERIOD_LABEL[i.periodicity]}${i.date ? `, с ${new Date(i.date).toLocaleDateString('ru-RU')}` : ''}`;
}

export default function IncomesPage() {
  const incomes = useHh<IncomeDto[]>('/incomes');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<FormValue | null>(null);
  const [recognized, setRecognized] = useState<string[]>([]);
  const parse = useHhMutation<{ text: string }, { draft: IncomeDraft; recognized: string[]; missing: string[] }>('POST', '/incomes/parse', { silent: true });

  const runParse = (value: string, e?: FormEvent) => {
    e?.preventDefault();
    if (!value.trim()) return;
    parse.mutate(
      { text: value },
      {
        onSuccess: (r) => {
          setRecognized(r.recognized);
          setDraft({ ...r.draft, amountKop: r.draft.amountKop ?? 0 } as FormValue);
        },
      },
    );
  };

  if (incomes.isLoading) return <Spinner />;
  if (incomes.error) return <ErrorBox error={incomes.error} />;
  const list = incomes.data ?? [];
  const stableMonthly = list.filter((i) => i.reliability === 'stable').reduce((s, i) => s + monthlyEquivalent(i as IncomeInput), 0);
  const groups = [
    { title: 'Регулярные', items: list.filter((i) => i.reliability === 'stable' && i.periodicity !== 'once') },
    { title: 'Дополнительные', items: list.filter((i) => i.reliability !== 'stable' && i.periodicity !== 'once') },
    { title: 'Разовые поступления', items: list.filter((i) => i.periodicity === 'once') },
  ];

  return (
    <div>
      <Tabs items={MONEY_TABS} />
      <PageHeader title="Доходы" subtitle={<>Стабильный доход в месяц: <Money kop={stableMonthly} className="font-medium text-ink" /></>} />

      <Card className="mb-5" title="Добавить одной строкой">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => runParse(text, e)}>
          <Input aria-label="Доход одной строкой" placeholder="Например: Премия 110 000 каждый месяц 15-го" value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" loading={parse.isPending} className="shrink-0">
            <Sparkles className="size-4" aria-hidden /> Разобрать
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              className="rounded-full border border-border px-3 py-1 text-sm text-ink-2 hover:bg-surface-2"
              onClick={() => {
                setText(t.text);
                runParse(t.text);
              }}
            >
              {t.label}
            </button>
          ))}
          <button type="button" className="rounded-full px-3 py-1 text-sm text-primary" onClick={() => setDraft({ name: '', type: 'salary', amountKop: 0, periodicity: 'monthly', reliability: 'stable' })}>
            Заполнить вручную
          </button>
        </div>
      </Card>

      {list.length === 0 ? (
        <Empty title="Доходов пока нет">Начните с зарплат: из стабильных денег планируется платёж по ипотеке. Премии и подработку можно добавить отдельно — они пойдут на цели.</Empty>
      ) : (
        <div className="space-y-5">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <section key={g.title}>
                <h2 className="mb-2 text-sm font-medium text-muted">{g.title}</h2>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                  {g.items.map((i) => (
                    <IncomeRow key={i.id} income={i} onEdit={() => setDraft(i as FormValue)} />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}

      {draft && <IncomeModal value={draft} recognized={draft.id ? [] : recognized} onClose={() => setDraft(null)} onSaved={() => setText('')} />}
    </div>
  );
}

function IncomeRow({ income, onEdit }: { income: IncomeDto; onEdit(): void }) {
  const remove = useHhMutation('DELETE', `/incomes/${income.id}`, { success: 'Доход удалён' });
  const r = RELIABILITY[income.reliability];
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{income.name}</p>
        <p className="mt-0.5 text-xs text-ink-2">
          {describe(income)} · <Badge tone={r.tone}>{r.label}</Badge>
          {income.startsAtKeys && ' · после переезда'}
          {income.startDate && !income.startsAtKeys && ` · с ${new Date(income.startDate).toLocaleDateString('ru-RU')}`}
          {income.endDate && ` · до ${new Date(income.endDate).toLocaleDateString('ru-RU')}`}
        </p>
      </div>
      <Money kop={income.amountKop} className="font-medium" />
      <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Изменить: ${income.name}`}>
        <Pencil className="size-4" />
      </Button>
      <ConfirmButton confirm={`Удалить доход «${income.name}»?`} onConfirm={() => remove.mutate(undefined)}>
        <Trash2 className="size-4" aria-label="Удалить" />
      </ConfirmButton>
    </li>
  );
}

function IncomeModal({ value, recognized, onClose, onSaved }: { value: FormValue; recognized: string[]; onClose(): void; onSaved(): void }) {
  const [v, setV] = useState<FormValue>(value);
  const members = useHh<MemberDto[]>('/members');
  const isEdit = Boolean(value.id);
  const save = useHhMutation<Record<string, unknown>>(isEdit ? 'PATCH' : 'POST', isEdit ? `/incomes/${value.id}` : '/incomes', { success: isEdit ? 'Сохранено' : 'Доход добавлен' });
  const set = <K extends keyof FormValue>(k: K, val: FormValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { id: _id, ...rest } = v as FormValue & { householdId?: string; createdAt?: string; updatedAt?: string };
    const body: Record<string, unknown> = {
      name: rest.name,
      type: rest.type,
      amountKop: rest.amountKop,
      periodicity: rest.periodicity,
      reliability: rest.reliability,
      startsAtKeys: rest.startsAtKeys ?? false,
      endsAtKeys: rest.endsAtKeys ?? false,
      ...(rest.periodicity === 'monthly' && rest.dayOfMonth ? { dayOfMonth: rest.dayOfMonth } : {}),
      ...(rest.periodicity !== 'monthly' && rest.date ? { date: rest.date } : {}),
      ...(rest.startDate ? { startDate: rest.startDate } : {}),
      ...(rest.endDate ? { endDate: rest.endDate } : {}),
      ...(rest.memberId ? { memberId: rest.memberId } : {}),
      ...(isEdit ? { version: value.version } : {}),
    };
    save.mutate(body, {
      onSuccess: () => {
        onSaved();
        onClose();
      },
    });
  };
  const err = save.error;

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={isEdit ? 'Доход' : 'Новый доход'} {...(recognized.length ? { description: `Поняли так: ${recognized.join(', ')}. Проверьте и поправьте.` } : {})}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Название" htmlFor="inc-name">
            <Input id="inc-name" required value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Сумма" htmlFor="inc-amount" error={err?.field('amountKop')}>
            <MoneyInput id="inc-amount" value={v.amountKop || null} onChange={(k) => set('amountKop', k ?? 0)} />
          </Field>
          <Field label="Вид" htmlFor="inc-type">
            <Select id="inc-type" value={v.type} onChange={(e) => set('type', e.target.value as FormValue['type'])}>
              {Object.entries(INCOME_TYPE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Как часто" htmlFor="inc-period">
            <Select id="inc-period" value={v.periodicity} onChange={(e) => set('periodicity', e.target.value as FormValue['periodicity'])}>
              {Object.entries(PERIOD_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {v.periodicity === 'monthly' ? (
            <Field label="День поступления" htmlFor="inc-day" error={err?.field('dayOfMonth')}>
              <Input id="inc-day" type="number" min={1} max={31} value={v.dayOfMonth ?? ''} onChange={(e) => set('dayOfMonth', e.target.value ? Number(e.target.value) : undefined)} />
            </Field>
          ) : (
            <Field label={v.periodicity === 'once' ? 'Дата поступления' : 'Дата первого поступления'} htmlFor="inc-date" error={err?.field('date')}>
              <Input id="inc-date" type="date" value={v.date ?? ''} onChange={(e) => set('date', e.target.value || undefined)} />
            </Field>
          )}
          {(members.data?.length ?? 0) > 1 && (
            <Field label="Чей доход" htmlFor="inc-member">
              <Select id="inc-member" value={v.memberId ?? ''} onChange={(e) => set('memberId', e.target.value || undefined)}>
                <option value="">общий</option>
                {members.data!.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName ?? m.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ink-2">
            <Term k="reliability">Надёжность</Term>
          </p>
          <Segmented
            label="Надёжность"
            value={v.reliability}
            onChange={(r) => set('reliability', r)}
            options={(Object.keys(RELIABILITY) as IncomeDto['reliability'][]).map((k) => ({ value: k, label: RELIABILITY[k].label }))}
          />
          <p className="mt-1.5 text-xs text-muted">{RELIABILITY[v.reliability].hint}</p>
        </div>

        {v.periodicity !== 'once' && (
          <div className="space-y-2 rounded-xl bg-surface-2 p-3">
            <Switch checked={v.startsAtKeys ?? false} onChange={(c) => set('startsAtKeys', c)} label="Начнётся после переезда (например, сдача старой квартиры)" />
            <Switch checked={v.endsAtKeys ?? false} onChange={(c) => set('endsAtKeys', c)} label="Закончится после переезда" />
            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <Field label="Начало" htmlFor="inc-start">
                <Input id="inc-start" type="date" value={v.startDate ?? ''} onChange={(e) => set('startDate', e.target.value || undefined)} />
              </Field>
              <Field label="Окончание" htmlFor="inc-end" error={err?.field('endDate')}>
                <Input id="inc-end" type="date" value={v.endDate ?? ''} onChange={(e) => set('endDate', e.target.value || undefined)} />
              </Field>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!v.amountKop}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}
