import type { JsonLogic } from './types.js';

export type FactValue = number | boolean | string | null;
export type Facts = Record<string, FactValue>;

/**
 * Небольшой безопасный интерпретатор JSON-Logic: только чистые операции над фактами,
 * никакого доступа к коду. Неизвестная операция — ошибка (правило с опечаткой не должно молча срабатывать).
 */
export function evaluate(logic: JsonLogic, facts: Facts): FactValue {
  if (logic === null || typeof logic !== 'object') return logic as FactValue;
  if (Array.isArray(logic)) throw new Error('Array is not a valid expression');
  const ops = Object.keys(logic);
  if (ops.length !== 1) throw new Error(`Expression must have exactly one operator, got: ${ops.join(', ')}`);
  const op = ops[0]!;
  const raw = (logic as Record<string, JsonLogic>)[op]!;
  const args = Array.isArray(raw) ? raw : [raw];
  const val = (i: number) => evaluate(args[i] as JsonLogic, facts);
  const num = (i: number) => {
    const v = val(i);
    return typeof v === 'number' ? v : v === null ? NaN : Number(v);
  };
  switch (op) {
    case 'fact':
    case 'var': {
      const name = args[0];
      if (typeof name !== 'string') throw new Error('fact name must be a string');
      if (!(name in facts)) throw new Error(`Unknown fact: ${name}`);
      return facts[name] ?? null;
    }
    case 'and':
      return args.every((_, i) => truthy(val(i)));
    case 'or':
      return args.some((_, i) => truthy(val(i)));
    case '!':
    case 'not':
      return !truthy(val(0));
    case '==':
      return val(0) === val(1);
    case '!=':
      return val(0) !== val(1);
    case '<':
      return compare(args, facts, (a, b) => a < b);
    case '<=':
      return compare(args, facts, (a, b) => a <= b);
    case '>':
      return compare(args, facts, (a, b) => a > b);
    case '>=':
      return compare(args, facts, (a, b) => a >= b);
    case '+':
      return args.reduce<number>((s, _, i) => s + num(i), 0);
    case '-':
      return args.length === 1 ? -num(0) : num(0) - num(1);
    case '*':
      return args.reduce<number>((s, _, i) => s * num(i), 1);
    case '/':
      return num(1) === 0 ? null : num(0) / num(1);
    case 'min':
      return Math.min(...args.map((_, i) => num(i)));
    case 'max':
      return Math.max(...args.map((_, i) => num(i)));
    case 'if':
      for (let i = 0; i + 1 < args.length; i += 2) if (truthy(val(i))) return val(i + 1);
      return args.length % 2 === 1 ? val(args.length - 1) : null;
    case 'exists':
      return val(0) !== null && val(0) !== undefined;
    default:
      throw new Error(`Unsupported operator: ${op}`);
  }
}

function compare(args: JsonLogic[], facts: Facts, fn: (a: number, b: number) => boolean): boolean {
  const values = args.map((a) => evaluate(a, facts));
  if (values.some((v) => v === null || (typeof v === 'number' && Number.isNaN(v)))) return false;
  for (let i = 0; i + 1 < values.length; i++) {
    if (!fn(Number(values[i]), Number(values[i + 1]))) return false;
  }
  return true;
}

export function truthy(v: FactValue): boolean {
  return v !== null && v !== false && v !== 0 && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
}

/** Имена фактов, упомянутых в выражении — для объяснения рекомендации. */
export function referencedFacts(logic: JsonLogic, out = new Set<string>()): Set<string> {
  if (logic === null || typeof logic !== 'object') return out;
  if (Array.isArray(logic)) {
    for (const l of logic) referencedFacts(l, out);
    return out;
  }
  for (const [op, raw] of Object.entries(logic)) {
    if ((op === 'fact' || op === 'var') ) {
      const name = Array.isArray(raw) ? raw[0] : raw;
      if (typeof name === 'string') out.add(name);
    } else referencedFacts(raw, out);
  }
  return out;
}
