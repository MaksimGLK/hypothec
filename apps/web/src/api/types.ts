import type {
  Account,
  Expense,
  Household,
  HouseholdMember,
  Income,
  Invitation,
  LivingExpense,
  Loan,
  PrepaymentScenario,
  Scenario,
  Stage,
  TaxMember,
  HouseholdSettings,
} from '@hypothec/api-contract';
import type {
  AllocationResult,
  CalendarEvent,
  CushionStatus,
  Dashboard as CoreDashboard,
  IncomeDraft,
  LoanSchedule,
  Recommendation,
  ReconcileResult,
  ScheduleRow,
  ScheduleSummary,
  StressTestResult,
  TaxResult,
  Transfer,
} from '@hypothec/core';
import type { z } from 'zod';

export type HouseholdDto = z.infer<typeof Household>;
export type MemberDto = z.infer<typeof HouseholdMember>;
export type InvitationDto = z.infer<typeof Invitation>;
export type StageDto = z.infer<typeof Stage>;
export type ExpenseDto = z.infer<typeof Expense>;
export type LivingDto = z.infer<typeof LivingExpense>;
export type IncomeDto = z.infer<typeof Income>;
export type AccountDto = z.infer<typeof Account>;
export type LoanDto = z.infer<typeof Loan>;
export type ScenarioDto = z.infer<typeof Scenario>;
export type PrepaymentScenarioDto = z.infer<typeof PrepaymentScenario>;
export type TaxMemberDto = z.infer<typeof TaxMember>;
export type SettingsDto = z.infer<typeof HouseholdSettings>;

export interface DashboardDto extends CoreDashboard {
  today: string;
  revision: number;
  loans: {
    loanId: string;
    name: string;
    currentBalanceKop: number;
    nextPayment: ScheduleRow | null;
    payoffDate: string;
    savingsKop: number;
    monthsSaved: number;
  }[];
  warnings: AllocationResult['warnings'];
}

export interface AllocationCalendarDto {
  transfers: (Omit<Transfer, 'lines'> & { lines: (Transfer['lines'][number] & { done: boolean })[] })[];
  deficits: AllocationResult['deficits'];
  monthlyBalances: AllocationResult['monthlyBalances'];
  goals: AllocationResult['goals'];
  warnings: AllocationResult['warnings'];
}

export interface ScheduleDto extends LoanSchedule {
  baseline: ScheduleSummary;
  scenarioId: string | null;
}

export interface CompareDto {
  baseline: CompareItem;
  scenarios: CompareItem[];
}
export interface CompareItem {
  scenarioId: string;
  name: string;
  totalInterestKop: number;
  savingsKop: number;
  payoffDate: string;
  monthsSaved: number;
  totalPrepaidKop: number;
  paymentAfterFirstPrepaymentKop: number;
  balances: { date: string; balanceKop: number; paymentKop: number }[];
  warnings: LoanSchedule['warnings'];
}

export interface LessonListItem {
  key: string;
  title: string;
  minutes: number;
  screens: string[];
  reviewedAt: string;
}
export interface LessonDto extends LessonListItem {
  markdown: string;
  personal: string | null;
  quiz: { question: string; options: { text: string; correct: boolean }[]; explanation: string | null }[];
  sources: { title: string; url: string }[];
}
export interface GlossaryTerm {
  key: string;
  term: string;
  short: string;
  lessonKey: string | null;
  aliases: string[];
}

export type {
  CalendarEvent,
  CushionStatus,
  IncomeDraft,
  Recommendation,
  ReconcileResult,
  ScheduleRow,
  StressTestResult,
  TaxResult,
};
