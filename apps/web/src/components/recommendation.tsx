import { addDays } from '@hypothec/core';
import { ChevronDown, Lightbulb, AlertTriangle, Info } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useHhMutation } from '../api/household.js';
import type { Recommendation } from '../api/types.js';
import { LessonModal } from './learning.js';
import { Button, cx } from './ui/index.js';

const SCREENS: Record<string, string> = {
  cushion: '/cushion',
  stress_test: '/cushion',
  allocation: '/money/allocation',
  prepayment: '/loan/prepayment',
  expenses: '/money/expenses',
  stages: '/stages',
};

const FACT_LABELS: Record<string, string> = {
  cushionMonths: 'Подушки хватит, мес.',
  monthlyObligatoryKop: 'Обязательные расходы в месяц',
  cushionFull: 'Подушка собрана',
  prepaymentBeforeCushionKop: 'Досрочка до подушки',
  dtiPercent: 'Нагрузка, % дохода',
  dtiWarnPercent: 'Порог нагрузки, %',
  stableMonthlyIncomeKop: 'Стабильный доход в месяц',
  mortgageUnstableGapKop: 'Нехватка стабильных денег',
  reducePaymentCount: 'Досрочек с уменьшением платежа',
  loanAgeMonths: 'Месяцев с выдачи кредита',
  freeCashKop: 'Свободные деньги',
  yearlyFreeKop: 'Свободно за год по плану',
  hasLoan: 'Есть кредит',
  depositNetRatePercent: 'Вклад после налога, %',
  loanRatePercent: 'Ставка кредита, %',
  taxUnclaimedKop: 'Можно вернуть вычетом',
  daysToInsuranceRenewal: 'Дней до продления',
  refinanceGapPercent: 'Разница со рыночной ставкой, п.п.',
  marketRatePercent: 'Рыночная ставка, %',
  creditPurchasesCount: 'Покупок в кредит',
  depositBeforeApproval: 'Задаток до одобрения',
  annualWithoutReserveKop: 'Ежегодные платежи без резерва',
  freedMonthlyKop: 'Освободилось в месяц',
};

function factValue(key: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (key.endsWith('Kop') && typeof v === 'number') return `${Math.round(v / 100).toLocaleString('ru-RU')} ₽`;
  return String(v).replace('.', ',');
}

/** Рекомендация: факты и рубли, без давления; видно, почему она появилась и как посчитан эффект. */
export function RecommendationCard({ rec, compact }: { rec: Recommendation; compact?: boolean }) {
  const navigate = useNavigate();
  const [why, setWhy] = useState(false);
  const [lesson, setLesson] = useState<string | null>(null);
  const state = useHhMutation<{ status: string; until?: string; fingerprint?: string }>('PUT', `/recommendations/${rec.ruleKey}/state`, { success: 'Скрыли — вернуть можно на экране «Советы»' });
  const apply = useHhMutation<{ patch: string }, { scenarioId: string | null }>('POST', `/recommendations/${rec.ruleKey}/apply`);

  const Icon = rec.severity === 'important' ? AlertTriangle : rec.severity === 'warning' ? Info : Lightbulb;
  const tone = rec.severity === 'important' ? 'text-warn' : rec.severity === 'warning' ? 'text-warn' : 'text-primary';

  const run = async (a: Recommendation['actions'][number]) => {
    const p = a.payload ?? {};
    if (a.type === 'open_lesson') setLesson(String(p.lessonKey));
    else if (a.type === 'open_screen') navigate(SCREENS[String(p.screen)] ?? '/');
    else if (a.type === 'add_reminder') navigate('/settings#reminders');
    else if (a.type === 'apply_scenario') {
      const r = await apply.mutateAsync({ patch: String(p.patch) });
      navigate(r.scenarioId ? `/loan/prepayment?scenario=${r.scenarioId}` : '/money/allocation');
    }
  };

  return (
    <article className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex gap-3">
        <Icon className={cx('mt-0.5 size-5 shrink-0', tone)} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{rec.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{rec.text}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {rec.actions.slice(0, compact ? 1 : 3).map((a) => (
              <Button key={a.label} size="sm" variant={a.type === 'apply_scenario' ? 'primary' : 'secondary'} onClick={() => run(a)} loading={apply.isPending && a.type === 'apply_scenario'}>
                {a.label}
              </Button>
            ))}
            {!compact && (
              <>
                <Button size="sm" variant="ghost" onClick={() => state.mutate({ status: 'snoozed', until: addDays(new Date().toISOString().slice(0, 10), 30) })}>
                  Напомнить через месяц
                </Button>
                <Button size="sm" variant="ghost" onClick={() => state.mutate({ status: 'dismissed', fingerprint: rec.fingerprint })}>
                  Скрыть
                </Button>
              </>
            )}
          </div>
          {!compact && (
            <button type="button" onClick={() => setWhy(!why)} className="mt-3 inline-flex items-center gap-1 text-xs text-muted" aria-expanded={why}>
              Почему я это вижу
              <ChevronDown className={cx('size-3 transition', why && 'rotate-180')} aria-hidden />
            </button>
          )}
          {why && (
            <div className="mt-2 rounded-xl bg-surface-2 p-3 text-xs text-ink-2">
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                {Object.entries(rec.explanation.facts).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt>{FACT_LABELS[k] ?? k}</dt>
                    <dd className="num text-right">{factValue(k, v)}</dd>
                  </div>
                ))}
              </dl>
              {rec.explanation.formula && <p className="mt-2">Как посчитано: {rec.explanation.formula}</p>}
              {rec.sources.length > 0 && (
                <p className="mt-2">
                  Источник:{' '}
                  {rec.sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                      {s.title}
                    </a>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {lesson && <LessonModal lessonKey={lesson} onClose={() => setLesson(null)} />}
    </article>
  );
}
