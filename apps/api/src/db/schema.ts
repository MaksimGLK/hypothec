import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const kop = (name: string) => bigint(name, { mode: 'number' });
const day = (name: string) => date(name, { mode: 'string' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};
const version = () => integer('version').notNull().default(1);
const householdRef = () =>
  uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' });

// ── Пользователи и доступ ──────────────────────────────────────────────
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  /** Режим интерфейса: simple — главное без лишних настроек, advanced — всё. Общий для веба и мобилки. */
  uiMode: text('ui_mode').notNull().default('simple'),
  emailVerifiedAt: ts('email_verified_at'),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: ts('locked_until'),
  ...timestamps,
});

/** Способы входа. Сейчас — пароль; позже VK ID, Яндекс ID, Сбер ID, телефон — новые строки без изменения схемы. */
export const authIdentities = pgTable(
  'auth_identities',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('auth_identities_provider_subject').on(t.provider, t.subject)],
);

export const emailCodes = pgTable(
  'email_codes',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: ts('consumed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('email_codes_user_purpose').on(t.userId, t.purpose)],
);

export const refreshSessions = pgTable(
  'refresh_sessions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Все токены одной цепочки ротации; повторное использование старого токена отзывает всю цепочку. */
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    platform: text('platform').notNull(),
    deviceName: text('device_name'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    replacedById: uuid('replaced_by_id'),
  },
  (t) => [index('refresh_sessions_user').on(t.userId), index('refresh_sessions_family').on(t.familyId)],
);

export const consents = pgTable('consents', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  documentVersion: text('document_version').notNull(),
  acceptedAt: ts('accepted_at').notNull().defaultNow(),
  ip: text('ip'),
});

// ── Семья ──────────────────────────────────────────────────────────────
export const households = pgTable('households', {
  id: id(),
  name: text('name').notNull(),
  /** Растёт при любом изменении данных семьи — ключ кэша пересчёта плана. */
  revision: integer('revision').notNull().default(1),
  settings: jsonb('settings').notNull(),
  settingsVersion: integer('settings_version').notNull().default(1),
  taxMembers: jsonb('tax_members').notNull().default(sql`'[]'::jsonb`),
  taxVersion: integer('tax_version').notNull().default(1),
  ...timestamps,
});

export const householdMembers = pgTable(
  'household_members',
  {
    id: id(),
    householdId: householdRef(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    displayName: text('display_name'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('household_members_unique').on(t.householdId, t.userId), index('household_members_user').on(t.userId)],
);

export const invitations = pgTable('invitations', {
  id: id(),
  householdId: householdRef(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ── План покупки ───────────────────────────────────────────────────────
export const scenarios = pgTable('scenarios', {
  householdId: uuid('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  housingType: text('housing_type').notNull(),
  program: text('program').notNull(),
  priceKop: kop('price_kop').notNull(),
  downPaymentKop: kop('down_payment_kop').notNull(),
  maternityCapitalKop: kop('maternity_capital_kop').notNull().default(0),
  keysDate: day('keys_date'),
  rightDate: day('right_date'),
  wizardAnswers: jsonb('wizard_answers'),
  version: version(),
  ...timestamps,
});

export const stages = pgTable(
  'stages',
  {
    id: id(),
    householdId: householdRef(),
    templateKey: text('template_key'),
    title: text('title').notNull(),
    hint: text('hint'),
    status: text('status').notNull().default('todo'),
    plannedDate: day('planned_date'),
    actualDate: day('actual_date'),
    lessonKey: text('lesson_key'),
    sort: integer('sort').notNull().default(0),
    version: version(),
    ...timestamps,
  },
  (t) => [index('stages_household').on(t.householdId)],
);

export const stageDocuments = pgTable('stage_documents', {
  id: id(),
  householdId: householdRef(),
  stageId: uuid('stage_id').notNull().references(() => stages.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  isReady: boolean('is_ready').notNull().default(false),
  sort: integer('sort').notNull().default(0),
});

export const loans = pgTable(
  'loans',
  {
    id: id(),
    householdId: householdRef(),
    name: text('name').notNull(),
    bank: text('bank'),
    principalKop: kop('principal_kop').notNull(),
    annualRate: text('annual_rate').notNull(),
    termMonths: integer('term_months').notNull(),
    type: text('type').notNull(),
    issueDate: day('issue_date').notNull(),
    paymentDay: integer('payment_day'),
    interestMode: text('interest_mode').notNull().default('monthly'),
    rateChanges: jsonb('rate_changes').notNull().default(sql`'[]'::jsonb`),
    bankRules: jsonb('bank_rules'),
    /** Импортированный из банка график (строки CSV после разбора). */
    bankSchedule: jsonb('bank_schedule'),
    version: version(),
    ...timestamps,
  },
  (t) => [index('loans_household').on(t.householdId)],
);

export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    householdId: householdRef(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    catalogKey: text('catalog_key'),
    stageId: uuid('stage_id').references(() => stages.id, { onDelete: 'set null' }),
    planKop: kop('plan_kop').notNull(),
    factKop: kop('fact_kop'),
    date: day('date'),
    recurrence: text('recurrence').notNull(),
    endDate: day('end_date'),
    priority: integer('priority'),
    loanId: uuid('loan_id').references(() => loans.id, { onDelete: 'set null' }),
    percentOfLoanBalance: text('percent_of_loan_balance'),
    credit: jsonb('credit'),
    atKeys: boolean('at_keys').notNull().default(false),
    version: version(),
    ...timestamps,
  },
  (t) => [index('expenses_household').on(t.householdId)],
);

/** Категории бюджета на жизнь с планом на месяц (коммуналка, продукты, кружки…). */
export const livingExpenses = pgTable('living_expenses', {
  id: id(),
  householdId: householdRef(),
  name: text('name').notNull(),
  amountKop: kop('amount_kop').notNull(),
  kind: text('kind'),
  essential: boolean('essential').notNull().default(true),
  group: text('group'),
  catalogKey: text('catalog_key'),
  sort: integer('sort').notNull().default(0),
  /** День автоплатежа (1–31) — трата на сумму плана записывается сама. */
  autoPayDay: integer('auto_pay_day'),
  /** За какой месяц (YYYY-MM) автоплатёж уже обработан. */
  autoPayLastMonth: text('auto_pay_last_month'),
  startDate: day('start_date'),
  endDate: day('end_date'),
  endsAtKeys: boolean('ends_at_keys').notNull().default(false),
  startsAtKeys: boolean('starts_at_keys').notNull().default(false),
  version: version(),
  ...timestamps,
});

export const incomes = pgTable(
  'incomes',
  {
    id: id(),
    householdId: householdRef(),
    memberId: uuid('member_id').references(() => householdMembers.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    amountKop: kop('amount_kop').notNull(),
    periodicity: text('periodicity').notNull(),
    dayOfMonth: integer('day_of_month'),
    date: day('date'),
    startDate: day('start_date'),
    endDate: day('end_date'),
    reliability: text('reliability').notNull(),
    startsAtKeys: boolean('starts_at_keys').notNull().default(false),
    endsAtKeys: boolean('ends_at_keys').notNull().default(false),
    previousAmountKop: kop('previous_amount_kop'),
    changedAt: day('changed_at'),
    version: version(),
    ...timestamps,
  },
  (t) => [index('incomes_household').on(t.householdId)],
);

/** Фактические траты по категориям бюджета. */
export const spendings = pgTable(
  'spendings',
  {
    id: id(),
    householdId: householdRef(),
    categoryId: uuid('category_id').references(() => livingExpenses.id, { onDelete: 'set null' }),
    date: day('date').notNull(),
    amountKop: kop('amount_kop').notNull(),
    note: text('note'),
    /** manual — внесена вручную, plan — кнопка «Оплачено», auto — автоплатёж. */
    source: text('source').notNull().default('manual'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    ...timestamps,
  },
  (t) => [index('spendings_household_date').on(t.householdId, t.date)],
);

export const accounts = pgTable('accounts', {
  id: id(),
  householdId: householdRef(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  balanceKop: kop('balance_kop').notNull().default(0),
  targetKop: kop('target_kop'),
  sort: integer('sort').notNull().default(0),
  version: version(),
  ...timestamps,
});

export const transfersDone = pgTable(
  'transfers_done',
  {
    id: id(),
    householdId: householdRef(),
    date: day('date').notNull(),
    incomeId: uuid('income_id').notNull(),
    accountId: uuid('account_id').notNull(),
    amountKop: kop('amount_kop').notNull(),
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('transfers_done_unique').on(t.householdId, t.date, t.incomeId, t.accountId)],
);

/** Сколько фактически отложено на цель (подушка, досрочка…) за месяц — рядом с расчётным планом. */
export const goalContributions = pgTable(
  'goal_contributions',
  {
    id: id(),
    householdId: householdRef(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    amountKop: kop('amount_kop').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    ...timestamps,
  },
  (t) => [uniqueIndex('goal_contributions_account_month').on(t.accountId, t.month)],
);

export const prepaymentScenarios = pgTable('prepayment_scenarios', {
  id: id(),
  householdId: householdRef(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(false),
  color: text('color'),
  version: version(),
  ...timestamps,
});

export const prepayments = pgTable('prepayments', {
  id: id(),
  householdId: householdRef(),
  scenarioId: uuid('scenario_id').notNull().references(() => prepaymentScenarios.id, { onDelete: 'cascade' }),
  loanId: uuid('loan_id').notNull().references(() => loans.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  amountKop: kop('amount_kop').notNull(),
  date: day('date'),
  startDate: day('start_date'),
  endDate: day('end_date'),
  mode: text('mode').notNull(),
  source: text('source').notNull().default('manual'),
  /** planned — впереди; done — дата наступила, сумма списана со счёта «Досрочка»; skipped — не вносили. */
  status: text('status').notNull().default('planned'),
  /** Сколько фактически принял банк (если отличается от плана). */
  factAmountKop: kop('fact_amount_kop'),
  executedAt: ts('executed_at'),
  /** Пользователь подтвердил, что внёс (или поправил сумму). */
  confirmed: boolean('confirmed').notNull().default(false),
  version: version(),
  ...timestamps,
});

// ── Рекомендации, контент, уведомления ─────────────────────────────────
export const recommendationRules = pgTable(
  'recommendation_rules',
  {
    id: id(),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    definition: jsonb('definition').notNull(),
    publishedAt: ts('published_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('recommendation_rules_key_version').on(t.key, t.version)],
);

export const recommendationStates = pgTable(
  'recommendation_states',
  {
    householdId: householdRef(),
    ruleKey: text('rule_key').notNull(),
    status: text('status').notNull(),
    until: day('until'),
    fingerprint: text('fingerprint'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.ruleKey] })],
);

export const contentItems = pgTable(
  'content_items',
  {
    id: id(),
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    version: integer('version').notNull().default(1),
    title: text('title').notNull(),
    body: jsonb('body').notNull(),
    sources: jsonb('sources').notNull().default(sql`'[]'::jsonb`),
    reviewedAt: day('reviewed_at').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('content_items_kind_key').on(t.kind, t.key)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    eventDate: day('event_date'),
    scheduledFor: ts('scheduled_for').notNull(),
    channel: text('channel').notNull(),
    status: text('status').notNull().default('pending'),
    dedupeKey: text('dedupe_key').notNull().unique(),
    sentAt: ts('sent_at'),
    error: text('error'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('notifications_due').on(t.status, t.scheduledFor), index('notifications_household').on(t.householdId)],
);

export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  prefs: jsonb('prefs').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Задел для push-уведомлений в мобильном приложении. */
export const pushDevices = pgTable('push_devices', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  platform: text('platform').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_household').on(t.householdId, t.createdAt)],
);
