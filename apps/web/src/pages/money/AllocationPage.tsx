import { addMonths, endOfMonth, formatMonthRu, type GoalStep, startOfMonth } from '@hypothec/core';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useHh, useHhMutation } from '../../api/household.js';
import type { AccountDto, AllocationCalendarDto, DashboardDto, SettingsDto } from '../../api/types.js';
import { LessonsFor, Term } from '../../components/learning.js';
import { Badge, Button, Card, cx, DateText, ErrorBox, Field, Input, Modal, Money, MoneyInput, PageHeader, Progress, Select, Spinner, Switch } from '../../components/ui/index.js';
import { Tabs } from '../../layout/AppLayout.js';
import { MONEY_TABS } from './IncomesPage.js';

const STEP_LABEL: Record<GoalStep['target'], string> = {
  min_cushion: 'Подушка: минимум',
  priority_setup: 'Обустройство: самое нужное',
  full_cushion: 'Подушка полностью',
  setup: 'Обустройство: остальное',
  prepayment: 'Досрочка',
  custom: 'Своя цель',
};
const SOURCE_LABEL: Record<GoalStep['sources'], string> = { any: 'любые деньги', stable: 'только стабильные', irregular: 'только нерегулярные' };

export default function AllocationPage() {
  const accounts = useHh<AccountDto[]>('/accounts');
  const dashboard = useHh<DashboardDto>('/dashboard');
  const [month, setMonth] = useState(() => startOfMonth(new Date().toISOString().slice(0, 10)));
  const cal = useHh<AllocationCalendarDto>(`/allocation-calendar?from=${month}&to=${endOfMonth(month)}`);
  const [editAcc, setEditAcc] = useState<AccountDto | null>(null);
  const [newAcc, setNewAcc] = useState(false);

  if (accounts.isLoading) return <Spinner />;
  if (accounts.error) return <ErrorBox error={accounts.error} />;
  const goals = dashboard.data?.goals ?? [];
  const goalFor = (acc: AccountDto) => goals.filter((g) => g.accountId === acc.id && g.targetKop).sort((a, b) => (b.targetKop ?? 0) - (a.targetKop ?? 0))[0];

  return (
    <div>
      <Tabs items={MONEY_TABS} />
      <PageHeader title="Счета и переводы" subtitle="Деньги разложены по счетам-целям, чтобы к каждому платежу нужная сумма была на месте." />

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted">
            <Term k="envelope">Счета-цели</Term> — сколько лежит сейчас
          </h2>
          <Button size="sm" variant="ghost" onClick={() => setNewAcc(true)}>
            <Plus className="size-4" aria-hidden /> Своя цель
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
          {accounts.data!.map((a) => {
            const g = goalFor(a);
            const target = a.targetKop ?? g?.targetKop ?? null;
            return (
              <button key={a.id} type="button" onClick={() => setEditAcc(a)} className="rounded-2xl border border-border bg-surface p-3 text-left hover:bg-surface-2 sm:p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-ink-2">{a.name}</span>
                  <Pencil className="size-4 text-muted" aria-hidden />
                </div>
                <Money kop={a.balanceKop} className="mt-1 block text-lg font-semibold sm:text-xl" />
                {target ? (
                  <div className="mt-2">
                    <Progress value={a.balanceKop / target} label={`${a.name}: прогресс`} />
                    <p className="mt-1 text-xs text-muted">
                      цель <Money kop={target} />
                    </p>
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">Остатки вводите сами — как видите их в банковском приложении. Сервис не подключается к банкам.</p>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Что и куда перевести</h2>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Предыдущий месяц" onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="w-32 text-center text-sm font-medium capitalize">{formatMonthRu(month)}</span>
            <Button size="sm" variant="ghost" aria-label="Следующий месяц" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        {cal.isLoading ? <Spinner /> : cal.data ? <TransferCalendar data={cal.data} /> : null}
      </section>

      <RulesEditor />
      <div className="mt-6">
        <LessonsFor screen="allocation" />
      </div>
      {editAcc && <AccountModal account={editAcc} onClose={() => setEditAcc(null)} />}
      {newAcc && <AccountModal onClose={() => setNewAcc(false)} />}
    </div>
  );
}

function TransferCalendar({ data }: { data: AllocationCalendarDto }) {
  const mark = useHhMutation<{ date: string; incomeId: string; accountId: string; amountKop: number }>('POST', '/transfers/done');
  return (
    <div className="space-y-3">
      {data.warnings.map((w) => (
        <Card key={w.code + w.date} tone="warn">
          <p className="text-sm">
            {w.message} {w.amountKop > 0 && <>Не хватает около <Money kop={w.amountKop} />.</>}
          </p>
        </Card>
      ))}
      {data.transfers.length === 0 && <p className="text-sm text-ink-2">В этом месяце поступлений нет.</p>}
      {data.transfers.map((t) => {
        const lines = t.lines.filter((l) => l.purpose !== 'free');
        const free = t.lines.find((l) => l.purpose === 'free');
        return (
          <div key={`${t.incomeId}:${t.date}`} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                <DateText date={t.date} year={false} /> · {t.incomeName}
              </p>
              <span className="text-sm text-ink-2">
                <Money kop={t.incomeAmountKop} /> {t.reliability !== 'stable' && <Badge tone="warn">{t.reliability === 'unstable' ? 'нестабильный' : 'ожидаемый'}</Badge>}
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {lines.map((l) => (
                <li key={l.accountId + l.label} className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Перевёл ${l.label}`}
                    className="size-4 accent-[var(--primary)]"
                    checked={l.done}
                    disabled={l.done}
                    onChange={() => mark.mutate({ date: t.date, incomeId: t.incomeId, accountId: l.accountId, amountKop: l.amountKop })}
                  />
                  <span className={cx('flex-1', l.done && 'text-ink-2 line-through')}>
                    → {l.label}
                    {l.purpose === 'obligation' && l.accountKind === 'mortgage' && <span className="text-muted"> (к платежу)</span>}
                  </span>
                  <Money kop={l.amountKop} className="font-medium" />
                </li>
              ))}
              {free && free.amountKop > 0 && (
                <li className="flex items-center gap-3 text-sm text-ink-2">
                  <span className="size-4" />
                  <span className="flex-1">Свободно — на жизнь</span>
                  <Money kop={free.amountKop} />
                </li>
              )}
            </ul>
          </div>
        );
      })}
      {data.deficits.length > 0 && (
        <Card tone="warn" title="Нехватка денег к платежам">
          <ul className="space-y-1 text-sm">
            {data.deficits.map((d) => (
              <li key={d.obligationId}>
                <DateText date={d.date} year={false} /> — {d.label}: не хватает <Money kop={d.shortfallKop} />
                {d.coveredFromCushionKop > 0 && <>, из подушки — <Money kop={d.coveredFromCushionKop} /></>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function RulesEditor() {
  const settings = useHh<SettingsDto>('/settings');
  const save = useHhMutation<Record<string, unknown>>('PATCH', '/settings', { success: 'Порядок сохранён — план пересчитан' });
  if (!settings.data) return null;
  const s = settings.data;
  const steps = s.allocation.steps;
  const patch = (allocation: Partial<SettingsDto['allocation']>) => save.mutate({ allocation: { ...s.allocation, ...allocation }, version: s.version });
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    patch({ steps: next });
  };
  return (
    <Card title="Правила распределения">
      <div className="space-y-1">
        <Switch checked={!s.allocation.useUnstableForObligations} onChange={(v) => patch({ useUnstableForObligations: !v })} label="Ипотеку и обязательные расходы — только из стабильных денег" />
        <Switch checked={s.allocation.annualReserveEnabled} onChange={(v) => patch({ annualReserveEnabled: v })} label="Копить на ежегодные платежи (страховку) помесячно" />
      </div>
      <h3 className="mt-4 mb-2 text-sm font-medium">Порядок целей для оставшихся денег</h3>
      <ol className="space-y-2">
        {steps.map((st, i) => (
          <li key={st.target + (st.accountId ?? '')} className={cx('flex flex-wrap items-center gap-2 rounded-xl border border-border p-2', !st.enabled && 'opacity-50')}>
            <span className="w-6 text-center text-sm text-muted">{i + 1}</span>
            <span className="min-w-0 flex-1 text-sm font-medium">{STEP_LABEL[st.target]}</span>
            <Select aria-label="Источник денег" className="order-last h-9 w-full text-sm sm:order-none sm:w-auto" value={st.sources} onChange={(e) => patch({ steps: steps.map((x, j) => (j === i ? { ...x, sources: e.target.value as GoalStep['sources'] } : x)) })}>
              {Object.entries(SOURCE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" aria-label="Выше" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Ниже" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="size-4" />
            </Button>
            <input type="checkbox" aria-label="Включено" className="size-4 accent-[var(--primary)]" checked={st.enabled} onChange={(e) => patch({ steps: steps.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} />
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted">По умолчанию: сначала минимальная подушка, потом самое нужное для новой квартиры, полная подушка, остальное обустройство и только потом досрочка.</p>
    </Card>
  );
}

function AccountModal({ account, onClose }: { account?: AccountDto; onClose(): void }) {
  const [name, setName] = useState(account?.name ?? '');
  const [balance, setBalance] = useState<number | null>(account?.balanceKop ?? 0);
  const [target, setTarget] = useState<number | null>(account?.targetKop ?? null);
  const save = useHhMutation<Record<string, unknown>>(account ? 'PATCH' : 'POST', account ? `/accounts/${account.id}` : '/accounts', { success: 'Сохранено' });
  const remove = useHhMutation('DELETE', `/accounts/${account?.id}`, { success: 'Удалено' });
  const custom = !account || account.kind === 'custom';
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={account ? account.name : 'Своя цель'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(account ? { name, balanceKop: balance ?? 0, targetKop: target, version: account.version } : { kind: 'custom', name, balanceKop: balance ?? 0, targetKop: target }, { onSuccess: onClose });
        }}
      >
        <Field label="Название" htmlFor="acc-name">
          <Input id="acc-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Сколько сейчас на счёте" htmlFor="acc-balance">
          <MoneyInput id="acc-balance" autoFocus value={balance} onChange={setBalance} />
        </Field>
        {custom && (
          <Field label="Цель" htmlFor="acc-target" hint="Сколько хотите накопить">
            <MoneyInput id="acc-target" value={target} onChange={setTarget} />
          </Field>
        )}
        <div className="flex justify-between gap-2">
          {account?.kind === 'custom' ? (
            <Button type="button" variant="ghost" onClick={() => remove.mutate(undefined, { onSuccess: onClose })}>
              Удалить
            </Button>
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
