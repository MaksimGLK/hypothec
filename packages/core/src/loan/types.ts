import type { IsoDate } from '../date/date.js';
import type { Kop } from '../money/money.js';

export type RepaymentType = 'annuity' | 'differentiated';

/**
 * Как начисляются проценты:
 * - `monthly` — каждый период стоит ставка/12 от остатка (так считают в калькуляторах и в эталоне ТЗ);
 * - `daily` — ставка/365 (366 в високосный год) за каждый фактический день (так считают многие банки).
 */
export type InterestMode = 'monthly' | 'daily';

/**
 * - `reduce_term` — платёж прежний, срок короче;
 * - `reduce_payment` — срок прежний, платёж ниже;
 * - `reduce_payment_keep_amount` — банк уменьшает обязательный платёж, а семья продолжает платить прежнюю сумму:
 *   разница каждый месяц уходит в досрочку. Экономия почти как при сокращении срока, а обязательный платёж ниже.
 */
export type PrepaymentMode = 'reduce_term' | 'reduce_payment' | 'reduce_payment_keep_amount';

export interface RateChange {
  /** С этой даты (включительно) действует новая ставка. */
  fromDate: IsoDate;
  /** Годовая ставка в процентах, строкой: "16.5". */
  annualRate: string;
}

export interface BankPrepaymentRules {
  /** Досрочка только в дату ежемесячного платежа. */
  onlyOnPaymentDate: boolean;
  /** Минимальная сумма досрочного платежа (0 — без ограничений). */
  minAmountKop: Kop;
  /** За сколько дней до досрочки нужно подать заявление. */
  noticeDays: number;
}

export interface LoanInput {
  id: string;
  name?: string;
  principalKop: Kop;
  /** Годовая ставка в процентах, строкой: "16" или "5.9". */
  annualRate: string;
  termMonths: number;
  type: RepaymentType;
  issueDate: IsoDate;
  /** День ежемесячного платежа. По умолчанию — день выдачи. */
  paymentDay?: number;
  interestMode?: InterestMode;
  rateChanges?: RateChange[];
  bankRules?: BankPrepaymentRules;
}

export interface PrepaymentInput {
  id: string;
  loanId: string;
  kind: 'one_off' | 'monthly';
  amountKop: Kop;
  /** Для разового платежа. */
  date?: IsoDate;
  /** Для ежемесячной доплаты: применяется в каждую дату платежа в интервале [startDate, endDate]. */
  startDate?: IsoDate;
  endDate?: IsoDate;
  mode: PrepaymentMode;
  source?: 'manual' | 'tax_refund' | 'recommendation';
}

export interface ScheduleRow {
  kind: 'payment' | 'prepayment';
  /** Номер ежемесячного платежа (для досрочки между датами — номер ближайшего следующего). */
  index: number;
  date: IsoDate;
  /** Обязательный платёж (проценты + основной долг). У строки досрочки между датами — 0. */
  paymentKop: Kop;
  interestKop: Kop;
  principalKop: Kop;
  /** Досрочно погашено в эту дату (включая автоматическую доплату до прежней суммы). */
  prepaymentKop: Kop;
  /** Часть досрочки — автоматическая доплата в режиме «уменьшить платёж, но платить прежнюю сумму». */
  keepExtraKop: Kop;
  /** Остаток долга после операции. */
  balanceKop: Kop;
  annualRate: string;
  prepaymentIds: string[];
}

export type ScheduleWarningCode =
  | 'before_issue'
  | 'moved_to_payment_date'
  | 'below_minimum'
  | 'exceeds_balance'
  | 'after_payoff'
  | 'interest_exceeds_payment';

export interface ScheduleWarning {
  code: ScheduleWarningCode;
  date: IsoDate;
  prepaymentId?: string;
  message: string;
}

export interface ScheduleSummary {
  totalInterestKop: Kop;
  totalPrepaidKop: Kop;
  /** Всё, что будет выплачено банку: тело + проценты. */
  totalPaidKop: Kop;
  payoffDate: IsoDate;
  paymentsCount: number;
  firstPaymentKop: Kop;
  maxPaymentKop: Kop;
}

export interface LoanSchedule {
  loanId: string;
  rows: ScheduleRow[];
  summary: ScheduleSummary;
  warnings: ScheduleWarning[];
}
