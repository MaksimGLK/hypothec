import { describe, expect, it } from 'vitest';
import {
  addMonths,
  daysBetween,
  formatDateRu,
  formatRub,
  parseDate,
  roundKop,
  rub,
  splitKop,
} from '../src/index.js';

describe('деньги', () => {
  it('округляет до копейки по-банковски: половина вверх', () => {
    expect(roundKop('100.5')).toBe(101);
    expect(roundKop('100.4999')).toBe(100);
    expect(roundKop('-100.5')).toBe(-101);
  });

  it('rub() переводит рубли в копейки без ошибок float', () => {
    expect(rub(0.1 + 0.2)).toBe(30);
    expect(rub(10_315_920)).toBe(1_031_592_000);
  });

  it('splitKop делит без потери копеек', () => {
    const parts = splitKop(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
    expect(splitKop(1000, [0, 0])).toEqual([0, 0]);
  });

  it('форматирует суммы с разделителями и знаком ₽', () => {
    expect(formatRub(rub(1_234_567))).toBe('1 234 567 ₽');
    expect(formatRub(17_280_520)).toBe('172 805,20 ₽');
    expect(formatRub(17_280_520, { kopecks: 'never' })).toBe('172 805 ₽');
    expect(formatRub(-5000)).toBe('−50 ₽');
  });
});

describe('даты', () => {
  it('сдвиг на месяц сохраняет день или берёт последний день месяца', () => {
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2025-02-28', 1, 31)).toBe('2025-03-31');
    expect(addMonths('2025-11-15', 3)).toBe('2026-02-15');
  });

  it('считает дни с учётом високосного года', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2025-02-28', '2025-03-01')).toBe(1);
  });

  it('отклоняет несуществующие даты', () => {
    expect(() => parseDate('2025-02-30')).toThrow();
    expect(() => parseDate('15.03.2025')).toThrow();
  });

  it('пишет даты по-русски', () => {
    expect(formatDateRu('2027-03-15')).toBe('15 марта 2027');
  });
});
