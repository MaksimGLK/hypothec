import { formatDateRu, isIsoDate } from '../date/date.js';
import { formatRub } from '../money/money.js';
import type { PlanContext } from '../projection/types.js';
import { EFFECT_CALCULATORS } from './effects.js';
import { evaluate, type Facts, referencedFacts, truthy } from './jsonlogic.js';
import type { EffectResult, Recommendation, RecommendationRule, RecommendationState, Severity } from './types.js';

const SEVERITY_WEIGHT: Record<Severity, number> = { important: 3, warning: 2, info: 1 };

/** Склонение «месяц»: 1 месяц, 2 месяца, 5 месяцев. */
export function pluralMonths(n: number): string {
  const abs = Math.abs(Math.floor(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (!Number.isInteger(n)) return 'месяца';
  if (mod10 === 1 && mod100 !== 11) return 'месяц';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'месяца';
  return 'месяцев';
}

function formatValue(value: unknown, filter: string | undefined): string {
  if (value === null || value === undefined) return '—';
  switch (filter) {
    case 'rub':
      return formatRub(Math.round(Number(value) / 100) * 100, { kopecks: 'never' });
    case 'months': {
      const n = Number(value);
      const shown = Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
      return `${shown} ${pluralMonths(n)}`;
    }
    case 'percent':
      return `${String(Math.round(Number(value) * 10) / 10).replace('.', ',')}%`;
    case 'pp':
      return `${String(Math.round(Number(value) * 10) / 10).replace('.', ',')} п.п.`;
    case 'date':
      return typeof value === 'string' && isIsoDate(value) ? formatDateRu(value) : String(value);
    case 'days':
      return `${value} дн.`;
    default:
      return String(value);
  }
}

/** Подстановка {{fact.x|rub}}, {{effect.valueKop|rub}}, {{effect.details.savingsNowKop|rub}}. */
export function renderTemplate(template: string, facts: Facts, effect: EffectResult | null): string {
  return template.replace(/\{\{\s*([\w.]+)\s*(?:\|\s*(\w+))?\s*\}\}/g, (_m, path: string, filter?: string) => {
    const [root, ...rest] = path.split('.');
    let value: unknown;
    if (root === 'fact') value = facts[rest.join('.')];
    else if (root === 'effect') {
      value = effect;
      for (const p of rest) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[p] : undefined;
    }
    return formatValue(value, filter);
  });
}

function fingerprintOf(rule: RecommendationRule, effect: EffectResult | null): string {
  // сумма округляется по логарифмической шкале: небольшие колебания не возвращают скрытую рекомендацию
  const v = effect?.valueKop ?? 0;
  const bucket = v > 0 ? Math.round(Math.log(v / 100) / Math.log(1.5)) : 0;
  return `${rule.key}@${rule.version}:${bucket}`;
}

export function scoreOf(severity: Severity, effect: EffectResult | null, urgencyDays: number | null): number {
  const rubles = Math.max(0, (effect?.valueKop ?? 0) / 100);
  const effectFactor = 1 + Math.log10(1 + rubles / 10_000);
  const urgency = urgencyDays === null ? 1 : urgencyDays <= 30 ? 1.5 : urgencyDays <= 90 ? 1.2 : 1;
  return Math.round(SEVERITY_WEIGHT[severity] * effectFactor * urgency * 1000) / 1000;
}

export interface EngineOptions {
  states?: RecommendationState[];
  /** Ошибки правил (например, опечатка в имени факта) не роняют весь план. */
  onRuleError?: (rule: RecommendationRule, error: unknown) => void;
}

/** Применяет правила к фактам плана и возвращает рекомендации, отсортированные по эффекту и срочности. */
export function runRecommendations(
  rules: readonly RecommendationRule[],
  ctx: PlanContext,
  facts: Facts,
  options: EngineOptions = {},
): Recommendation[] {
  const out: Recommendation[] = [];
  const latest = new Map<string, RecommendationRule>();
  for (const r of rules) {
    if (r.active === false) continue;
    const prev = latest.get(r.key);
    if (!prev || prev.version < r.version) latest.set(r.key, r);
  }
  for (const rule of latest.values()) {
    try {
      if (!truthy(evaluate(rule.when, facts))) continue;
      let effect: EffectResult | null = null;
      if (rule.effect) {
        const calc = EFFECT_CALCULATORS[rule.effect.calc];
        if (!calc) throw new Error(`Unknown effect calculator: ${rule.effect.calc}`);
        effect = calc(ctx, facts, rule.effect.params ?? {});
      }
      if (rule.requirePositiveEffect && !((effect?.valueKop ?? 0) > 0)) continue;
      const urgencyRaw = rule.urgencyDays === undefined ? null : evaluate(rule.urgencyDays, facts);
      const urgencyDays = typeof urgencyRaw === 'number' ? urgencyRaw : null;
      const fingerprint = fingerprintOf(rule, effect);
      const state = options.states?.find((s) => s.ruleKey === rule.key);
      if (state?.status === 'snoozed' && state.until && state.until > ctx.today) continue;
      if (state?.status === 'dismissed' && (!state.fingerprint || state.fingerprint === fingerprint)) continue;

      const used = new Set<string>(referencedFacts(rule.when));
      for (const m of rule.text.matchAll(/\{\{\s*fact\.(\w+)/g)) used.add(m[1]!);
      const factValues: Recommendation['explanation']['facts'] = {};
      for (const name of used) factValues[name] = facts[name] ?? null;

      out.push({
        ruleKey: rule.key,
        version: rule.version,
        severity: rule.severity,
        title: renderTemplate(rule.title, facts, effect),
        text: renderTemplate(rule.text, facts, effect),
        effect,
        score: scoreOf(rule.severity, effect, urgencyDays),
        urgencyDays,
        actions: rule.actions,
        ...(rule.lessonKey ? { lessonKey: rule.lessonKey } : {}),
        sources: rule.sources,
        explanation: { facts: factValues, formula: effect?.formula ?? null },
        fingerprint,
      });
    } catch (error) {
      options.onRuleError?.(rule, error);
    }
  }
  return out.sort((a, b) => b.score - a.score || a.ruleKey.localeCompare(b.ruleKey));
}

/** Проверка правила перед публикацией (для админки и тестов контента). */
export function validateRule(rule: RecommendationRule, knownFacts: readonly string[]): string[] {
  const errors: string[] = [];
  if (!rule.key || !/^[a-z0-9_]+$/.test(rule.key)) errors.push('key: только латиница, цифры и _');
  if (!Number.isInteger(rule.version) || rule.version < 1) errors.push('version: целое ≥ 1');
  for (const f of referencedFacts(rule.when)) if (!knownFacts.includes(f)) errors.push(`when: неизвестный факт ${f}`);
  for (const m of rule.text.matchAll(/\{\{\s*fact\.(\w+)/g)) if (!knownFacts.includes(m[1]!)) errors.push(`text: неизвестный факт ${m[1]}`);
  if (rule.effect && !EFFECT_CALCULATORS[rule.effect.calc]) errors.push(`effect: неизвестный калькулятор ${rule.effect.calc}`);
  if (!rule.sources?.length) errors.push('sources: нужен хотя бы один источник');
  if (!isIsoDate(rule.reviewedAt)) errors.push('reviewedAt: дата YYYY-MM-DD');
  return errors;
}
