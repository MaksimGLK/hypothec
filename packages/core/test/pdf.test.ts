import { describe, expect, it } from 'vitest';
import { detectBankFromText, type LivingExpenseInput, merchantKey, parsePdfStatement, parseStatement, pdfItemsToLines, type PdfTextItem, rub, suggestCategory, translit } from '../src/index.js';

/** Строка PDF: кусочки текста с левым краем; ширина — примерно по числу символов. */
const line = (page: number, y: number, parts: [number, string][]): PdfTextItem[] => parts.map(([x, str]) => ({ page, x, y, width: str.length * 4.5, str }));

// Т-Банк: «Справка о движении средств» — время и хвост описания на второй строке операции
const TBANK: PdfTextItem[] = [
  ...line(1, 40, [[40, 'АО «ТБанк»'], [300, 'Справка о движении средств']]),
  ...line(1, 60, [[40, 'Движение средств за период с 01.10.2026 по 31.10.2026']]),
  ...line(1, 100, [[40, 'Дата и время'], [110, 'Дата'], [170, 'Сумма в валюте'], [260, 'Сумма операции'], [350, 'Описание операции'], [520, 'Номер']]),
  ...line(1, 110, [[40, 'операции'], [110, 'списания'], [170, 'операции'], [260, 'в валюте карты'], [520, 'карты']]),
  ...line(1, 130, [[40, '05.10.2026'], [110, '06.10.2026'], [170, '-1 250.40 ₽'], [260, '-1 250.40 ₽'], [350, 'Оплата в PYATEROCHKA'], [520, '*1234']]),
  ...line(1, 140, [[40, '18:42'], [110, '00:00'], [350, '1234 Moskva RUS']]),
  ...line(1, 158, [[40, '05.10.2026'], [110, '05.10.2026'], [170, '+100 000.00 ₽'], [260, '+100 000.00 ₽'], [350, 'Пополнение. ООО Ромашка.'], [520, '']]),
  ...line(1, 168, [[40, '09:10'], [110, '09:10'], [350, 'Заработная плата']]),
  ...line(1, 186, [[40, '04.10.2026'], [110, '04.10.2026'], [170, '-450.00 ₽'], [260, '-450.00 ₽'], [350, 'Оплата в SHOKOLADNITSA Moskva'], [520, '*1234']]),
  ...line(1, 196, [[40, '12:00'], [110, '12:01']]),
  ...line(1, 780, [[280, '1 из 2']]),
  ...line(2, 40, [[40, 'Дата и время'], [110, 'Дата'], [170, 'Сумма в валюте'], [260, 'Сумма операции'], [350, 'Описание операции']]),
  ...line(2, 60, [[40, '03.10.2026'], [110, '03.10.2026'], [170, '-20 000.00 ₽'], [260, '-20 000.00 ₽'], [350, 'Перевод между счетами']]),
  ...line(2, 70, [[40, '10:00'], [110, '10:00']]),
  ...line(2, 100, [[40, 'Пополнения: 100 000.00 ₽'], [260, 'Расходы: 21 700.40 ₽']]),
];

// ВТБ: суммы без знака, направление видно только по описанию
const VTB: PdfTextItem[] = [
  ...line(1, 30, [[40, 'Банк ВТБ (ПАО)'], [300, 'Выписка по счёту 40817810...']]),
  ...line(1, 60, [[40, 'Дата операции'], [120, 'Дата обработки'], [200, 'Сумма операции'], [300, 'Основание операции']]),
  ...line(1, 80, [[40, '06.10.2026 11:15'], [120, '07.10.2026'], [200, '890,00 RUB'], [300, 'МТС оплата связи']]),
  ...line(1, 95, [[40, '06.10.2026 13:00'], [120, '07.10.2026'], [200, '12 000,00 RUB'], [300, 'ЖКУ Мосэнергосбыт']]),
  ...line(1, 110, [[40, '07.10.2026 09:00'], [120, '07.10.2026'], [200, '150 000,00 RUB'], [300, 'Зачисление заработной платы']]),
];

// Альфа-Банк: строки остатков с датой — не операции
const ALFA: PdfTextItem[] = [
  ...line(1, 30, [[40, 'АО «АЛЬФА-БАНК»'], [300, 'Выписка по счёту']]),
  ...line(1, 50, [[40, '01.10.2026'], [120, 'Входящий остаток'], [400, '10 000,00 RUR']]),
  ...line(1, 70, [[40, 'Дата проводки'], [120, 'Код'], [200, 'Описание'], [400, 'Сумма в валюте счёта']]),
  ...line(1, 90, [[40, '07.10.2026'], [120, 'CRD_123'], [200, 'Yandex Go taxi'], [400, '-650,00 RUR']]),
  ...line(1, 100, [[200, '4276 38** **** 1234']]),
  ...line(1, 115, [[40, '08.10.2026'], [120, 'CRD_125'], [200, 'Снятие наличных в банкомате'], [400, '-5 000,00 RUR']]),
  ...line(1, 140, [[40, '31.10.2026'], [120, 'Исходящий остаток'], [400, '4 350,00 RUR']]),
];

describe('PDF-выписки', () => {
  it('склеивает кусочки текста в строки и ячейки', () => {
    const lines = pdfItemsToLines([
      { page: 1, x: 10, y: 50.4, width: 20, str: 'Оплата' },
      { page: 1, x: 32, y: 50, width: 20, str: 'в Пятёрочке' },
      { page: 1, x: 200, y: 51, width: 20, str: '-100,00' },
      { page: 1, x: 10, y: 20, width: 20, str: 'Шапка' },
    ]);
    expect(lines.map((l) => l.cells)).toEqual([['Шапка'], ['Оплата в Пятёрочке', '-100,00']]);
  });

  it('определяет банк по шапке', () => {
    expect(detectBankFromText('АО «ТБанк» ... Т-Банк')).toBe('tbank');
    expect(detectBankFromText('Банк ВТБ (ПАО)')).toBe('vtb');
    expect(detectBankFromText('АО «АЛЬФА-БАНК»')).toBe('alfa');
    expect(detectBankFromText('Справка')).toBe('unknown');
  });

  it('Т-Банк: многострочные операции, перенос на вторую страницу, подвал и итоги не попадают', () => {
    const r = parsePdfStatement(TBANK);
    expect(r.bank).toBe('tbank');
    expect(r.rows.slice(1)).toEqual([
      ['05.10.2026', '-1 250.40', 'Оплата в PYATEROCHKA 1234 Moskva RUS'],
      ['05.10.2026', '100 000.00', 'Пополнение. ООО Ромашка. Заработная плата'],
      ['04.10.2026', '-450.00', 'Оплата в SHOKOLADNITSA Moskva'],
      ['03.10.2026', '-20 000.00', 'Перевод между счетами'],
    ]);
    const parsed = parseStatement(r.rows, undefined, r.bank);
    expect(parsed.bank).toBe('tbank');
    expect(parsed.errors).toEqual([]);
    expect(parsed.operations.map((o) => [o.kind, o.amountKop])).toEqual([
      ['expense', 125_040],
      ['income', 10_000_000],
      ['expense', 45_000],
      ['transfer', 2_000_000],
    ]);
  });

  it('ВТБ: сумма без знака — поступление узнаётся по описанию', () => {
    const r = parsePdfStatement(VTB);
    expect(r.bank).toBe('vtb');
    const parsed = parseStatement(r.rows, undefined, r.bank);
    expect(parsed.operations.map((o) => [o.date, o.outflow, o.amountKop, o.description])).toEqual([
      ['2026-10-06', true, 89_000, 'МТС оплата связи'],
      ['2026-10-06', true, 1_200_000, 'ЖКУ Мосэнергосбыт'],
      ['2026-10-07', false, 15_000_000, 'Зачисление заработной платы'],
    ]);
  });

  it('Альфа-Банк: остатки пропускаются, номер карты убирается из описания', () => {
    const r = parsePdfStatement(ALFA);
    expect(r.bank).toBe('alfa');
    expect(r.rows.slice(1)).toEqual([
      ['07.10.2026', '-650,00', 'CRD_123 Yandex Go taxi'],
      ['08.10.2026', '-5 000,00', 'CRD_125 Снятие наличных в банкомате'],
    ]);
    const kinds = parseStatement(r.rows, undefined, r.bank).operations.map((o) => o.kind);
    expect(kinds).toEqual(['expense', 'cash']);
  });
});

describe('категории для получателей латиницей', () => {
  const cats: LivingExpenseInput[] = [
    { id: 'food', name: 'Продукты', amountKop: rub(40_000), catalogKey: 'groceries' },
    { id: 'cafe', name: 'Кафе и доставка', amountKop: rub(10_000), catalogKey: 'cafe' },
    { id: 'car', name: 'Машина', amountKop: rub(10_000), catalogKey: 'car' },
    { id: 'util', name: 'Коммуналка', amountKop: rub(12_000), catalogKey: 'utilities' },
  ];
  const sug = (description: string) => suggestCategory({ description, bankCategory: null, mcc: null, merchantKey: merchantKey(description) }, cats);

  it('узнаёт магазины, кафе и АЗС из выписки по карте', () => {
    expect(sug('Оплата в PYATEROCHKA 1234 Moskva RUS')).toEqual({ categoryId: 'food', reason: 'keyword' });
    expect(sug('Оплата в SHOKOLADNITSA Moskva RUS')).toEqual({ categoryId: 'cafe', reason: 'merchant' });
    expect(sug('Оплата в LUKOIL AZS 123 Moskva RUS')).toEqual({ categoryId: 'car', reason: 'merchant' });
    expect(translit('Перекрёсток')).toBe('perekrestok');
  });

  it('короткие слова в транслите не дают ложных совпадений', () => {
    // «газ» из подсказок коммуналки не должен ловить GAZETA
    expect(sug('Оплата в GAZETA KIOSK')).toEqual({ categoryId: null, reason: 'none' });
  });
});
