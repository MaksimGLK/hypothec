import { D, type Dec, type Kop, rateToFraction, roundKop } from '../money/money.js';

/** Месячная ставка как доля: 16% годовых → 0.013333… */
export function monthlyRate(annualRatePercent: string | Dec): Dec {
  return rateToFraction(annualRatePercent).div(12);
}

/**
 * Аннуитетный платёж: P = B · i / (1 − (1 + i)^−n), округлён до копейки.
 * Банки считают аннуитет по ставке/12 даже при ежедневном начислении процентов.
 */
export function annuityPayment(balanceKop: Kop, annualRatePercent: string | Dec, months: number): Kop {
  if (months <= 0) return balanceKop;
  if (balanceKop <= 0) return 0;
  const i = monthlyRate(annualRatePercent);
  if (i.isZero()) return roundKop(new D(balanceKop).div(months));
  const k = i.div(new D(1).minus(i.plus(1).pow(-months)));
  return roundKop(new D(balanceKop).mul(k));
}

/**
 * Сколько ещё платежей при данном остатке и платеже (округление вверх).
 * Возвращает null, если платёж не покрывает даже проценты.
 */
export function remainingPayments(balanceKop: Kop, annualRatePercent: string | Dec, paymentKop: Kop): number | null {
  if (balanceKop <= 0) return 0;
  if (paymentKop <= 0) return null;
  const i = monthlyRate(annualRatePercent);
  if (i.isZero()) return Math.ceil(balanceKop / paymentKop);
  const bi = new D(balanceKop).mul(i);
  if (bi.gte(paymentKop)) return null;
  const n = new D(1).minus(bi.div(paymentKop)).ln().neg().div(i.plus(1).ln());
  const rounded = n.toDecimalPlaces(0);
  // защита от погрешности: 119.9999999 → 120
  if (n.minus(rounded).abs().lt('1e-9')) return Math.max(1, rounded.toNumber());
  return Math.max(1, n.ceil().toNumber());
}

/** Сумма переплаты по кредиту, взятому на покупку (рассрочка/потребкредит), аннуитетом. */
export function consumerLoanOverpay(amountKop: Kop, annualRatePercent: string, months: number): Kop {
  if (months <= 0 || amountKop <= 0) return 0;
  const pay = annuityPayment(amountKop, annualRatePercent, months);
  return pay * months - amountKop;
}
