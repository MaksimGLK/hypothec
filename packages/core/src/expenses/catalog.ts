import type { ExpenseCategory, Recurrence } from './expenses.js';
import { rub, type Kop } from '../money/money.js';
import type { HousingType } from '../stages/templates.js';

export interface ExpenseCatalogItem {
  key: string;
  name: string;
  category: ExpenseCategory;
  recurrence: Recurrence;
  /** К какому этапу относится. */
  stageKey: string;
  /** Ориентир для плана — пользователь всегда может поменять. */
  defaultPlanKop: Kop;
  /** Для страховок — ориентировочный процент от остатка долга. */
  percentOfLoanBalance?: string;
  priority?: 1 | 2 | 3;
  housing?: HousingType[];
  /** Простое объяснение: что это и зачем. */
  hint: string;
}

/**
 * Справочник типовых расходов. Суммы — ориентиры для черновика плана, а не цены конкретных компаний.
 */
export const EXPENSE_CATALOG: ExpenseCatalogItem[] = [
  // обязательные
  {
    key: 'down_payment',
    name: 'Первоначальный взнос',
    category: 'mandatory',
    recurrence: 'once',
    stageKey: 'settlement',
    defaultPlanKop: 0,
    hint: 'Своя часть стоимости жилья. Обычно вносится в день расчётов вместе с деньгами банка.',
  },
  {
    key: 'appraisal',
    name: 'Оценка квартиры',
    category: 'mandatory',
    recurrence: 'once',
    stageKey: 'appraisal',
    defaultPlanKop: rub(7_000),
    hint: 'Банк должен знать, сколько стоит залог. Оценщика выбираете вы из списка, который одобрил банк.',
  },
  {
    key: 'property_insurance',
    name: 'Страхование залога (квартиры)',
    category: 'mandatory',
    recurrence: 'yearly',
    stageKey: 'insurance',
    defaultPlanKop: 0,
    percentOfLoanBalance: '0.15',
    hint: 'Обязательно по закону для ипотеки. Продлевается каждый год, сумма зависит от остатка долга. Страховщика можно выбрать самому среди аккредитованных банком.',
  },
  {
    key: 'state_duty',
    name: 'Госпошлина за регистрацию',
    category: 'mandatory',
    recurrence: 'once',
    stageKey: 'registration',
    defaultPlanKop: rub(4_000),
    hint: 'Оплата Росреестру за регистрацию права собственности. Точную сумму проверьте на сайте Росреестра или Госуслуг.',
  },
  {
    key: 'settlement_service',
    name: 'Расчёты: аккредитив, СБР или ячейка',
    category: 'mandatory',
    recurrence: 'once',
    stageKey: 'settlement',
    defaultPlanKop: rub(5_000),
    housing: ['secondary', 'house'],
    hint: 'Безопасный способ передать деньги продавцу: он получит их только после регистрации сделки.',
  },
  {
    key: 'e_registration',
    name: 'Электронная регистрация сделки',
    category: 'optional',
    recurrence: 'once',
    stageKey: 'registration',
    defaultPlanKop: rub(10_000),
    hint: 'Банк сам отправит документы в Росреестр, не нужно ходить в МФЦ. Можно отказаться и подать документы самостоятельно.',
  },
  // необязательные
  {
    key: 'life_insurance',
    name: 'Страхование жизни и здоровья',
    category: 'optional',
    recurrence: 'yearly',
    stageKey: 'insurance',
    defaultPlanKop: 0,
    percentOfLoanBalance: '0.5',
    hint: 'Не обязательно по закону, но без него банк может повысить ставку. Сравните: сколько стоит полис и на сколько вырастет ставка без него.',
  },
  {
    key: 'title_insurance',
    name: 'Страхование титула',
    category: 'optional',
    recurrence: 'yearly',
    stageKey: 'insurance',
    defaultPlanKop: 0,
    percentOfLoanBalance: '0.2',
    housing: ['secondary', 'house'],
    hint: 'Защищает, если сделку признают недействительной (например, объявится наследник). Актуально для вторички.',
  },
  {
    key: 'realtor',
    name: 'Риелтор',
    category: 'optional',
    recurrence: 'once',
    stageKey: 'choose_property',
    defaultPlanKop: 0,
    hint: 'Помогает найти квартиру и провести сделку. Обсудите заранее, что входит в услугу и когда оплата.',
  },
  {
    key: 'lawyer',
    name: 'Юрист: проверка квартиры и продавца',
    category: 'optional',
    recurrence: 'once',
    stageKey: 'property_check',
    defaultPlanKop: rub(25_000),
    housing: ['secondary', 'house'],
    hint: 'Проверяет историю квартиры, долги, прописанных и дееспособность продавца.',
  },
  {
    key: 'notary',
    name: 'Нотариус',
    category: 'optional',
    recurrence: 'once',
    stageKey: 'signing',
    defaultPlanKop: rub(15_000),
    hint: 'Обязателен, если квартира в долевой собственности или если используется маткапитал с выделением долей детям.',
  },
  {
    key: 'seller_deposit',
    name: 'Задаток продавцу',
    category: 'mandatory',
    recurrence: 'once',
    stageKey: 'deposit_agreement',
    defaultPlanKop: rub(100_000),
    housing: ['secondary', 'house'],
    hint: 'Подтверждает серьёзность намерений. Вносите только после одобрения ипотеки и пропишите в соглашении возврат, если банк откажет.',
  },
  // после ключей
  { key: 'moving', name: 'Переезд', category: 'after_keys', recurrence: 'once', stageKey: 'move_in', defaultPlanKop: rub(20_000), priority: 1, hint: 'Грузчики, машина, упаковка.' },
  { key: 'kitchen', name: 'Кухня', category: 'after_keys', recurrence: 'once', stageKey: 'move_in', defaultPlanKop: rub(250_000), priority: 1, hint: 'Без кухни жить неудобно — обычно её делают первой.' },
  { key: 'beds', name: 'Кровати и матрасы', category: 'after_keys', recurrence: 'once', stageKey: 'move_in', defaultPlanKop: rub(80_000), priority: 1, hint: 'Где спать — одна из первых задач.' },
  { key: 'lighting', name: 'Свет: люстры и лампы', category: 'after_keys', recurrence: 'once', stageKey: 'move_in', defaultPlanKop: rub(30_000), priority: 1, hint: 'В новостройках часто только патроны с лампочками.' },
  { key: 'appliances', name: 'Бытовая техника', category: 'after_keys', recurrence: 'once', stageKey: 'move_in', defaultPlanKop: rub(150_000), priority: 2, hint: 'Холодильник и стиральная машина — в первую очередь, остальное можно позже.' },
  { key: 'repair', name: 'Ремонт', category: 'after_keys', recurrence: 'once', stageKey: 'move_in', defaultPlanKop: rub(500_000), priority: 2, hint: 'Можно делать по комнатам, не всё сразу.' },
  { key: 'furniture', name: 'Мебель', category: 'after_keys', recurrence: 'once', stageKey: 'move_in', defaultPlanKop: rub(200_000), priority: 2, hint: 'Шкафы, столы, диван.' },
  { key: 'decor', name: 'Декор и мелочи', category: 'after_keys', recurrence: 'once', stageKey: 'move_in', defaultPlanKop: rub(50_000), priority: 3, hint: 'Шторы, текстиль, посуда — то, что может подождать.' },
];

export function catalogItem(key: string): ExpenseCatalogItem | undefined {
  return EXPENSE_CATALOG.find((i) => i.key === key);
}
