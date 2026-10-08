import { formatMonthRu, formatRub } from '@hypothec/core';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useHh, useHhMutation } from '../api/household.js';
import type { CushionStatus, IncomeDto, SettingsDto, StressTestResult } from '../api/types.js';
import { LessonsFor, Term } from '../components/learning.js';
import { Button, Card, DateText, ErrorBox, Money, PageHeader, Progress, Select, Spinner, Stat } from '../components/ui/index.js';
import { chartTooltip, rubAxis } from './loan/LoanPage.js';

export default function CushionPage() {
  const cushion = useHh<CushionStatus>('/cushion');
  const settings = useHh<SettingsDto>('/settings');
  const incomes = useHh<IncomeDto[]>('/incomes');
  const save = useHhMutation<Record<string, unknown>>('PATCH', '/settings', { success: 'Цель обновлена' });
  if (cushion.isLoading) return <Spinner />;
  if (cushion.error || !cushion.data) return <ErrorBox error={cushion.error} />;
  const c = cushion.data;
  return (
    <div>
      <PageHeader title="Подушка безопасности" subtitle="Деньги на случай, если доход пропадёт: платить ипотеку и жить, пока ищете выход." />
      <div className="mb-4">
        <LessonsFor screen="cushion" />
      </div>
      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Сейчас" value={<Money kop={c.currentKop} />} />
          <Stat label="Хватит на" value={`${Number.isFinite(c.monthsCovered) ? String(c.monthsCovered).replace('.', ',') : '—'} мес.`} />
          <Stat label="Цель" value={<Money kop={c.targetKop} />} sub={`${c.targetMonths} мес. × ${formatRub(c.monthlyObligatoryKop, { kopecks: 'never' })}`} />
          <Stat label="Соберётся" value={c.isFullReached ? 'уже собрана' : c.projectedFullDate ? <DateText date={c.projectedFullDate} /> : 'не в ближайшие годы'} />
        </div>
        <div className="mt-4">
          <Progress value={c.progress} tone={c.isMinReached ? 'primary' : 'warn'} label="Подушка" />
          <p className="mt-2 text-xs text-muted">
            <Term k="obligatory">Обязательные расходы</Term> — платёж по ипотеке, базовые траты и ежегодные платежи ÷ 12. Минимум — {formatRub(c.minTargetKop, { kopecks: 'never' })} (3 месяца).
          </p>
        </div>
        {settings.data && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="cm">Цель — на сколько месяцев:</label>
            <Select
              id="cm"
              className="h-9 w-24"
              value={settings.data.allocation.cushionMonths}
              onChange={(e) => save.mutate({ allocation: { ...settings.data!.allocation, cushionMonths: Number(e.target.value) }, version: settings.data!.version })}
            >
              {[3, 4, 6, 9, 12].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
            <span className="text-muted">Чем менее стабилен доход, тем больше месяцев стоит закладывать.</span>
          </div>
        )}
        <p className="mt-3 text-sm text-ink-2">Остаток подушки меняется на экране «Счета и переводы».</p>
      </Card>
      <StressTest incomes={(incomes.data ?? []).filter((i) => i.reliability === 'stable' && i.periodicity !== 'once')} />
    </div>
  );
}

function StressTest({ incomes }: { incomes: IncomeDto[] }) {
  const [removed, setRemoved] = useState<string[]>(incomes[0] ? [incomes[0].id] : []);
  const run = useHhMutation<{ removeIncomeIds: string[]; months: number }, StressTestResult>('POST', '/stress-test', { silent: true });
  const r = run.data;
  return (
    <Card className="mt-4" title={<Term k="stress_test">Стресс-тест: что будет, если пропадёт доход</Term>}>
      {incomes.length === 0 ? (
        <p className="text-sm text-ink-2">Добавьте стабильные доходы, чтобы проверить план.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {incomes.map((i) => (
              <label key={i.id} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm">
                <input type="checkbox" className="accent-[var(--primary)]" checked={removed.includes(i.id)} onChange={() => setRemoved((x) => (x.includes(i.id) ? x.filter((y) => y !== i.id) : [...x, i.id]))} />
                без «{i.name}»
              </label>
            ))}
            <Button size="sm" disabled={!removed.length} loading={run.isPending} onClick={() => run.mutate({ removeIncomeIds: removed, months: 24 })}>
              Проверить
            </Button>
          </div>
          {r && (
            <div className="mt-4">
              {r.firstDeficitMonth === null ? (
                <p className="rounded-xl bg-ok-soft p-3 text-sm">Оставшихся стабильных доходов хватает на обязательные расходы — дефицита в ближайшие 2 года нет.</p>
              ) : (
                <div className="rounded-xl bg-warn-soft p-3 text-sm">
                  <p>
                    Не хватает до <Money kop={r.monthlyGapKop} className="font-medium" /> в месяц, начиная с {formatMonthRu(`${r.firstDeficitMonth}-01`)}.
                  </p>
                  <p className="mt-1">
                    {r.monthsCushionLasts !== null ? (
                      <>
                        Подушка закроет разницу примерно на <strong>{r.monthsCushionLasts} мес.</strong> — до {formatMonthRu(`${r.cushionDepletedMonth}-01`)}.
                      </>
                    ) : (
                      'Подушки хватит на весь проверяемый период.'
                    )}
                  </p>
                </div>
              )}
              <div className="mt-4 h-56">
                <ResponsiveContainer>
                  <BarChart data={r.months}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(5) + '.' + m.slice(2, 4)} stroke="var(--muted)" fontSize={11} minTickGap={8} />
                    <YAxis tickFormatter={rubAxis} stroke="var(--muted)" fontSize={12} width={60} />
                    <Tooltip {...chartTooltip} formatter={(v) => [formatRub(Number(v), { kopecks: 'never' }), 'Подушка после месяца']} />
                    <ReferenceLine y={0} stroke="var(--danger)" />
                    <Bar dataKey="cushionAfterKop" fill="var(--chart-1)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
