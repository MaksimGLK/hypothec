export * from './common.js';
export * from './auth.js';
export * from './domain.js';

/** Ответы с пересчитанным планом — типы ядра, без дублирования схем. */
export type {
  AllocationResult,
  CalendarEvent,
  CushionStatus,
  Dashboard,
  LoanProjection,
  PlanResult,
  Recommendation,
  ScenarioComparison,
  StressTestResult,
  TaxResult,
  TimingPoint,
  ReconcileResult,
  QuickInputResult,
} from '@hypothec/core';

export const API_PREFIX = '/api/v1';
