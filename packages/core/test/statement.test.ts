import { describe, expect, it } from 'vitest';
import { type LivingExpenseInput, merchantKey, parseCsvText, parseSignedMoney, parseStatement, parseStatementDate, rub, suggestCategory } from '../src/index.js';

const csv = (text: string) => text.trim().split('\n').map((l) => l.split(';').map((c) => c.replace(/^"|"$/g, '')));

const cats: LivingExpenseInput[] = [
  { id: 'food', name: 'Продукты', amountKop: rub(40_000), catalogKey: 'groceries' },
  { id: 'cafe', name: 'Кафе и доставка', amountKop: rub(10_000), catalogKey: 'cafe' },
  { id: 'tr', name: 'Транспорт', amountKop: rub(12_000), catalogKey: 'transport' },
  { id: 'mob', name: 'Связь и интернет', amountKop: rub(1_000), catalogKey: 'mobile' },
  { id: 'kids', name: 'Кружки и секции', amountKop: rub(10_000), catalogKey: 'kids_activities' },
  { id: 'util', name: 'Коммуналка', amountKop: rub(12_000), catalogKey: 'utilities' },
];

const TBANK = `
"Дата операции";"Дата платежа";"Номер карты";"Статус";"Сумма операции";"Валюта операции";"Сумма платежа";"Валюта платежа";"Кэшбэк";"Категория";"MCC";"Описание";"Бонусы (включая кэшбэк)";"Округление на инвесткопилку";"Сумма операции с округлением"
"05.10.2026 18:42:11";"05.10.2026";"*1234";"OK";"-1250,40";"RUB";"-1250,40";"RUB";"";"Супермаркеты";"5411";"Пятёрочка";"12,00";"0,00";"1250,40"
"05.10.2026 09:10:00";"05.10.2026";"*1234";"OK";"-450,00";"RUB";"-450,00";"RUB";"";"Рестораны";"5812";"Шоколадница";"4,00";"0,00";"450,00"
"04.10.2026 21:00:00";"04.10.2026";"*1234";"FAILED";"-3000,00";"RUB";"-3000,00";"RUB";"";"Топливо";"5541";"Лукойл";"0";"0";"3000,00"
"04.10.2026 12:00:00";"04.10.2026";"";"OK";"-20000,00";"RUB";"-20000,00";"RUB";"";"Переводы";"";"Перевод между счетами";"0";"0";"20000,00"
"03.10.2026 10:00:00";"03.10.2026";"";"OK";"100000,00";"RUB";"100000,00";"RUB";"";"Пополнения";"";"Зарплата ООО Ромашка";"0";"0";"100000,00"
"02.10.2026 15:30:00";"02.10.2026";"*1234";"OK";"-2500,00";"RUB";"-2500,00";"RUB";"";"Топливо";"5541";"Лукойл АЗС 123";"25";"0";"2500,00"
"02.10.2026 15:31:00";"02.10.2026";"*1234";"OK";"-4000,00";"RUB";"-4000,00";"RUB";"";"Другое";"8299";"ИП Иванова Каратэ";"0";"0";"4000,00"
`;

const VTB = `
Выписка по счёту 40817810...
Номер карты/счета/договора;Дата операции;Дата обработки;Сумма операции;Валюта операции;Сумма пересчитанная в валюте счета;Валюта счета;Основание операции;Статус
*5678;06.10.2026 11:15:00;07.10.2026;-890,00;RUB;-890,00;RUB;МТС оплата связи;Исполнено
*5678;06.10.2026 13:00:00;07.10.2026;-12 000,00;RUB;-12 000,00;RUB;ЖКУ Мосэнергосбыт;Исполнено
*5678;06.10.2026 14:00:00;07.10.2026;-172 805,20;RUB;-172 805,20;RUB;Погашение кредита по договору ипотеки;Исполнено
`;

const ALFA = `
Тип счёта;Номер счета;Валюта;Дата;Референс проводки;Описание операции;Приход;Расход
Текущий счёт;40817...;RUR;07.10.26;CRD_123;Yandex Go taxi;0;650,00
Текущий счёт;40817...;RUR;07.10.26;CRD_124;Снятие наличных в банкомате;0;5 000,00
Текущий счёт;40817...;RUR;08.10.26;CRD_125;Поступление зарплаты;150 000,00;0
`;

describe('разбор выписок', () => {
  it('Т-Банк: банк, суммы, исключение неуспешных и переводов, поступления отдельно', () => {
    const r = parseStatement(csv(TBANK));
    expect(r.bank).toBe('tbank');
    expect(r.errors).toEqual([]);
    expect(r.operations).toHaveLength(7);
    const first = r.operations[0]!;
    expect(first).toMatchObject({ date: '2026-10-05', amountKop: 125_040, outflow: true, bankCategory: 'Супермаркеты', mcc: '5411', kind: 'expense' });
    expect(r.operations.map((o) => o.kind)).toEqual(['expense', 'expense', 'failed', 'transfer', 'income', 'expense', 'expense']);
  });

  it('ВТБ: шапка над таблицей, суммы с пробелами, погашение ипотеки — не расход на жизнь', () => {
    const r = parseStatement(csv(VTB));
    expect(r.bank).toBe('vtb');
    expect(r.headerRow).toBe(1);
    expect(r.operations.map((o) => [o.amountKop, o.kind])).toEqual([
      [89_000, 'expense'],
      [1_200_000, 'expense'],
      [17_280_520, 'loan'],
    ]);
  });

  it('Альфа-Банк: отдельные колонки приход/расход, наличные', () => {
    const r = parseStatement(csv(ALFA));
    expect(r.bank).toBe('alfa');
    expect(r.operations.map((o) => [o.date, o.amountKop, o.outflow, o.kind])).toEqual([
      ['2026-10-07', 65_000, true, 'expense'],
      ['2026-10-07', 500_000, true, 'cash'],
      ['2026-10-08', 15_000_000, false, 'income'],
    ]);
  });

  it('повторная загрузка даёт те же ключи; одинаковые траты в один день различаются', () => {
    const a = parseStatement(csv(TBANK)).operations.map((o) => o.importKey);
    const b = parseStatement(csv(TBANK)).operations.map((o) => o.importKey);
    expect(a).toEqual(b);
    const twice = parseStatement(csv(`Дата;Сумма;Описание\n05.10.2026;-200;Кофе Хауз\n05.10.2026;-200;Кофе Хауз`)).operations;
    expect(twice[0]!.importKey).not.toBe(twice[1]!.importKey);
  });

  it('без нужных столбцов — понятная ошибка; ручное сопоставление работает', () => {
    const rows = csv(`Когда;Сколько;Что\n05.10.2026;-200;Кофе`);
    expect(parseStatement(rows).errors[0]!.message).toMatch(/Не нашли столбцы/);
    const manual = parseStatement(rows, { headerRow: 0, mapping: { date: 0, amount: 1, description: 2 } });
    expect(manual.operations[0]).toMatchObject({ amountKop: 20_000, outflow: true });
  });

  it('числа и даты в разных форматах, включая значения из Excel', () => {
    expect(parseSignedMoney('−1 250,40 ₽')).toBe(-125_040);
    expect(parseSignedMoney('1,250.40')).toBe(125_040);
    expect(parseSignedMoney(-450.5)).toBe(-45_050);
    expect(parseStatementDate('05.10.2026 18:42:11')).toBe('2026-10-05');
    expect(parseStatementDate(new Date(2026, 9, 5, 18, 42))).toBe('2026-10-05');
    expect(parseStatementDate('2026-10-05T10:00')).toBe('2026-10-05');
  });
});

describe('подбор категории', () => {
  const ops = parseStatement(csv(TBANK)).operations;
  const byDesc = (d: string) => ops.find((o) => o.description.startsWith(d))!;

  it('по названию, категории банка и MCC', () => {
    expect(suggestCategory(byDesc('Пятёрочка'), cats)).toEqual({ categoryId: 'food', reason: 'keyword' });
    expect(suggestCategory(byDesc('Шоколадница'), cats)).toEqual({ categoryId: 'cafe', reason: 'bank_category' });
    // «Топливо» → категории «Машина» нет, есть «Транспорт»
    expect(suggestCategory(byDesc('Лукойл АЗС'), cats).categoryId).toBe('tr');
    expect(suggestCategory(byDesc('ИП Иванова'), cats)).toEqual({ categoryId: 'kids', reason: 'keyword' });
  });

  it('запомненное исправление важнее всего остального', () => {
    const op = byDesc('Шоколадница');
    expect(suggestCategory(op, cats, [{ merchantKey: op.merchantKey, categoryId: 'food' }])).toEqual({ categoryId: 'food', reason: 'rule' });
  });

  it('ключ получателя не зависит от номеров и городов', () => {
    expect(merchantKey('Лукойл АЗС 123 MOSCOW RUS')).toBe(merchantKey('ЛУКОЙЛ АЗС 456'));
  });

  it('незнакомое — без категории', () => {
    expect(suggestCategory({ description: 'ООО Неизвестно', bankCategory: null, mcc: null, merchantKey: 'ооо неизвестно' }, cats)).toEqual({ categoryId: null, reason: 'none' });
  });
});

describe('CSV', () => {
  it('кавычки, «;» внутри кавычек, BOM и Windows-переводы строк', () => {
    const rows = parseCsvText('﻿"Дата";"Описание";"Сумма"\r\n"05.10.2026";"ООО ""Ромашка""; кафе";"-1 250,00"\r\n');
    expect(rows).toEqual([
      ['Дата', 'Описание', 'Сумма'],
      ['05.10.2026', 'ООО "Ромашка"; кафе', '-1 250,00'],
    ]);
  });
  it('разделитель — запятая', () => {
    expect(parseCsvText('Дата,Сумма,Описание\n05.10.2026,-200,Кофе')[1]).toEqual(['05.10.2026', '-200', 'Кофе']);
  });
});
