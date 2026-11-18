import { describe, expect, it } from 'vitest';
import { client, register, setupApp } from './helpers.js';

const ctx = setupApp();
const rows = [
  ['Дата операции', 'Дата платежа', 'Номер карты', 'Статус', 'Сумма операции', 'Валюта операции', 'Кэшбэк', 'Категория', 'MCC', 'Описание'],
  ['05.10.2026 18:42:11', '05.10.2026', '*1234', 'OK', '-1250,40', 'RUB', '', 'Супермаркеты', '5411', 'Пятёрочка'],
  ['05.10.2026 09:10:00', '05.10.2026', '*1234', 'OK', '-450,00', 'RUB', '', 'Рестораны', '5812', 'Шоколадница'],
  ['04.10.2026 12:00:00', '04.10.2026', '', 'OK', '-20000,00', 'RUB', '', 'Переводы', '', 'Перевод между счетами'],
  ['03.10.2026 10:00:00', '03.10.2026', '', 'OK', '100000,00', 'RUB', '', 'Пополнения', '', 'Зарплата'],
  ['02.10.2026 15:31:00', '02.10.2026', '*1234', 'OK', '-777,00', 'RUB', '', 'Другое', '', 'ООО Неизвестно'],
];

describe('импорт выписки', () => {
  it('предпросмотр → внесение → повторная загрузка без дублей → запомненные исправления', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    await api('POST', p('/budget/bootstrap'), {});
    const cats = (await api('GET', p('/living-expenses'))).data as { id: string; catalogKey: string }[];
    const food = cats.find((c) => c.catalogKey === 'groceries')!;
    const other = cats.find((c) => c.catalogKey === 'other')!;

    const prev = await api('POST', p('/budget/import/preview'), { rows });
    expect(prev.statusCode, prev.body).toBe(200);
    expect(prev.data.bank).toBe('tbank');
    expect(prev.data.summary).toMatchObject({ expenseKop: 125_040 + 45_000 + 77_700, incomeKop: 10_000_000, transferKop: 2_000_000, duplicates: 0 });
    const ops = prev.data.operations as { kind: string; importKey: string; merchantKey: string; date: string; amountKop: number; description: string; suggestion: { categoryId: string | null; reason: string } }[];
    const pyat = ops.find((o) => o.description === 'Пятёрочка')!;
    expect(pyat.suggestion).toMatchObject({ categoryId: food.id, reason: 'keyword' });
    const unknown = ops.find((o) => o.description === 'ООО Неизвестно')!;
    expect(unknown.suggestion.categoryId).toBeNull();

    const expenses = ops.filter((o) => o.kind === 'expense');
    const items = expenses.map((o) => ({ importKey: o.importKey, merchantKey: o.merchantKey, date: o.date, amountKop: o.amountKop, description: o.description, categoryId: o === unknown ? other.id : o.suggestion.categoryId }));
    const commit = await api('POST', p('/budget/import/commit'), { items, learn: true });
    expect(commit.data).toMatchObject({ created: 3, skipped: 0 });
    const spendings = (await api('GET', p('/budget/spendings?month=2026-10'))).data as { source: string }[];
    expect(spendings.filter((x) => x.source === 'import')).toHaveLength(3);

    // та же выписка ещё раз — помечено как уже внесённое, повторно не вносится
    const again = await api('POST', p('/budget/import/preview'), { rows });
    expect(again.data.summary.duplicates).toBe(3);
    expect((await api('POST', p('/budget/import/commit'), { items, learn: false })).data).toMatchObject({ created: 0, skipped: 3 });
    // исправление запомнилось: «ООО Неизвестно» теперь сразу в «Другое»
    const learned = (again.data.operations as typeof ops).find((o) => o.description === 'ООО Неизвестно')!;
    expect(learned.suggestion).toMatchObject({ categoryId: other.id, reason: 'rule' });
  });

  it('неизвестный формат — сопоставление столбцов вручную', async () => {
    const s = await register(ctx);
    const api = client(ctx, s.token);
    const p = (x: string) => `/households/${s.householdId}${x}`;
    const odd = [['Когда', 'Сколько', 'Что'], ['05.10.2026', '-200', 'Кофе']];
    const r1 = await api('POST', p('/budget/import/preview'), { rows: odd });
    expect(r1.data.mapping).toBeNull();
    expect(r1.data.errors[0].message).toMatch(/Не нашли столбцы/);
    const r2 = await api('POST', p('/budget/import/preview'), { rows: odd, manual: { headerRow: 0, mapping: { date: 0, amount: 1, description: 2 } } });
    expect(r2.data.operations).toHaveLength(1);
  });
});
