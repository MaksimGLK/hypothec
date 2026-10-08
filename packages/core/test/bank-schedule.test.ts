import { describe, expect, it } from 'vitest';
import { buildSchedule, formatDate, parseBankScheduleCsv, parseDate, parseMoneyCell, reconcileWithBank } from '../src/index.js';
import { REFERENCE_LOAN } from './fixtures.js';

function toCsv(rows: { date: string; paymentKop: number; interestKop: number; principalKop: number; balanceKop: number }[]): string {
  const money = (k: number) => `${Math.floor(k / 100).toLocaleString('ru-RU')},${String(k % 100).padStart(2, '0')}`;
  const ru = (d: string) => {
    const p = parseDate(d);
    return `${String(p.d).padStart(2, '0')}.${String(p.m).padStart(2, '0')}.${p.y}`;
  };
  return [
    '﻿График платежей по договору № 123',
    'Дата платежа;Сумма платежа;Проценты;Основной долг;Остаток задолженности',
    ...rows.map((r) => [ru(r.date), money(r.paymentKop), money(r.interestKop), money(r.principalKop), money(r.balanceKop)].join(';')),
  ].join('\r\n');
}

describe('импорт графика из банка (CSV)', () => {
  it('разбирает суммы в разных форматах', () => {
    expect(parseMoneyCell('172 805,20')).toBe(17_280_520);
    expect(parseMoneyCell('172 805,20 ₽')).toBe(17_280_520);
    expect(parseMoneyCell('172805.20')).toBe(17_280_520);
    expect(parseMoneyCell('1,234,567.89')).toBe(123_456_789);
    expect(parseMoneyCell('1.234.567,89')).toBe(123_456_789);
    expect(parseMoneyCell('—')).toBeNull();
  });

  it('находит колонки по заголовкам и пропускает шапку', () => {
    const s = buildSchedule(REFERENCE_LOAN);
    const csv = toCsv(s.rows.slice(0, 3));
    const r = parseBankScheduleCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({ date: '2025-02-15', paymentKop: 17_280_520, interestKop: 13_754_560, principalKop: 3_525_960, balanceKop: 1_028_066_040 });
  });

  it('сообщает о битых строках и отсутствии нужных колонок', () => {
    expect(parseBankScheduleCsv('Дата;Проценты\n01.01.2025;100').errors[0]!.message).toMatch(/Сумма платежа/);
    const r = parseBankScheduleCsv('Дата,Платёж\n01.01.2025,100\nабв,где');
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
  });

  it('сверка: совпадающий график без расхождений', () => {
    const s = buildSchedule(REFERENCE_LOAN);
    const bank = parseBankScheduleCsv(toCsv(s.rows)).rows;
    const res = reconcileWithBank(bank, s);
    expect(res.mismatched).toBe(0);
    expect(res.matched).toBe(120);
  });

  it('сверка: банк считает по дням — подсказываем режим', () => {
    const bankSchedule = buildSchedule({ ...REFERENCE_LOAN, interestMode: 'daily' });
    // банк фиксирует платёж, а проценты считает по дням
    const bank = parseBankScheduleCsv(toCsv(bankSchedule.rows.slice(0, 12))).rows.map((r) => ({ ...r, paymentKop: 17_280_520 }));
    const res = reconcileWithBank(bank, buildSchedule(REFERENCE_LOAN));
    expect(res.mismatched).toBeGreaterThan(0);
    expect(res.hint).toMatch(/по дням/);
  });

  it('сверка: даты сдвинуты на выходные (±5 дней) сопоставляются', () => {
    const s = buildSchedule(REFERENCE_LOAN);
    const bank = parseBankScheduleCsv(toCsv(s.rows.slice(0, 2))).rows.map((r) => {
      const p = parseDate(r.date);
      return { ...r, date: formatDate({ ...p, d: p.d + 2 }) };
    });
    const res = reconcileWithBank(bank, s);
    expect(res.items.every((i) => i.calculatedDate !== null)).toBe(true);
  });
});
