export type HousingType = 'new_ddu' | 'secondary' | 'house';
export type MortgageProgram = 'family' | 'base' | 'it' | 'other';
export type StageStatus = 'todo' | 'in_progress' | 'done' | 'skipped';

export interface StageTemplate {
  key: string;
  title: string;
  /** Что это и зачем — простым языком. */
  hint: string;
  documents: string[];
  /** Сдвиг плановой даты от старта, в неделях. */
  offsetWeeks: number;
  housing?: HousingType[];
  /** Этап нужен только при условии. */
  when?: 'selling_own' | 'maternity_capital';
  /** Ключ урока, который стоит открыть на этом этапе. */
  lessonKey?: string;
}

export const STAGE_TEMPLATES: StageTemplate[] = [
  {
    key: 'prepare_docs',
    title: 'Подготовка документов',
    hint: 'Соберите документы для банка заранее — так одобрение пройдёт быстрее.',
    documents: ['Паспорта', 'СНИЛС', 'Справка о доходах (выписка с Госуслуг или по форме банка)', 'Копия трудовой книжки или сведения о трудовой деятельности', 'Свидетельство о браке и о рождении детей'],
    offsetWeeks: 0,
  },
  {
    key: 'sell_own',
    title: 'Продажа своей квартиры',
    hint: 'При альтернативной сделке продажа и покупка проходят в один день. Деньги от продажи идут в первый взнос.',
    documents: ['Выписка из ЕГРН', 'Документ-основание (договор купли-продажи, дарения и т. п.)', 'Справка об отсутствии долгов по ЖКУ'],
    offsetWeeks: 1,
    when: 'selling_own',
  },
  {
    key: 'bank_approval',
    title: 'Одобрение ипотеки',
    hint: 'Банк проверяет доходы и кредитную историю и говорит, какую сумму готов дать. Одобрение обычно действует 90 дней.',
    documents: ['Анкета-заявление', 'Согласие на запрос кредитной истории'],
    offsetWeeks: 2,
    lessonKey: 'annuity',
  },
  {
    key: 'maternity_capital',
    title: 'Маткапитал',
    hint: 'Маткапитал можно направить на первый взнос или погашение ипотеки. Заявление подают в Социальный фонд, часто прямо через банк.',
    documents: ['Сертификат или выписка о размере маткапитала', 'Нотариальное обязательство выделить доли детям (если требуется)'],
    offsetWeeks: 3,
    when: 'maternity_capital',
    lessonKey: 'state_support',
  },
  {
    key: 'choose_property',
    title: 'Выбор квартиры',
    hint: 'Ищите в пределах одобренной суммы. Объект тоже должен понравиться банку — уточните требования заранее.',
    documents: [],
    offsetWeeks: 3,
  },
  {
    key: 'property_check',
    title: 'Проверка квартиры и продавца',
    hint: 'Проверьте собственников, обременения, прописанных, историю переходов права. Это защищает от потери денег.',
    documents: ['Выписка из ЕГРН', 'Выписка о зарегистрированных', 'Справки ПНД/НД продавца (по желанию)'],
    offsetWeeks: 5,
    housing: ['secondary', 'house'],
    lessonKey: 'fraud',
  },
  {
    key: 'deposit_agreement',
    title: 'Задаток или аванс продавцу',
    hint: 'Вносите задаток только после одобрения ипотеки. В соглашении пропишите, что деньги вернутся, если банк не одобрит объект.',
    documents: ['Соглашение о задатке'],
    offsetWeeks: 6,
    housing: ['secondary', 'house'],
  },
  {
    key: 'appraisal',
    title: 'Оценка',
    hint: 'Оценщик определяет рыночную стоимость квартиры для банка. Отчёт нужен до подписания кредитного договора.',
    documents: ['Отчёт об оценке'],
    offsetWeeks: 6,
    housing: ['secondary', 'house'],
  },
  {
    key: 'insurance',
    title: 'Страхование',
    hint: 'Страхование залога обязательно, жизни и титула — по желанию, но влияет на ставку. Страховщика можно выбрать самому среди аккредитованных банком.',
    documents: ['Полис страхования', 'Квитанция об оплате'],
    offsetWeeks: 7,
    lessonKey: 'insurance',
  },
  {
    key: 'signing',
    title: 'Подписание договоров',
    hint: 'Подписываете кредитный договор и договор покупки (ДКП) или долевого участия (ДДУ). Внимательно проверьте ставку, срок и сумму.',
    documents: ['Кредитный договор', 'ДКП или ДДУ', 'График платежей'],
    offsetWeeks: 8,
  },
  {
    key: 'settlement',
    title: 'Расчёты с продавцом',
    hint: 'Для новостроек деньги идут на эскроу-счёт и достанутся застройщику после сдачи дома. Для вторички — аккредитив, сервис безопасных расчётов или ячейка.',
    documents: ['Заявление на аккредитив или договор эскроу'],
    offsetWeeks: 8,
    lessonKey: 'escrow',
  },
  {
    key: 'registration',
    title: 'Регистрация в Росреестре',
    hint: 'Росреестр регистрирует договор и ипотеку. Обычно это занимает от нескольких дней до двух недель.',
    documents: ['Выписка из ЕГРН после регистрации'],
    offsetWeeks: 10,
  },
  {
    key: 'acceptance',
    title: 'Приёмка квартиры',
    hint: 'Осмотрите квартиру до подписания акта. Все недостатки впишите в акт осмотра — застройщик обязан их устранить.',
    documents: ['Акт осмотра с замечаниями', 'Акт приёма-передачи'],
    offsetWeeks: 52,
    housing: ['new_ddu'],
  },
  {
    key: 'ownership_registration',
    title: 'Регистрация права собственности',
    hint: 'После акта приёма-передачи регистрируете собственность. Банку нужно передать документы для оформления залога (закладной).',
    documents: ['Выписка из ЕГРН', 'Закладная'],
    offsetWeeks: 56,
    housing: ['new_ddu'],
  },
  {
    key: 'move_in',
    title: 'Ключи и переезд',
    hint: 'Сначала самое нужное: кухня, кровати, свет. Остальное — по мере накоплений.',
    documents: [],
    offsetWeeks: 12,
  },
  {
    key: 'tax_deduction',
    title: 'Налоговый вычет',
    hint: 'После регистрации собственности (или акта приёмки для новостройки) можно вернуть до 260 000 ₽ с покупки и до 390 000 ₽ с процентов на каждого супруга.',
    documents: ['Декларация 3-НДФЛ или заявление через работодателя', 'Справка банка об уплаченных процентах', 'Выписка из ЕГРН или акт приёма-передачи'],
    offsetWeeks: 64,
    lessonKey: 'tax_deduction',
  },
];

export interface ScenarioFlags {
  housingType: HousingType;
  sellingOwn: boolean;
  maternityCapital: boolean;
}

export function templatesFor(flags: ScenarioFlags): StageTemplate[] {
  return STAGE_TEMPLATES.filter((t) => {
    if (t.housing && !t.housing.includes(flags.housingType)) return false;
    if (t.when === 'selling_own' && !flags.sellingOwn) return false;
    if (t.when === 'maternity_capital' && !flags.maternityCapital) return false;
    return true;
  }).map((t) => {
    // для новостройки ключи — после приёмки
    if (flags.housingType === 'new_ddu' && t.key === 'move_in') return { ...t, offsetWeeks: 54 };
    return t;
  });
}
