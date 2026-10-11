import { addMonths, daysInMonth, type IsoDate, monthKey, parseDate } from '../date/date.js';
import { type ExpenseContext, livingActiveOn, type LivingExpenseInput } from '../expenses/expenses.js';
import { D, type Kop, roundKop } from '../money/money.js';

export type BudgetGroup = 'home' | 'food' | 'transport' | 'kids' | 'health' | 'personal' | 'leisure' | 'other';

export const BUDGET_GROUP_LABELS: Record<BudgetGroup, string> = {
  home: 'Дом',
  food: 'Еда',
  transport: 'Транспорт',
  kids: 'Дети',
  health: 'Здоровье',
  personal: 'Личное',
  leisure: 'Отдых',
  other: 'Другое',
};

export interface BudgetCatalogItem {
  key: string;
  name: string;
  group: BudgetGroup;
  /** Обязательная трата: входит в подушку и стресс-тест. */
  essential: boolean;
  /** Слова для быстрого ввода: «пятёрочка 1200» → «Продукты». */
  aliases: string[];
  /** Предлагать в стартовом наборе. */
  starter: boolean;
}

/** Типовые категории расходов на жизнь. Суммы пользователь вводит сам — у всех они разные. */
export const BUDGET_CATALOG: BudgetCatalogItem[] = [
  { key: 'utilities', name: 'Коммуналка', group: 'home', essential: true, starter: true, aliases: ['жкх', 'квартплата', 'свет', 'вода', 'газ', 'электричество', 'отопление'] },
  { key: 'rent', name: 'Аренда жилья', group: 'home', essential: true, starter: false, aliases: ['аренда', 'съём', 'хозяйке'] },
  { key: 'groceries', name: 'Продукты', group: 'food', essential: true, starter: true, aliases: ['еда', 'магазин', 'пятёрочка', 'пятерочка', 'перекрёсток', 'перекресток', 'магнит', 'лента', 'ашан', 'вкусвилл', 'овощи', 'продуктовый'] },
  { key: 'cafe', name: 'Кафе и доставка', group: 'food', essential: false, starter: true, aliases: ['кафе', 'ресторан', 'доставка', 'обед', 'кофе', 'пицца', 'суши'] },
  { key: 'transport', name: 'Транспорт', group: 'transport', essential: true, starter: true, aliases: ['метро', 'автобус', 'проезд', 'такси', 'электричка'] },
  { key: 'car', name: 'Машина', group: 'transport', essential: true, starter: false, aliases: ['бензин', 'топливо', 'заправка', 'азс', 'парковка', 'автомойка', 'шиномонтаж', 'осаго', 'каско'] },
  { key: 'mobile', name: 'Связь и интернет', group: 'home', essential: true, starter: true, aliases: ['телефон', 'связь', 'интернет', 'мобильный'] },
  { key: 'kids_activities', name: 'Кружки и секции', group: 'kids', essential: false, starter: true, aliases: ['кружок', 'кружки', 'секция', 'тренировка', 'бассейн', 'футбол', 'танцы', 'музыка', 'репетитор', 'занятия', 'карате', 'каратэ', 'спорт', 'йога', 'гимнастика', 'хоккей', 'рисование', 'английский'] },
  { key: 'kids_school', name: 'Садик и школа', group: 'kids', essential: true, starter: false, aliases: ['садик', 'сад', 'школа', 'продлёнка', 'продленка', 'питание в школе'] },
  { key: 'kids_other', name: 'Дети: одежда и прочее', group: 'kids', essential: true, starter: false, aliases: ['подгузники', 'детское', 'игрушки'] },
  { key: 'health', name: 'Здоровье и аптека', group: 'health', essential: true, starter: true, aliases: ['аптека', 'лекарства', 'врач', 'анализы', 'стоматолог', 'зубы'] },
  { key: 'clothes', name: 'Одежда и обувь', group: 'personal', essential: false, starter: true, aliases: ['одежда', 'обувь', 'кроссовки', 'куртка'] },
  { key: 'household', name: 'Бытовые мелочи', group: 'home', essential: true, starter: false, aliases: ['бытовая химия', 'хозтовары', 'химия', 'порошок'] },
  { key: 'subscriptions', name: 'Подписки', group: 'leisure', essential: false, starter: false, aliases: ['подписка', 'кино онлайн', 'музыка онлайн'] },
  { key: 'leisure', name: 'Развлечения', group: 'leisure', essential: false, starter: true, aliases: ['кино', 'театр', 'развлечения', 'выходные', 'хобби'] },
  { key: 'gifts', name: 'Подарки', group: 'leisure', essential: false, starter: false, aliases: ['подарок', 'день рождения', 'цветы'] },
  { key: 'pets', name: 'Питомцы', group: 'home', essential: true, starter: false, aliases: ['корм', 'ветеринар', 'кошка', 'собака'] },
  { key: 'unplanned', name: 'Вне плана', group: 'other', essential: false, starter: true, aliases: ['вне плана', 'непредвиденное', 'незапланированное', 'бронь', 'поездка', 'билеты'] },
  { key: 'other', name: 'Другое', group: 'other', essential: false, starter: true, aliases: ['прочее', 'разное'] },
];

export function budgetCatalogItem(key: string | null | undefined): BudgetCatalogItem | undefined {
  return key ? BUDGET_CATALOG.find((c) => c.key === key) : undefined;
}

/** Одна трата: «Продукты, 3 450 ₽, 10 октября». */
export interface SpendingInput {
  id: string;
  categoryId: string | null;
  date: IsoDate;
  amountKop: Kop;
  note?: string | null;
}

export interface BudgetCategoryMonth {
  categoryId: string;
  name: string;
  group: string | null;
  essential: boolean;
  planKop: Kop;
  factKop: Kop;
  /** Сколько ещё можно потратить по плану (отрицательное — перерасход). */
  leftKop: Kop;
  /** Доля плана, уже потраченная (0…∞). */
  progress: number;
  spendingsCount: number;
}

export interface BudgetMonth {
  month: string;
  categories: BudgetCategoryMonth[];
  planKop: Kop;
  factKop: Kop;
  leftKop: Kop;
  essentialPlanKop: Kop;
  /** Сумма перерасходов по категориям (не уменьшается экономией в других). */
  overspendKop: Kop;
  /** Траты без категории. */
  uncategorizedKop: Kop;
  /** Для текущего месяца: сколько дней осталось и сколько можно тратить в день, чтобы уложиться. */
  daysLeft: number | null;
  dailyAllowanceKop: Kop | null;
}

/** План и факт бюджета за месяц `YYYY-MM`. */
export function budgetMonth(
  categories: readonly LivingExpenseInput[],
  spendings: readonly SpendingInput[],
  month: string,
  today: IsoDate,
  ctx: ExpenseContext = {},
): BudgetMonth {
  const monthStart = `${month}-01`;
  const inMonth = spendings.filter((s) => monthKey(s.date) === month);
  const active = categories.filter((c) => livingActiveOn(c, monthStart, ctx) || inMonth.some((s) => s.categoryId === c.id));
  const rows: BudgetCategoryMonth[] = active.map((c) => {
    const own = inMonth.filter((s) => s.categoryId === c.id);
    const fact = own.reduce((sum, s) => sum + s.amountKop, 0);
    const plan = livingActiveOn(c, monthStart, ctx) ? c.amountKop : 0;
    return {
      categoryId: c.id,
      name: c.name,
      group: c.group ?? null,
      essential: c.essential !== false,
      planKop: plan,
      factKop: fact,
      leftKop: plan - fact,
      progress: plan > 0 ? fact / plan : fact > 0 ? Infinity : 0,
      spendingsCount: own.length,
    };
  });
  const known = new Set(categories.map((c) => c.id));
  const uncategorized = inMonth.filter((s) => !s.categoryId || !known.has(s.categoryId)).reduce((sum, s) => sum + s.amountKop, 0);
  const planKop = rows.reduce((s, r) => s + r.planKop, 0);
  const factKop = rows.reduce((s, r) => s + r.factKop, 0) + uncategorized;
  const isCurrent = monthKey(today) === month;
  const t = parseDate(today);
  const daysLeft = isCurrent ? daysInMonth(t.y, t.m) - t.d + 1 : null;
  const leftKop = planKop - factKop;
  return {
    month,
    categories: rows,
    planKop,
    factKop,
    leftKop,
    essentialPlanKop: rows.filter((r) => r.essential).reduce((s, r) => s + r.planKop, 0),
    overspendKop: rows.reduce((s, r) => s + Math.max(0, -r.leftKop), 0) + uncategorized,
    uncategorizedKop: uncategorized,
    daysLeft,
    dailyAllowanceKop: daysLeft ? Math.max(0, Math.floor(leftKop / daysLeft)) : null,
  };
}

/**
 * Средний факт по категориям за последние полные месяцы (до текущего) — подсказка «по факту тратите в среднем …».
 * Учитываются только месяцы, в которые по категории были траты, чтобы новая категория не занижала среднее.
 */
export function averageSpending(spendings: readonly SpendingInput[], today: IsoDate, months = 3): Record<string, { averageKop: Kop; months: number }> {
  const keys = Array.from({ length: months }, (_, i) => monthKey(addMonths(today, -(i + 1))));
  const byCat = new Map<string, Map<string, Kop>>();
  for (const s of spendings) {
    if (!s.categoryId) continue;
    const mk = monthKey(s.date);
    if (!keys.includes(mk)) continue;
    const m = byCat.get(s.categoryId) ?? new Map<string, Kop>();
    m.set(mk, (m.get(mk) ?? 0) + s.amountKop);
    byCat.set(s.categoryId, m);
  }
  const out: Record<string, { averageKop: Kop; months: number }> = {};
  for (const [cat, m] of byCat) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    out[cat] = { averageKop: roundKop(new D(total).div(m.size)), months: m.size };
  }
  return out;
}

export interface SpendingDraft {
  categoryId: string | null;
  amountKop: Kop | null;
  note: string;
}

/**
 * Быстрый ввод траты: «Продукты 3 450», «пятёрочка 1200,50», «кружок по футболу 4000».
 * Категория — по названию или словам-подсказкам из справочника; сумма — первое число.
 */
export function parseSpendingQuickInput(text: string, categories: readonly Pick<LivingExpenseInput, 'id' | 'name' | 'catalogKey'>[]): SpendingDraft {
  const clean = text.replace(/ /g, ' ').trim();
  const m = /(\d{1,3}(?:[ ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(к|k|тыс\.?)?(?=\s|₽|р\.?|руб|$)/i.exec(clean);
  let amountKop: Kop | null = null;
  let note = clean;
  if (m) {
    let value = new D(m[1]!.replace(/ /g, '') + (m[2] ? `.${m[2]}` : ''));
    if (m[3]) value = value.mul(1000);
    amountKop = roundKop(value.mul(100));
    note = (clean.slice(0, m.index) + clean.slice(m.index + m[0].length)).replace(/₽|руб\S*|\sр\.?(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
  }
  const words = note.toLowerCase();
  const first = words.split(' ')[0] ?? '';
  let categoryId: string | null = null;
  let best = 0;
  for (const c of categories) {
    const candidates = [c.name.toLowerCase(), ...(budgetCatalogItem(c.catalogKey)?.aliases ?? [])];
    for (const cand of candidates) {
      // совпадение по основе слова: «продукт» найдёт «Продукты», «пятёрочк» — «пятёрочка»
      const stem = cand.length > 5 ? cand.slice(0, cand.length - 1) : cand;
      const hit = words.includes(stem) || (first.length >= 4 && stem.startsWith(first));
      if (hit && stem.length > best) {
        best = stem.length;
        categoryId = c.id;
      }
    }
  }
  return { categoryId, amountKop, note };
}

export interface DueAutoPayment {
  categoryId: string;
  month: string;
  date: IsoDate;
  amountKop: Kop;
  /** false — за этот месяц уже есть ручная оплата: трату не создаём, только отмечаем месяц обработанным. */
  create: boolean;
}

/**
 * Какие автоплатежи пора записать на сегодня. Правила:
 * - день автоплатежа наступил (31-е в коротком месяце — последний день);
 * - за этот месяц автоплатёж ещё не обрабатывался;
 * - если в категории уже есть трата за этот месяц (оплатили вручную), новая не создаётся — без дублей;
 * - удалённый автоплатёж не возвращается: месяц уже отмечен обработанным.
 */
export function dueAutoPayments(
  categories: readonly LivingExpenseInput[],
  spendings: readonly SpendingInput[],
  today: IsoDate,
  ctx: ExpenseContext = {},
): DueAutoPayment[] {
  const t = parseDate(today);
  const month = monthKey(today);
  const out: DueAutoPayment[] = [];
  for (const c of categories) {
    if (!c.autoPayDay || c.amountKop <= 0) continue;
    if (c.autoPayLastMonth && c.autoPayLastMonth >= month) continue;
    const day = Math.min(c.autoPayDay, daysInMonth(t.y, t.m));
    if (t.d < day) continue;
    if (!livingActiveOn(c, `${month}-01`, ctx)) continue;
    const paid = spendings.some((s) => s.categoryId === c.id && monthKey(s.date) === month);
    out.push({ categoryId: c.id, month, date: `${month}-${String(day).padStart(2, '0')}`, amountKop: c.amountKop, create: !paid });
  }
  return out;
}

export interface TotalAdjustment {
  /** Добавить трату на эту сумму (когда новый итог больше). */
  createKop: Kop;
  /** Уменьшить суммы трат (когда новый итог меньше): с самых свежих. */
  updates: { id: string; amountKop: Kop }[];
  deletes: string[];
}

/**
 * Привести факт категории за месяц к нужному итогу — как правка ячейки «Потрачено» в таблице.
 * Больше — добавляется одна трата на разницу; меньше — уменьшаются самые свежие траты, полностью покрытые удаляются.
 */
export function adjustToTotal(spendings: readonly SpendingInput[], totalKop: Kop): TotalAdjustment {
  const current = spendings.reduce((s, x) => s + x.amountKop, 0);
  const delta = totalKop - current;
  if (delta >= 0) return { createKop: delta, updates: [], deletes: [] };
  let toRemove = -delta;
  const updates: TotalAdjustment['updates'] = [];
  const deletes: string[] = [];
  const newestFirst = [...spendings].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const s of newestFirst) {
    if (toRemove <= 0) break;
    if (s.amountKop <= toRemove) {
      deletes.push(s.id);
      toRemove -= s.amountKop;
    } else {
      updates.push({ id: s.id, amountKop: s.amountKop - toRemove });
      toRemove = 0;
    }
  }
  return { createKop: 0, updates, deletes };
}
