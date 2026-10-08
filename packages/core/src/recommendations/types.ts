import type { IsoDate } from '../date/date.js';
import type { Kop } from '../money/money.js';

/** Условие в формате JSON-Logic: { "<": [ { "fact": "cushionMonths" }, 3 ] } */
export type JsonLogic = boolean | number | string | null | JsonLogic[] | { [op: string]: JsonLogic };

export type Severity = 'info' | 'warning' | 'important';

export type RecommendationActionType = 'apply_scenario' | 'add_reminder' | 'open_lesson' | 'open_screen';

export interface RecommendationAction {
  type: RecommendationActionType;
  label: string;
  payload?: Record<string, unknown>;
}

export interface RuleSource {
  title: string;
  url: string;
}

export interface RecommendationRule {
  key: string;
  version: number;
  active?: boolean;
  when: JsonLogic;
  effect?: { calc: string; params?: Record<string, unknown> };
  /** Не показывать, если эффект в рублях нулевой или отрицательный. */
  requirePositiveEffect?: boolean;
  severity: Severity;
  /** Срочность: через сколько дней наступит событие (факт или число). */
  urgencyDays?: JsonLogic;
  title: string;
  /** Шаблон текста: {{fact.cushionMonths|months}}, {{effect.valueKop|rub}}. */
  text: string;
  actions: RecommendationAction[];
  lessonKey?: string;
  sources: RuleSource[];
  reviewedAt: string;
}

export interface EffectResult {
  /** Главный эффект в рублях (для сортировки и текста). */
  valueKop?: Kop;
  months?: number;
  details: Record<string, number | string | null>;
  /** Как посчитано — человеческим языком. */
  formula: string;
}

export interface RecommendationState {
  ruleKey: string;
  status: 'dismissed' | 'snoozed';
  until?: IsoDate | null;
  fingerprint?: string | null;
}

export interface Recommendation {
  ruleKey: string;
  version: number;
  severity: Severity;
  title: string;
  text: string;
  effect: EffectResult | null;
  score: number;
  urgencyDays: number | null;
  actions: RecommendationAction[];
  lessonKey?: string;
  sources: RuleSource[];
  explanation: {
    /** Факты, на которых сработало правило, с их значениями. */
    facts: Record<string, number | boolean | string | null>;
    formula: string | null;
  };
  /** Меняется, когда ситуация существенно изменилась — скрытая рекомендация покажется снова. */
  fingerprint: string;
}
