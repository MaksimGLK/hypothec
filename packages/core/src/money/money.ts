import Decimal from 'decimal.js';

/**
 * Денежная сумма в копейках. Всегда целое число.
 * Максимум безопасного целого (2^53) — около 90 трлн ₽, этого хватает с запасом.
 */
export type Kop = number;

/** Отдельный экземпляр Decimal, чтобы не зависеть от глобальных настроек других модулей. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

export function assertKop(value: number, name = 'amount'): asserts value is Kop {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be an integer number of kopecks, got ${value}`);
  }
}

/** Округление до копейки по правилу банков: половина — вверх (от нуля). */
export function roundKop(value: Decimal.Value): Kop {
  const d = new D(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return d.toNumber();
}

export function rub(rubles: number): Kop {
  return roundKop(new D(rubles).mul(100));
}

export function kopToRubDecimal(kop: Kop): Decimal {
  return new D(kop).div(100);
}

export function sumKop(values: readonly Kop[]): Kop {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function minKop(a: Kop, b: Kop): Kop {
  return a < b ? a : b;
}

export function maxKop(a: Kop, b: Kop): Kop {
  return a > b ? a : b;
}

/** Делит сумму пропорционально весам без потери копеек (метод наибольшего остатка). */
export function splitKop(total: Kop, weights: readonly number[]): Kop[] {
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (wSum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => new D(total).mul(w).div(wSum));
  const floored = raw.map((r) => r.floor().toNumber());
  let rest = total - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r.minus(r.floor()).toNumber() }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) {
    floored[order[k]!.i]! += 1;
  }
  return floored;
}

const NBSP = ' ';

/**
 * Форматирует сумму: «1 234 567 ₽» или «1 234 567,89 ₽».
 * По умолчанию копейки показываются, только если они не нулевые.
 */
export function formatRub(kop: Kop, opts: { kopecks?: 'auto' | 'always' | 'never' } = {}): string {
  const mode = opts.kopecks ?? 'auto';
  const negative = kop < 0;
  const abs = Math.abs(kop);
  let rubles = Math.floor(abs / 100);
  let cents = abs % 100;
  if (mode === 'never' && cents !== 0) {
    const rounded = roundKop(new D(abs).div(100));
    rubles = rounded;
    cents = 0;
  }
  const grouped = String(rubles).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const showCents = mode === 'always' || (mode === 'auto' && cents !== 0);
  const body = showCents ? `${grouped},${String(cents).padStart(2, '0')}` : grouped;
  return `${negative ? '−' : ''}${body}${NBSP}₽`;
}

/** Годовая ставка в процентах как строка/число → доля (16 → 0.16). */
export function rateToFraction(annualRatePercent: Decimal.Value): Decimal {
  return new D(annualRatePercent).div(100);
}
