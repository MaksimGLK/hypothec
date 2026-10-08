import { formatDateRu, monthsBetween } from '@hypothec/core';
import { ArrowRight, CheckCircle2, CircleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../api/auth.js';
import { useHh } from '../api/household.js';
import type { DashboardDto, IncomeDto } from '../api/types.js';
import { LessonsFor, Term } from '../components/learning.js';
import { RecommendationCard } from '../components/recommendation.js';
import { Badge, Button, Card, DateText, ErrorBox, Money, Progress, Spinner } from '../components/ui/index.js';

const GOAL_LABELS: Record<string, string> = {
  min_cushion: 'Подушка: минимум',
  priority_setup: 'Обустройство: самое нужное',
  full_cushion: 'Подушка полностью',
  setup: 'Обустройство',
  prepayment: 'Досрочка',
  custom: 'Цель',
};

function years(months: number) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} г.` : '', m ? `${m} мес.` : ''].filter(Boolean).join(' ') || '0 мес.';
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data: d, isLoading, error, refetch } = useHh<DashboardDto>('/dashboard');
  const incomes = useHh<IncomeDto[]>('/incomes');
  if (isLoading) return <Spinner />;
  if (error || !d) return <ErrorBox error={error} onRetry={() => void refetch()} />;
  const np = d.nextPayment;
  const noIncomes = incomes.data?.length === 0;

  return (
    <div className="space-y-4">
      <header className="mb-2">
        <p className="text-sm text-muted">{formatDateRu(d.today)}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Здравствуйте{user?.name ? `, ${user.name}` : ''}</h1>
      </header>

      {noIncomes && (
        <Card tone="info" title="Добавьте доходы">
          <p className="text-sm">Без доходов не получится посчитать, сколько и на какой счёт откладывать к платежу. Это пара минут.</p>
          <Link to="/money/incomes">
            <Button className="mt-3" size="sm">
              Добавить доходы
            </Button>
          </Link>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Следующий платёж">
          {np ? (
            <>
              <p className="text-3xl font-semibold">
                <Money kop={np.amountKop} />
              </p>
              <p className="mt-1 text-sm text-ink-2">
                <DateText date={np.date} />
              </p>
              <div className="mt-4 flex items-start gap-2 text-sm">
                {np.readyNow ? (
                  <>
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                    <span>На ипотечном счёте уже есть нужная сумма.</span>
                  </>
                ) : np.ready ? (
                  <>
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                    <span>
                      Сейчас на счёте <Money kop={np.mortgageAccountKop} />. Если сделать запланированные переводы, к дате платежа будет достаточно.
                    </span>
                  </>
                ) : (
                  <>
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                    <span>
                      К дате платежа может не хватить <Money kop={np.shortfallKop} />. Проверьте остаток ипотечного счёта и переводы.
                    </span>
                  </>
                )}
              </div>
              <Link to="/money/allocation" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                Что и куда перевести <ArrowRight className="size-4" aria-hidden />
              </Link>
            </>
          ) : (
            <p className="text-sm text-ink-2">Платежей пока нет — добавьте кредит.</p>
          )}
        </Card>

        <Card title={<Term k="cushion">Подушка безопасности</Term>}>
          <p className="text-3xl font-semibold">
            {Number.isFinite(d.cushion.monthsCovered) ? String(d.cushion.monthsCovered).replace('.', ',') : '—'}
            <span className="ml-1 text-base font-normal text-ink-2">из {d.cushion.targetMonths} мес.</span>
          </p>
          <div className="mt-3">
            <Progress value={d.cushion.progress} tone={d.cushion.isMinReached ? 'primary' : 'warn'} label="Подушка собрана" />
          </div>
          <p className="mt-2 text-sm text-ink-2">
            <Money kop={d.cushion.currentKop} /> из <Money kop={d.cushion.targetKop} />
            {d.cushion.projectedFullDate && (
              <>
                {' '}
                · соберётся к <DateText date={d.cushion.projectedFullDate} />
              </>
            )}
          </p>
          <Link to="/cushion" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
            Стресс-тест <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Card>
      </div>

      {d.payoff && (
        <Card title="Когда закроется кредит">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted">По текущему плану</div>
              <div className="mt-0.5 text-lg font-semibold">
                <DateText date={d.payoff.date} />
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Экономия от досрочки</div>
              <div className="mt-0.5 text-lg font-semibold text-ok">
                <Money kop={d.payoff.savingsKop} />
              </div>
            </div>
            {d.payoff.monthsSaved > 0 && (
              <div>
                <div className="text-xs text-muted">Раньше графика на</div>
                <div className="mt-0.5 text-lg font-semibold">{years(d.payoff.monthsSaved)}</div>
              </div>
            )}
          </div>
          {d.payoff.savingsKop === 0 && (
            <p className="mt-3 text-sm text-ink-2">
              Досрочных платежей в плане пока нет. <Link to="/loan/prepayment" className="text-primary">Посчитать досрочку</Link>
            </p>
          )}
        </Card>
      )}

      {d.deficitsSoon.length > 0 && (
        <Card tone="warn" title="Где может не хватить денег в ближайшие 3 месяца">
          <ul className="space-y-1 text-sm">
            {d.deficitsSoon.slice(0, 4).map((x) => (
              <li key={x.obligationId}>
                <DateText date={x.date} year={false} /> — {x.label}: не хватает <Money kop={x.shortfallKop} />
                {x.coveredFromCushionKop > 0 && <> (из подушки — <Money kop={x.coveredFromCushionKop} />)</>}
              </li>
            ))}
          </ul>
          {d.deficitsSoon.some((x) => x.kind === 'deal') && (
            <p className="mt-3 text-xs text-ink-2">
              Если деньги на первый взнос и расходы сделки уже отложены, укажите их на счёте «Расходы сделки» в разделе{' '}
              <Link to="/money/allocation" className="text-primary">
                Счета и переводы
              </Link>
              .
            </p>
          )}
        </Card>
      )}

      {d.recommendations.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Главное сейчас</h2>
            <Link to="/advice" className="text-sm text-primary">
              Все советы
            </Link>
          </div>
          {d.recommendations.map((r) => (
            <RecommendationCard key={r.ruleKey} rec={r} compact />
          ))}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Цели" action={<Link to="/money/allocation" className="text-sm text-primary">Счета</Link>}>
          <ul className="space-y-3">
            {d.goals
              .filter((g) => g.targetKop !== null)
              .map((g) => {
                const left = g.reachDate ? monthsBetween(d.today, g.reachDate) : null;
                return (
                  <li key={g.target} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span>{GOAL_LABELS[g.target]}</span>
                      <span className="text-ink-2">
                        {g.targetKop === 0 ? 'не нужно' : g.reachDate ? (left === 0 ? 'в этом месяце' : `≈ через ${years(left!)}`) : 'не в ближайшие годы'}
                      </span>
                    </div>
                    <div className="mt-1">
                      <Progress value={g.targetKop ? g.currentKop / g.targetKop : 1} label={GOAL_LABELS[g.target] ?? ''} />
                    </div>
                  </li>
                );
              })}
          </ul>
        </Card>

        <Card title="Ближайшие этапы" action={<Link to="/stages" className="text-sm text-primary">Все</Link>}>
          {d.upcomingStages.length === 0 ? (
            <p className="text-sm text-ink-2">Все этапы пройдены.</p>
          ) : (
            <ul className="space-y-2">
              {d.upcomingStages.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{s.title}</span>
                  <span className="shrink-0 text-ink-2">
                    {s.status === 'in_progress' && <Badge tone="primary">в работе</Badge>} <DateText date={s.plannedDate} year={false} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {d.upcomingTransfers.length > 0 && (
        <Card title="Переводы в ближайшие две недели" action={<Link to="/money/allocation" className="text-sm text-primary">Календарь</Link>}>
          <ul className="space-y-3">
            {d.upcomingTransfers.map((t) => (
              <li key={`${t.incomeId}:${t.date}`} className="text-sm">
                <p className="font-medium">
                  <DateText date={t.date} year={false} />: {t.incomeName} <Money kop={t.incomeAmountKop} className="text-ink-2" />
                </p>
                <ul className="mt-1 space-y-0.5 text-ink-2">
                  {t.lines
                    .filter((l) => l.purpose !== 'free')
                    .map((l) => (
                      <li key={l.accountId + l.label} className="flex justify-between gap-3">
                        <span>→ {l.label}</span>
                        <Money kop={l.amountKop} />
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <LessonsFor screen="dashboard" />
    </div>
  );
}
