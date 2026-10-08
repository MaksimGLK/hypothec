import type { Household, Loan, PrepaymentScenario } from '@hypothec/api-contract';
import type { Dashboard } from '@hypothec/core';
import type { z } from 'zod';

export type HouseholdDto = z.infer<typeof Household>;
export type LoanDto = z.infer<typeof Loan>;
export type PrepaymentScenarioDto = z.infer<typeof PrepaymentScenario>;
export type DashboardDto = Dashboard & { today: string; revision: number };
