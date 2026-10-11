import { formatMonthRu, formatRub, type IncomeDistribution } from '@hypothec/core';
import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { useHh } from '../api/household.js';
import { Card, cx, Money, Spinner } from './ui/index.js';

/** Цвета частей — в одном порядке на диаграмме и в легенде. */
const COLORS: Record<string, string> = {
  mortgage: 'var(--chart-3)',
  obligatory: '#7a8a9a',
  life: 'var(--chart-2)',
  unplanned: 'var(--danger)',
  savings: 'var(--chart-1)',
  free: '#e3b25a',
};

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** Круговая диаграмма «Куда уходит доход»: весь доход месяца — 100%. */
export function DistributionCard({ month, compact }: { month: string; compact?: boolean }) {
  const { data, isLoading } = useHh<IncomeDistribution>(`/budget/distribution?month=${month}`);
  const [open, setOpen] = useState<string | null>(null);
  if (isLoading) return <Spinner />;
  if (!data || data.incomeKop === 0) {
    return (
      <Card title="Куда уходит доход">
        <p className="text-sm text-ink-2">В этом месяце доходов нет — добавьте зарплаты и другие поступления в разделе «Доходы».</p>
      </Card>
    );
  }
  return (
    <Card title={`Куда уходит доход — ${formatMonthRu(`${month}-01`)}`}>
      <div className={cx('grid items-center gap-4', compact ? 'sm:grid-cols-[180px_1fr]' : 'sm:grid-cols-[240px_1fr]')}>
        <div className={cx('relative mx-auto w-full', compact ? 'h-44 max-w-44' : 'h-60 max-w-60')}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data.segments} dataKey="amountKop" nameKey="label" innerRadius="58%" outerRadius="100%" paddingAngle={1} stroke="none" isAnimationActive={false}>
                {data.segments.map((s) => (
                  <Cell key={s.key} fill={COLORS[s.key]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-muted">доход</span>
            <span className="num text-base font-semibold">{formatRub(data.incomeKop, { kopecks: 'never' })}</span>
          </div>
        </div>
        <ul className="space-y-1">
          {data.segments.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm hover:bg-surface-2"
                onClick={() => setOpen(open === s.key ? null : s.key)}
                aria-expanded={open === s.key}
              >
                <span className="size-3 shrink-0 rounded-full" style={{ background: COLORS[s.key] }} aria-hidden />
                <span className="flex-1">{s.label}</span>
                <Money kop={s.amountKop} className="text-ink-2" />
                <span className="w-11 text-right font-semibold">{pct(s.share)}</span>
              </button>
              {open === s.key && s.parts.length > 0 && (
                <ul className="mb-1 ml-6 space-y-0.5 text-xs text-ink-2">
                  {s.parts.map((p) => (
                    <li key={p.name} className="flex justify-between gap-2">
                      <span>{p.name}</span>
                      <Money kop={p.amountKop} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
      {data.shortfallKop > 0 && <p className="mt-3 text-sm text-danger">Траты вне плана больше свободных денег на <Money kop={data.shortfallKop} /> — их покрыли из копилки или подушки.</p>}
      {data.uncoveredKop > 0 && <p className="mt-2 text-sm text-warn">По плану доходов не хватает на обязательные платежи: <Money kop={data.uncoveredKop} />.</p>}
      {!compact && (
        <p className="mt-3 text-xs text-muted">
          Нажмите на строку, чтобы увидеть, из чего она складывается. «Копилка» — подушка, досрочка и другие цели; «Вне плана» — перерасход по категориям и траты без
          плана, по факту.
        </p>
      )}
    </Card>
  );
}
