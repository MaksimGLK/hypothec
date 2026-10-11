import { z } from 'zod';
import { Id, IsoDate, Kop, Percent, RatePercent, Version } from './common.js';
import { Email } from './auth.js';

/** Для обновлений: все поля необязательны, версия — обязательна (защита от затирания правок супруга). */
export const withVersion = <T extends z.ZodRawShape>(shape: z.ZodObject<T>) => shape.partial().extend({ version: Version });

// ── Семья ──────────────────────────────────────────────────────────────
export const Role = z.enum(['owner', 'member']);

export const Household = z.object({
  id: Id,
  name: z.string(),
  revision: z.number().int(),
  role: Role,
});
export type Household = z.infer<typeof Household>;

export const HouseholdMember = z.object({
  id: Id,
  userId: Id,
  name: z.string(),
  email: z.string(),
  role: Role,
  displayName: z.string().nullable(),
});

export const CreateHouseholdRequest = z.object({ name: z.string().trim().min(1).max(100) });
export const InviteRequest = z.object({ email: Email, role: Role.default('member') });
export const Invitation = z.object({
  id: Id,
  email: z.string(),
  role: Role,
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  expiresAt: z.iso.datetime(),
});

// ── Сценарий и мастер ──────────────────────────────────────────────────
export const HousingType = z.enum(['new_ddu', 'secondary', 'house']);
export const MortgageProgram = z.enum(['family', 'base', 'it', 'other']);

export const WizardAnswers = z.object({
  adults: z.number().int().min(1).max(10),
  children: z.number().int().min(0).max(20),
  housingType: HousingType,
  sellingOwn: z.boolean(),
  ownSalePriceKop: Kop.optional(),
  maternityCapitalKop: Kop,
  program: MortgageProgram,
  priceKop: Kop.refine((v) => v > 0, 'Укажите стоимость'),
  downPaymentKop: Kop,
  annualRate: RatePercent.optional(),
  termYears: z.number().int().min(1).max(40).optional(),
  startDate: IsoDate.optional(),
  /** Расходы на жизнь по категориям справочника — сразу попадают в бюджет. */
  budget: z.array(z.object({ catalogKey: z.string().max(64), amountKop: Kop })).max(30).optional(),
});
export type WizardAnswers = z.infer<typeof WizardAnswers>;

export const Scenario = z.object({
  housingType: HousingType,
  program: MortgageProgram,
  priceKop: Kop,
  downPaymentKop: Kop,
  maternityCapitalKop: Kop,
  keysDate: IsoDate.nullable(),
  rightDate: IsoDate.nullable().optional(),
  version: Version,
});
export const UpdateScenarioRequest = withVersion(Scenario.omit({ version: true }));

// ── Этапы ──────────────────────────────────────────────────────────────
export const StageStatus = z.enum(['todo', 'in_progress', 'done', 'skipped']);

export const StageDocument = z.object({ id: Id, title: z.string().min(1).max(200), isReady: z.boolean() });

export const Stage = z.object({
  id: Id,
  templateKey: z.string().nullable(),
  title: z.string().min(1).max(200),
  hint: z.string().nullable(),
  status: StageStatus,
  plannedDate: IsoDate.nullable(),
  actualDate: IsoDate.nullable(),
  lessonKey: z.string().nullable(),
  sort: z.number().int(),
  documents: z.array(StageDocument),
  version: Version,
});
export type Stage = z.infer<typeof Stage>;
export const CreateStageRequest = Stage.pick({ title: true, plannedDate: true }).extend({
  hint: z.string().max(2000).nullable().optional(),
  status: StageStatus.default('todo'),
  afterStageId: Id.optional(),
});
export const UpdateStageRequest = withVersion(Stage.pick({ title: true, status: true, plannedDate: true, actualDate: true, hint: true }));
export const ReorderStagesRequest = z.object({ ids: z.array(Id).min(1) });
export const CreateDocumentRequest = z.object({ title: z.string().trim().min(1).max(200) });
export const UpdateDocumentRequest = z.object({ title: z.string().trim().min(1).max(200).optional(), isReady: z.boolean().optional() });

// ── Расходы ────────────────────────────────────────────────────────────
export const ExpenseCategory = z.enum(['mandatory', 'optional', 'after_keys']);
export const Recurrence = z.enum(['once', 'monthly', 'yearly']);

const ExpenseFields = z.object({
  name: z.string().trim().min(1).max(200),
  category: ExpenseCategory,
  catalogKey: z.string().nullable().optional(),
  stageId: Id.nullable().optional(),
  planKop: Kop,
  factKop: Kop.nullable().optional(),
  date: IsoDate.nullable().optional(),
  recurrence: Recurrence,
  endDate: IsoDate.nullable().optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  loanId: Id.nullable().optional(),
  percentOfLoanBalance: Percent.nullable().optional(),
  credit: z.object({ annualRate: RatePercent, months: z.number().int().min(1).max(120) }).nullable().optional(),
  atKeys: z.boolean().optional(),
});
export const Expense = ExpenseFields.extend({ id: Id, version: Version });
export type Expense = z.infer<typeof Expense>;
export const CreateExpenseRequest = ExpenseFields;
export const UpdateExpenseRequest = withVersion(ExpenseFields);

/** Категория бюджета на жизнь с планом на месяц. */
const LivingFields = z.object({
  name: z.string().trim().min(1).max(200),
  amountKop: Kop,
  kind: z.enum(['rent', 'other']).optional(),
  essential: z.boolean().optional(),
  group: z.string().max(32).nullable().optional(),
  catalogKey: z.string().max(64).nullable().optional(),
  sort: z.number().int().optional(),
  autoPayDay: z.number().int().min(1).max(31).nullable().optional(),
  startDate: IsoDate.nullable().optional(),
  endDate: IsoDate.nullable().optional(),
  endsAtKeys: z.boolean().optional(),
  startsAtKeys: z.boolean().optional(),
});
export const LivingExpense = LivingFields.extend({ id: Id, version: Version });
export const CreateLivingExpenseRequest = LivingFields;
export const UpdateLivingExpenseRequest = withVersion(LivingFields);

// ── Траты (факт бюджета) ───────────────────────────────────────────────
const SpendingFields = z.object({
  categoryId: Id.nullable(),
  date: IsoDate,
  amountKop: Kop.refine((v) => v > 0, 'Сумма должна быть больше нуля'),
  note: z.string().trim().max(200).nullable().optional(),
  source: z.enum(['manual', 'plan', 'auto']).optional(),
});
export const Spending = SpendingFields.extend({ id: Id, version: Version, createdBy: Id.nullable().optional() });
export type Spending = z.infer<typeof Spending>;
export const CreateSpendingRequest = SpendingFields;
export const UpdateSpendingRequest = withVersion(SpendingFields);
export const MonthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Месяц в формате ГГГГ-ММ') });
/** Правка ячейки «Потрачено»: привести факт категории за месяц к итогу. */
export const SetMonthTotalRequest = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Месяц в формате ГГГГ-ММ'),
  totalKop: Kop,
});
/** Факт взноса в цель за месяц (итог). */
export const SetContributionRequest = z.object({
  accountId: Id,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Месяц в формате ГГГГ-ММ'),
  amountKop: Kop,
});
export const ParseSpendingRequest = z.object({ text: z.string().trim().min(1).max(200) });
export const BootstrapBudgetRequest = z.object({
  /** Ключи категорий из справочника; по умолчанию — стартовый набор. */
  keys: z.array(z.string().max(64)).max(30).optional(),
});

// ── Доходы ─────────────────────────────────────────────────────────────
export const IncomeType = z.enum(['salary', 'advance', 'bonus', 'self_employed', 'rent', 'one_off', 'tax_refund', 'gift', 'property_sale', 'other']);
export const Periodicity = z.enum(['monthly', 'quarterly', 'yearly', 'once']);
export const Reliability = z.enum(['stable', 'unstable', 'expected']);

const IncomeFields = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: IncomeType,
    amountKop: Kop.refine((v) => v > 0, 'Сумма должна быть больше нуля'),
    periodicity: Periodicity,
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    date: IsoDate.optional(),
    startDate: IsoDate.optional(),
    endDate: IsoDate.optional(),
    reliability: Reliability,
    memberId: Id.optional(),
    startsAtKeys: z.boolean().optional(),
    endsAtKeys: z.boolean().optional(),
    previousAmountKop: Kop.optional(),
    changedAt: IsoDate.optional(),
  });
export const Income = IncomeFields.extend({ id: Id, version: Version });
export type Income = z.infer<typeof Income>;
export const CreateIncomeRequest = IncomeFields.superRefine((v, ctx) => {
  if (v.periodicity === 'once' && !v.date) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Укажите дату поступления' });
  if (v.periodicity === 'monthly' && !v.dayOfMonth) ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'Укажите день месяца' });
  if (v.startDate && v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Дата окончания раньше начала' });
});
export const UpdateIncomeRequest = withVersion(IncomeFields);
export const ParseIncomeRequest = z.object({ text: z.string().trim().min(1).max(300) });

// ── Счета и распределение ──────────────────────────────────────────────
export const AccountKind = z.enum(['mortgage', 'cushion', 'setup', 'prepayment', 'life', 'annual_reserve', 'deal', 'custom']);
const AccountFields = z.object({
  kind: AccountKind,
  name: z.string().trim().min(1).max(100),
  balanceKop: Kop,
  targetKop: Kop.nullable().optional(),
});
export const Account = AccountFields.extend({ id: Id, version: Version, sort: z.number().int() });
export const CreateAccountRequest = AccountFields.extend({ kind: z.literal('custom') });
export const UpdateAccountRequest = withVersion(AccountFields.omit({ kind: true }));

export const SourceFilter = z.enum(['stable', 'any', 'irregular']);
export const GoalStep = z.object({
  target: z.enum(['min_cushion', 'full_cushion', 'priority_setup', 'setup', 'prepayment', 'custom']),
  accountId: Id.optional(),
  sources: SourceFilter,
  enabled: z.boolean(),
  sharePercent: z.number().int().min(0).max(100).optional(),
});
export const AllocationSettings = z.object({
  useUnstableForObligations: z.boolean(),
  annualReserveEnabled: z.boolean(),
  cushionMonths: z.number().int().min(1).max(24),
  minCushionMonths: z.number().int().min(1).max(12),
  steps: z.array(GoalStep).max(20),
  distribution: z.enum(['sequential', 'split']).optional(),
});
export const MarkTransferDoneRequest = z.object({ date: IsoDate, incomeId: Id, accountId: Id, amountKop: Kop });

export const HouseholdSettings = z.object({
  allocation: AllocationSettings,
  depositRatePercent: RatePercent.nullable().optional(),
  depositTaxPercent: Percent.nullable().optional(),
  marketRatePercent: RatePercent.nullable().optional(),
  refinanceCostsKop: Kop.nullable().optional(),
  dtiWarnPercent: z.number().int().min(10).max(90).optional(),
  version: Version,
});
export const UpdateHouseholdSettingsRequest = withVersion(HouseholdSettings.omit({ version: true }));

// ── Кредиты и досрочка ─────────────────────────────────────────────────
export const RateChange = z.object({ fromDate: IsoDate, annualRate: RatePercent });
export const BankRules = z.object({
  onlyOnPaymentDate: z.boolean(),
  minAmountKop: Kop,
  noticeDays: z.number().int().min(0).max(90),
});
const LoanFields = z.object({
  name: z.string().trim().min(1).max(100),
  bank: z.string().trim().max(100).nullable().optional(),
  principalKop: Kop.refine((v) => v > 0, 'Сумма кредита должна быть больше нуля'),
  annualRate: RatePercent,
  termMonths: z.number().int().min(1).max(600),
  type: z.enum(['annuity', 'differentiated']),
  issueDate: IsoDate,
  paymentDay: z.number().int().min(1).max(31).optional(),
  interestMode: z.enum(['monthly', 'daily']).default('monthly'),
  rateChanges: z.array(RateChange).max(20).default([]),
  bankRules: BankRules.optional(),
});
export const Loan = LoanFields.extend({ id: Id, version: Version });
export type Loan = z.infer<typeof Loan>;
export const CreateLoanRequest = LoanFields;
export const UpdateLoanRequest = withVersion(LoanFields);

export const PrepaymentMode = z.enum(['reduce_term', 'reduce_payment', 'reduce_payment_keep_amount']);
const PrepaymentFields = z
  .object({
    loanId: Id,
    kind: z.enum(['one_off', 'monthly']),
    amountKop: Kop.refine((v) => v > 0, 'Сумма должна быть больше нуля'),
    date: IsoDate.optional(),
    startDate: IsoDate.optional(),
    endDate: IsoDate.optional(),
    mode: PrepaymentMode,
    source: z.enum(['manual', 'tax_refund', 'recommendation']).default('manual'),
  });
export const Prepayment = PrepaymentFields.extend({
  id: Id,
  version: Version,
  status: z.enum(['planned', 'done', 'skipped']).optional(),
  factAmountKop: Kop.nullable().optional(),
  confirmed: z.boolean().optional(),
});
/** Подтверждение разовой досрочки после её даты. */
export const ConfirmPrepaymentRequest = z.object({
  action: z.enum(['confirm', 'amount', 'skip', 'restore']),
  amountKop: Kop.optional(),
});
export const CreatePrepaymentRequest = PrepaymentFields.superRefine((v, ctx) => {
  if (v.kind === 'one_off' && !v.date) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Укажите дату платежа' });
});
export const UpdatePrepaymentRequest = withVersion(PrepaymentFields);

export const PrepaymentScenario = z.object({
  id: Id,
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
  color: z.string().max(20).nullable(),
  prepayments: z.array(Prepayment),
  version: Version,
});
export const CreatePrepaymentScenarioRequest = z.object({
  name: z.string().trim().min(1).max(100),
  copyFromId: Id.optional(),
});
export const UpdatePrepaymentScenarioRequest = withVersion(z.object({ name: z.string().trim().min(1).max(100), isActive: z.boolean(), color: z.string().max(20).nullable() }));
export const CompareScenariosRequest = z.object({ loanId: Id, scenarioIds: z.array(Id).min(1).max(4) });
export const TimingRequest = z.object({ loanId: Id, amountKop: Kop, dates: z.array(IsoDate).min(1).max(10), mode: PrepaymentMode.default('reduce_term') });
export const TaxToPrepaymentRequest = z.object({
  scenarioId: Id,
  loanId: Id,
  mode: PrepaymentMode.default('reduce_term'),
  includeProperty: z.boolean().default(true),
  includeInterest: z.boolean().default(true),
});

// ── Налоговый вычет ────────────────────────────────────────────────────
export const TaxMember = z.object({
  memberId: Id,
  name: z.string().min(1).max(100),
  annualTaxableIncomeKop: Kop,
  ndflRatePercent: RatePercent,
  propertyDeductionUsedKop: Kop,
  interestDeductionUsed: z.boolean(),
  costSharePercent: Percent,
  interestSharePercent: Percent,
  claimed: z.boolean(),
});
export const UpdateTaxMembersRequest = z.object({ members: z.array(TaxMember).max(10) });

// ── Рекомендации ───────────────────────────────────────────────────────
export const RecommendationStateRequest = z.object({
  status: z.enum(['dismissed', 'snoozed']),
  until: IsoDate.nullable().optional(),
  fingerprint: z.string().max(200).nullable().optional(),
});

// ── «Что если» и стресс-тест ───────────────────────────────────────────
export const StressTestRequest = z.object({ removeIncomeIds: z.array(Id).min(1), months: z.number().int().min(1).max(60).default(24) });
export const CalendarQuery = z.object({ from: IsoDate, to: IsoDate });

// ── Импорт графика ─────────────────────────────────────────────────────
export const BankScheduleUploadRequest = z.object({ csv: z.string().min(1).max(2_000_000) });
