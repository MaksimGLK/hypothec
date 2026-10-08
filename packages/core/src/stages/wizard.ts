import { addDays, type IsoDate, parseDate } from '../date/date.js';
import { type Kop, rub } from '../money/money.js';
import { defaultAccounts, type AccountInput } from '../allocation/allocation.js';
import { EXPENSE_CATALOG } from '../expenses/catalog.js';
import type { ExpenseInput } from '../expenses/expenses.js';
import type { LoanInput } from '../loan/types.js';
import { type HousingType, type MortgageProgram, type StageStatus, templatesFor } from './templates.js';

export interface WizardAnswers {
  adults: number;
  children: number;
  housingType: HousingType;
  /** Продаём свою квартиру (альтернативная сделка). */
  sellingOwn: boolean;
  /** Ожидаемая сумма от продажи своей квартиры. */
  ownSalePriceKop?: Kop;
  maternityCapitalKop: Kop;
  program: MortgageProgram;
  priceKop: Kop;
  downPaymentKop: Kop;
  /** Ставка, которую назвал банк. Если не указана — ориентир по программе. */
  annualRate?: string;
  termYears?: number;
  /** Когда хотите начать (по умолчанию — сегодня). */
  startDate?: IsoDate;
}

export interface StageDraft {
  key: string;
  templateKey: string | null;
  title: string;
  hint: string;
  status: StageStatus;
  plannedDate: IsoDate;
  actualDate: IsoDate | null;
  documents: { title: string; isReady: boolean }[];
  lessonKey?: string;
  sort: number;
}

export interface InitialPlan {
  stages: StageDraft[];
  expenses: ExpenseInput[];
  accounts: AccountInput[];
  loan: LoanInput;
  keysDate: IsoDate;
  dealDate: IsoDate;
  /** Что стоит уточнить у пользователя. */
  notes: string[];
}

/**
 * Ориентиры ставок по программам — только для черновика. Пользователь вводит ставку из своего одобрения.
 * Условия программ меняются; дата проверки хранится рядом.
 */
export const PROGRAM_DEFAULTS: Record<MortgageProgram, { title: string; rate: string | null; termYears: number }> = {
  family: { title: 'Семейная ипотека', rate: '6', termYears: 30 },
  it: { title: 'ИТ-ипотека', rate: '6', termYears: 30 },
  base: { title: 'Рыночная ипотека', rate: null, termYears: 30 },
  other: { title: 'Другая программа', rate: null, termYears: 20 },
};
export const PROGRAM_DEFAULTS_REVIEWED_AT = '2026-10-08';
export const FALLBACK_MARKET_RATE = '20';

/** Собирает черновик плана из ответов мастера: этапы, расходы, счета, кредит. */
export function buildInitialPlan(a: WizardAnswers, today: IsoDate): InitialPlan {
  const start = a.startDate ?? today;
  const notes: string[] = [];
  const templates = templatesFor({ housingType: a.housingType, sellingOwn: a.sellingOwn, maternityCapital: a.maternityCapitalKop > 0 });
  const stages: StageDraft[] = templates.map((t, i) => ({
    key: t.key,
    templateKey: t.key,
    title: t.title,
    hint: t.hint,
    status: 'todo',
    plannedDate: addDays(start, t.offsetWeeks * 7),
    actualDate: null,
    documents: t.documents.map((title) => ({ title, isReady: false })),
    ...(t.lessonKey ? { lessonKey: t.lessonKey } : {}),
    sort: i,
  }));
  const stageDate = (key: string) => stages.find((s) => s.key === key)?.plannedDate ?? start;
  const dealDate = stageDate('signing');
  const keysDate = stageDate('move_in');

  const program = PROGRAM_DEFAULTS[a.program];
  let rate = a.annualRate ?? program.rate;
  if (!rate) {
    rate = FALLBACK_MARKET_RATE;
    notes.push('Укажите ставку из одобрения банка — пока в расчёте стоит ориентир.');
  }
  const termYears = a.termYears ?? program.termYears;
  const ownMoney = a.downPaymentKop + a.maternityCapitalKop;
  const principal = Math.max(0, a.priceKop - ownMoney);
  if (principal <= 0) notes.push('Своих денег хватает на всю стоимость — ипотека не нужна.');
  if (a.priceKop > 0 && a.downPaymentKop * 100 < a.priceKop * 20 && (a.program === 'family' || a.program === 'it')) {
    notes.push('По льготным программам обычно нужен первый взнос от 20%. Уточните условия в банке.');
  }

  const loan: LoanInput = {
    id: 'loan_main',
    name: program.title,
    principalKop: Math.max(principal, rub(1)),
    annualRate: rate,
    termMonths: termYears * 12,
    type: 'annuity',
    issueDate: dealDate,
    paymentDay: Math.min(parseDate(dealDate).d, 28),
    interestMode: 'monthly',
    bankRules: { onlyOnPaymentDate: false, minAmountKop: 0, noticeDays: 1 },
  };

  const expenses: ExpenseInput[] = [];
  for (const item of EXPENSE_CATALOG) {
    if (item.housing && !item.housing.includes(a.housingType)) continue;
    // не навязываем необязательное, кроме страхования жизни (влияет на ставку)
    // нотариус нужен, если маткапитал идёт на покупку с выделением долей детям
    const notaryNeeded = item.key === 'notary' && a.maternityCapitalKop > 0;
    if (item.category === 'optional' && !['life_insurance', 'e_registration'].includes(item.key) && !notaryNeeded) continue;
    const stage = stages.find((s) => s.key === item.stageKey);
    let planKop = item.defaultPlanKop;
    if (item.key === 'down_payment') planKop = a.downPaymentKop;
    if (item.key === 'seller_deposit' && a.priceKop > 0) planKop = Math.min(planKop, a.downPaymentKop);
    const isInsurance = Boolean(item.percentOfLoanBalance);
    const e: ExpenseInput = {
      id: `exp_${item.key}`,
      name: item.name,
      category: item.category,
      catalogKey: item.key,
      planKop,
      recurrence: item.recurrence,
      date: item.category === 'after_keys' ? keysDate : (stage?.plannedDate ?? dealDate),
      ...(stage ? { stageId: stage.key } : {}),
      ...(item.priority ? { priority: item.priority } : {}),
      ...(isInsurance ? { loanId: loan.id, percentOfLoanBalance: item.percentOfLoanBalance!, date: dealDate } : {}),
      ...(item.category === 'after_keys' ? { atKeys: true } : {}),
    };
    if (planKop > 0 || isInsurance) expenses.push(e);
  }

  const accounts = defaultAccounts();
  if (a.sellingOwn && a.ownSalePriceKop) {
    notes.push('Деньги от продажи своей квартиры учтены как первый взнос. Добавьте их в доходы как ожидаемое разовое поступление, если сумма ещё не на руках.');
  }
  if (a.children > 0 && a.program !== 'family') {
    notes.push('С детьми может подойти семейная ипотека — проверьте условия на сайте ДОМ.РФ.');
  }
  return { stages, expenses, accounts, loan, keysDate, dealDate, notes };
}
