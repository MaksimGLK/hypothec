import { addMonths, type IsoDate, monthKey, startOfMonth } from '../date/date.js';
import { D, type Kop } from '../money/money.js';
import type { AllocationResult, Obligation } from '../allocation/allocation.js';
import type { IncomeEvent } from '../income/income.js';

export interface CushionStatus {
  monthlyObligatoryKop: Kop;
  targetMonths: number;
  targetKop: Kop;
  minTargetKop: Kop;
  currentKop: Kop;
  /** На сколько месяцев обязательных расходов хватит подушки сейчас (с одним знаком после запятой). */
  monthsCovered: number;
  progress: number;
  /** Прогноз даты, когда подушка будет собрана полностью. */
  projectedFullDate: IsoDate | null;
  projectedMinDate: IsoDate | null;
  isMinReached: boolean;
  isFullReached: boolean;
}

export function monthsCovered(balanceKop: Kop, monthlyObligatoryKop: Kop): number {
  if (monthlyObligatoryKop <= 0) return balanceKop > 0 ? Infinity : 0;
  return new D(balanceKop).div(monthlyObligatoryKop).toDecimalPlaces(1, D.ROUND_DOWN).toNumber();
}

export function cushionStatus(allocation: AllocationResult, cushionBalanceKop: Kop, months: number, minMonths: number): CushionStatus {
  const monthly = allocation.monthlyObligatoryKop;
  const target = monthly * months;
  const minTarget = monthly * minMonths;
  const full = allocation.goals.find((g) => g.target === 'full_cushion');
  const min = allocation.goals.find((g) => g.target === 'min_cushion');
  return {
    monthlyObligatoryKop: monthly,
    targetMonths: months,
    targetKop: target,
    minTargetKop: minTarget,
    currentKop: cushionBalanceKop,
    monthsCovered: monthsCovered(cushionBalanceKop, monthly),
    progress: target > 0 ? Math.min(1, cushionBalanceKop / target) : 1,
    projectedFullDate: cushionBalanceKop >= target ? null : (full?.reachDate ?? null),
    projectedMinDate: cushionBalanceKop >= minTarget ? null : (min?.reachDate ?? null),
    isMinReached: cushionBalanceKop >= minTarget,
    isFullReached: cushionBalanceKop >= target,
  };
}

export interface StressMonth {
  month: string;
  incomeKop: Kop;
  obligatoryKop: Kop;
  gapKop: Kop;
  cushionAfterKop: Kop;
}

export interface StressTestResult {
  removedIncomeIds: string[];
  /** Сколько полных месяцев подушка закрывает дефицит (null — дефицита нет в горизонте). */
  monthsCushionLasts: number | null;
  firstDeficitMonth: string | null;
  /** Месяц, когда подушки перестанет хватать. */
  cushionDepletedMonth: string | null;
  monthlyGapKop: Kop;
  months: StressMonth[];
}

/**
 * Стресс-тест: что будет, если пропадут выбранные доходы.
 * Считаем только стабильные оставшиеся доходы — нестабильные в трудный период ненадёжны.
 */
export function stressTest(params: {
  today: IsoDate;
  months: number;
  incomeEvents: IncomeEvent[];
  obligations: Obligation[];
  removeIncomeIds: string[];
  cushionKop: Kop;
  includeUnstable?: boolean;
}): StressTestResult {
  const removed = new Set(params.removeIncomeIds);
  const months: StressMonth[] = [];
  let cushion = params.cushionKop;
  let firstDeficit: string | null = null;
  let depleted: string | null = null;
  let maxGap = 0;
  for (let k = 0; k < params.months; k++) {
    const mk = monthKey(addMonths(startOfMonth(params.today), k));
    const income = params.incomeEvents
      .filter((e) => monthKey(e.date) === mk && e.date >= params.today && !removed.has(e.incomeId))
      .filter((e) => params.includeUnstable || e.reliability === 'stable')
      .reduce((s, e) => s + e.amountKop, 0);
    const obligatory = params.obligations
      // в трудный период необязательные траты урезают — считаем только обязательные
      .filter((o) => monthKey(o.dueDate) === mk && o.kind !== 'deal' && o.kind !== 'living_flexible')
      .reduce((s, o) => s + o.amountKop, 0);
    const gap = obligatory - income;
    if (gap > 0) {
      if (!firstDeficit) firstDeficit = mk;
      maxGap = Math.max(maxGap, gap);
      cushion -= gap;
      if (cushion < 0 && !depleted) depleted = mk;
    }
    months.push({ month: mk, incomeKop: income, obligatoryKop: obligatory, gapKop: gap, cushionAfterKop: cushion });
  }
  return {
    removedIncomeIds: params.removeIncomeIds,
    monthsCushionLasts: firstDeficit ? (depleted ? lastedBeforeDepletion(months) : null) : null,
    firstDeficitMonth: firstDeficit,
    cushionDepletedMonth: depleted,
    monthlyGapKop: maxGap,
    months,
  };
}

function lastedBeforeDepletion(months: StressMonth[]): number {
  let n = 0;
  for (const m of months) {
    if (m.cushionAfterKop < 0) break;
    n++;
  }
  return n;
}
