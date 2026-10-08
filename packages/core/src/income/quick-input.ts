import { daysInMonth, formatDate, type IsoDate, parseDate } from '../date/date.js';
import { D, type Kop, roundKop } from '../money/money.js';
import {
  defaultReliability,
  INCOME_TYPE_LABELS,
  type IncomeType,
  type Periodicity,
  type Reliability,
} from './income.js';

export interface IncomeDraft {
  name: string;
  type: IncomeType;
  amountKop: Kop | null;
  periodicity: Periodicity;
  dayOfMonth?: number;
  date?: IsoDate;
  startDate?: IsoDate;
  endDate?: IsoDate;
  reliability: Reliability;
}

export interface QuickInputResult {
  draft: IncomeDraft;
  /** Что распознали — чтобы показать пользователю «поняли так: …». */
  recognized: string[];
  /** Чего не хватает для сохранения. */
  missing: ('amount' | 'date')[];
}

const MONTHS: { re: RegExp; m: number }[] = [
  { re: /^январ/, m: 1 }, { re: /^феврал/, m: 2 }, { re: /^март/, m: 3 }, { re: /^апрел/, m: 4 },
  { re: /^ма[йяе]/, m: 5 }, { re: /^июн/, m: 6 }, { re: /^июл/, m: 7 }, { re: /^август/, m: 8 },
  { re: /^сентябр/, m: 9 }, { re: /^октябр/, m: 10 }, { re: /^ноябр/, m: 11 }, { re: /^декабр/, m: 12 },
];

function monthFromWord(word: string): number | null {
  const w = word.toLowerCase();
  for (const { re, m } of MONTHS) if (re.test(w)) return m;
  return null;
}

const TYPE_KEYWORDS: { re: RegExp; type: IncomeType }[] = [
  { re: /аванс/i, type: 'advance' },
  { re: /зарплат|оклад|з\/п|зп\b/i, type: 'salary' },
  { re: /преми|бонус|13-?я/i, type: 'bonus' },
  { re: /самозан|подработ|фриланс|ип\b/i, type: 'self_employed' },
  { re: /аренд|сда(ча|ю|м)|квартирант/i, type: 'rent' },
  { re: /вычет|ндфл|возврат налог/i, type: 'tax_refund' },
  { re: /подар/i, type: 'gift' },
  { re: /продаж|продам|продаём|продаем/i, type: 'property_sale' },
];

/** Ближайшая будущая дата с данным месяцем/днём, если год не указан. */
function resolveDate(day: number, month: number, year: number | null, today: IsoDate): IsoDate {
  const build = (y: number) => formatDate({ y, m: month, d: Math.min(day, daysInMonth(y, month)) });
  const t = parseDate(today);
  const candidate = build(year ?? t.y);
  if (year === null && candidate < today) return build(t.y + 1);
  return candidate;
}

/**
 * Разбор строки вида «Премия 110 000 каждый месяц 15-го»,
 * «Аренда 35 тыс ежемесячно с 1 марта», «Вычет 260 000 разово в мае 2027».
 */
export function parseIncomeQuickInput(input: string, today: IsoDate): QuickInputResult {
  const recognized: string[] = [];
  let text = ` ${input.replace(/ /g, ' ').trim()} `;
  const lower = () => text.toLowerCase();

  // Даты в формате 15.05.2027
  const explicitDates: { idx: number; date: IsoDate }[] = [];
  text = text.replace(/(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/g, (_m, d, mo, y, idx: number) => {
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    explicitDates.push({ idx, date: formatDate({ y: year, m: Number(mo), d: Number(d) }) });
    return ' ';
  });

  // «с 1 марта», «до 31 декабря 2027», «в мае 2027», «в декабре»
  let startDate: IsoDate | undefined;
  let endDate: IsoDate | undefined;
  let monthDate: IsoDate | undefined;
  text = text.replace(/\s(с|до|по)\s+(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/gi, (m, prep: string, d, word, y) => {
    const month = monthFromWord(word);
    if (!month) return m;
    const date = resolveDate(Number(d), month, y ? Number(y) : null, today);
    if (prep.toLowerCase() === 'с') startDate = date;
    else endDate = date;
    return ' ';
  });
  for (const prep of ['с', 'до', 'по']) {
    text = text.replace(new RegExp(`\\s${prep}\\s+(${['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'].join('|')})(?:\\s+(\\d{4}))?`, 'gi'), (_m, word, y) => {
      const month = monthFromWord(word)!;
      const date = resolveDate(1, month, y ? Number(y) : null, today);
      if (prep === 'с') startDate = date;
      else endDate = date;
      return ' ';
    });
  }
  text = text.replace(/\sв\s+([а-яё]+е)(?:\s+(\d{4}))?(?=\s)/gi, (m, word, y) => {
    const month = monthFromWord(word);
    if (!month) return m;
    monthDate = resolveDate(1, month, y ? Number(y) : null, today);
    return ' ';
  });

  // День месяца: «15-го», «15 числа», «15го»
  let dayOfMonth: number | undefined;
  text = text.replace(/\s(\d{1,2})\s*-?\s*(го|числа|е)(?=[\s,.]|$)/gi, (m, d) => {
    const n = Number(d);
    if (n < 1 || n > 31) return m;
    dayOfMonth = n;
    return ' ';
  });

  // Периодичность
  let periodicity: Periodicity | null = null;
  const periodRules: { re: RegExp; p: Periodicity; label: string }[] = [
    { re: /ежеквартальн\S*|раз в квартал|каждый квартал|в квартал/i, p: 'quarterly', label: 'раз в квартал' },
    { re: /ежегодн\S*|раз в год|каждый год|в год\b/i, p: 'yearly', label: 'раз в год' },
    { re: /ежемесячн\S*|каждый месяц|раз в месяц|в месяц|помесячно/i, p: 'monthly', label: 'каждый месяц' },
    { re: /разово|единоразов\S*|однократн\S*|один раз|разовый|разовая/i, p: 'once', label: 'разово' },
  ];
  for (const r of periodRules) {
    if (r.re.test(text)) {
      periodicity = r.p;
      recognized.push(r.label);
      text = text.replace(r.re, ' ');
      break;
    }
  }

  // Надёжность
  let reliability: Reliability | null = null;
  const relRules: { re: RegExp; r: Reliability; label: string }[] = [
    { re: /нестабильн\S*|непостоянн\S*|не всегда|иногда/i, r: 'unstable', label: 'нестабильный' },
    { re: /ожида\S*|планиру\S*|будет|начнётся|начнется/i, r: 'expected', label: 'ожидаемый' },
    { re: /стабильн\S*|постоянн\S*|гарантирован\S*/i, r: 'stable', label: 'стабильный' },
  ];
  for (const r of relRules) {
    if (r.re.test(text)) {
      reliability = r.r;
      text = text.replace(r.re, ' ');
      recognized.push(r.label);
      break;
    }
  }

  // Сумма: «110 000», «150 тыс», «1,2 млн», «20к»
  let amountKop: Kop | null = null;
  let amountIdx = -1;
  const amountRe = /(\d{1,3}(?:[ ]\d{3})+|\d+)(?:[.,](\d+))?\s*(млн|миллион\S*|тыс\.?|тысяч\S*|т\.?р\.?|к|k)?(?=[\s₽р.,]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = amountRe.exec(text))) {
    const whole = m[1]!.replace(/ /g, '');
    const frac = m[2] ? `.${m[2]}` : '';
    let value = new D(whole + frac);
    const mult = (m[3] ?? '').toLowerCase();
    if (mult.startsWith('млн') || mult.startsWith('миллион')) value = value.mul(1_000_000);
    else if (mult) value = value.mul(1_000);
    if (value.lt(100) && !mult) continue; // скорее всего не сумма
    amountKop = roundKop(value.mul(100));
    amountIdx = m.index;
    text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    break;
  }
  text = text.replace(/₽|руб\S*|\sр\.?(?=\s)/gi, ' ');

  // Тип и название
  let type: IncomeType = 'other';
  for (const k of TYPE_KEYWORDS) {
    if (k.re.test(input)) {
      type = k.type;
      break;
    }
  }
  const namePart = (amountIdx > 0 ? text.slice(0, amountIdx) : text).replace(/[\s,.;:-]+/g, ' ').trim();
  const name = namePart ? namePart.charAt(0).toUpperCase() + namePart.slice(1) : INCOME_TYPE_LABELS[type];

  // Дата разового поступления
  let date: IsoDate | undefined = explicitDates[0]?.date ?? monthDate;
  if (!periodicity) {
    if (date && !dayOfMonth) periodicity = 'once';
    else if (['tax_refund', 'gift', 'property_sale'].includes(type)) periodicity = 'once';
    else periodicity = 'monthly';
  }
  if (periodicity === 'once' && type === 'other') type = 'one_off';
  if (date && dayOfMonth && periodicity !== 'monthly') {
    const p = parseDate(date);
    date = resolveDate(dayOfMonth, p.m, p.y, today);
  }
  if ((periodicity === 'quarterly' || periodicity === 'yearly') && !date && startDate) date = startDate;

  const draft: IncomeDraft = {
    name: lower().trim() ? name : INCOME_TYPE_LABELS[type],
    type,
    amountKop,
    periodicity,
    reliability: reliability ?? defaultReliability(type),
  };
  if (periodicity === 'monthly') draft.dayOfMonth = dayOfMonth ?? (startDate ? parseDate(startDate).d : undefined);
  if (draft.dayOfMonth === undefined) delete draft.dayOfMonth;
  if (date && periodicity !== 'monthly') draft.date = date;
  if (startDate) draft.startDate = startDate;
  if (endDate) draft.endDate = endDate;
  if (startDate && startDate > today && !reliability && draft.reliability === 'stable') draft.reliability = 'expected';

  const missing: QuickInputResult['missing'] = [];
  if (amountKop === null) missing.push('amount');
  if (periodicity === 'once' && !draft.date) missing.push('date');
  if (periodicity === 'monthly' && draft.dayOfMonth === undefined) missing.push('date');
  return { draft, recognized, missing };
}
