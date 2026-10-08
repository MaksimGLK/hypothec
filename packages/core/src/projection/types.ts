import type { IsoDate } from '../date/date.js';
import type { Kop } from '../money/money.js';
import type { AccountInput, AllocationResult, AllocationSettings } from '../allocation/allocation.js';
import type { CushionStatus } from '../cushion/cushion.js';
import type { ExpenseInput, LivingExpenseInput } from '../expenses/expenses.js';
import type { IncomeEvent, IncomeInput } from '../income/income.js';
import type { LoanInput, LoanSchedule, PrepaymentInput, ScheduleRow } from '../loan/types.js';
import type { HousingType, MortgageProgram, StageStatus } from '../stages/templates.js';
import type { TaxMemberInput, TaxResult } from '../tax/tax.js';
import type { Recommendation, RecommendationRule, RecommendationState } from '../recommendations/types.js';
import type { CalendarEvent } from '../calendar/calendar.js';

export interface ScenarioInput {
  housingType: HousingType;
  program: MortgageProgram;
  priceKop: Kop;
  downPaymentKop: Kop;
  maternityCapitalKop: Kop;
  /** Плановая (или фактическая) дата получения ключей. */
  keysDate: IsoDate | null;
  /** Дата возникновения права на вычет. По умолчанию — дата ключей. */
  rightDate?: IsoDate | null;
}

export interface StageInput {
  id: string;
  templateKey: string | null;
  title: string;
  status: StageStatus;
  plannedDate: IsoDate | null;
  actualDate: IsoDate | null;
}

export interface PrepaymentScenario {
  id: string;
  name: string;
  /** Активный сценарий участвует в основном плане. */
  isActive: boolean;
  prepayments: PrepaymentInput[];
}

export interface HouseholdSettings {
  allocation: AllocationSettings;
  /** Ставка по вкладу, которую реально может получить семья (% годовых). */
  depositRatePercent?: string | null;
  /** Ставка НДФЛ для процентов по вкладу (по умолчанию 13). */
  depositTaxPercent?: string | null;
  /** Рыночная ставка по ипотеке сейчас (вводит пользователь) — для правила о рефинансировании. */
  marketRatePercent?: string | null;
  /** Расходы на рефинансирование: оценка, страховка, регистрация. */
  refinanceCostsKop?: Kop | null;
  /** Порог нагрузки по кредитам, % от стабильного дохода. */
  dtiWarnPercent?: number;
}

export interface PlanInput {
  today: IsoDate;
  scenario: ScenarioInput;
  stages: StageInput[];
  loans: LoanInput[];
  prepaymentScenarios: PrepaymentScenario[];
  incomes: IncomeInput[];
  expenses: ExpenseInput[];
  living: LivingExpenseInput[];
  accounts: AccountInput[];
  taxMembers: TaxMemberInput[];
  settings: HouseholdSettings;
  rules?: RecommendationRule[];
  recommendationStates?: RecommendationState[];
  /** Горизонт моделирования распределения и целей, мес. По умолчанию 120. */
  horizonMonths?: number;
}

export interface LoanProjection {
  loanId: string;
  name: string;
  schedule: LoanSchedule;
  baseline: LoanSchedule;
  savingsKop: Kop;
  monthsSaved: number;
  nextPayment: ScheduleRow | null;
  currentBalanceKop: Kop;
}

/** Промежуточный контекст плана — на нём считаются факты для рекомендаций. */
export interface PlanContext {
  input: PlanInput;
  today: IsoDate;
  keysDate: IsoDate | null;
  activePrepayments: PrepaymentInput[];
  loans: LoanProjection[];
  incomeEvents: IncomeEvent[];
  allocation: AllocationResult;
  cushion: CushionStatus;
  tax: TaxResult;
}

export interface Dashboard {
  nextPayment: {
    date: IsoDate;
    amountKop: Kop;
    mortgageAccountKop: Kop;
    /** Сколько будет на ипотечном счёте к дате платежа, если сделать запланированные переводы. */
    plannedByDueKop: Kop;
    ready: boolean;
    readyNow: boolean;
    shortfallKop: Kop;
  } | null;
  cushion: CushionStatus;
  goals: AllocationResult['goals'];
  payoff: { date: IsoDate; baselineDate: IsoDate; savingsKop: Kop; monthsSaved: number } | null;
  upcomingStages: StageInput[];
  upcomingTransfers: AllocationResult['transfers'];
  recommendations: Recommendation[];
  deficitsSoon: AllocationResult['deficits'];
}

export interface PlanResult {
  today: IsoDate;
  keysDate: IsoDate | null;
  loans: LoanProjection[];
  allocation: AllocationResult;
  cushion: CushionStatus;
  tax: TaxResult;
  recommendations: Recommendation[];
  facts: Record<string, number | boolean | string | null>;
  calendar: CalendarEvent[];
  dashboard: Dashboard;
}
