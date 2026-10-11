import { formatRub } from '@hypothec/core';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Home, KeyRound } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../api/client.js';
import { useHh, useHousehold } from '../api/household.js';
import type { ScenarioDto } from '../api/types.js';
import { Term } from '../components/learning.js';
import { Button, Card, cx, Field, Input, MoneyInput, Select, Switch } from '../components/ui/index.js';

type Housing = 'new_ddu' | 'secondary' | 'house';
type Program = 'family' | 'base' | 'it' | 'other';

interface Answers {
  adults: number;
  children: number;
  housingType: Housing;
  sellingOwn: boolean;
  ownSalePriceKop: number | null;
  useMatcap: boolean;
  maternityCapitalKop: number | null;
  program: Program;
  annualRate: string;
  termYears: number;
  priceKop: number | null;
  downPaymentKop: number | null;
  startDate: string;
  budget: Record<string, number | null>;
}

const STEPS = ['Семья', 'Жильё', 'Своя квартира', 'Деньги', 'Ипотека', 'Расходы на жизнь', 'Готово'];

/** Главные категории бюджета, которые спрашиваем в мастере. Остальные можно добавить в разделе «Бюджет». */
const BUDGET_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'utilities', label: 'Коммуналка' },
  { key: 'groceries', label: 'Продукты' },
  { key: 'transport', label: 'Транспорт или машина' },
  { key: 'mobile', label: 'Связь и интернет' },
  { key: 'kids_activities', label: 'Кружки и секции детей' },
  { key: 'kids_school', label: 'Садик и школа' },
  { key: 'health', label: 'Здоровье и аптека' },
  { key: 'cafe', label: 'Кафе, доставка, развлечения' },
  { key: 'rent', label: 'Аренда жилья', hint: 'Если снимаете — до переезда' },
  { key: 'other', label: 'Всё остальное' },
];

function Choice({ selected, onClick, icon, title, text }: { selected: boolean; onClick(): void; icon?: ReactNode; title: string; text: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx('flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition', selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-surface-2')}
    >
      {icon && <span className="mt-0.5 text-primary">{icon}</span>}
      <span>
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-2">{text}</span>
      </span>
    </button>
  );
}

function Counter({ label, value, onChange, min = 0 }: { label: string; value: number; onChange(v: number): void; min?: number }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-surface p-4">
      <span>{label}</span>
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" aria-label={`Уменьшить: ${label}`} onClick={() => onChange(Math.max(min, value - 1))}>
          −
        </Button>
        <span className="num w-6 text-center text-lg font-semibold" aria-live="polite">
          {value}
        </span>
        <Button type="button" variant="secondary" size="sm" aria-label={`Увеличить: ${label}`} onClick={() => onChange(value + 1)}>
          +
        </Button>
      </div>
    </div>
  );
}

export default function WizardPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { hid } = useHousehold();
  const existing = useHh<ScenarioDto | null>('/scenario');
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Answers>({
    adults: 2,
    children: 0,
    housingType: 'secondary',
    sellingOwn: false,
    ownSalePriceKop: null,
    useMatcap: false,
    maternityCapitalKop: null,
    program: 'base',
    annualRate: '',
    termYears: 30,
    priceKop: null,
    downPaymentKop: null,
    startDate: new Date().toISOString().slice(0, 10),
    budget: {},
  });
  const [result, setResult] = useState<{ notes: string[] } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setA((x) => ({ ...x, [k]: v }));

  const loan = Math.max(0, (a.priceKop ?? 0) - (a.downPaymentKop ?? 0) - (a.useMatcap ? (a.maternityCapitalKop ?? 0) : 0));
  const canNext = step !== 3 || ((a.priceKop ?? 0) > 0 && a.downPaymentKop !== null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        adults: a.adults,
        children: a.children,
        housingType: a.housingType,
        sellingOwn: a.sellingOwn,
        ...(a.sellingOwn && a.ownSalePriceKop ? { ownSalePriceKop: a.ownSalePriceKop } : {}),
        maternityCapitalKop: a.useMatcap ? (a.maternityCapitalKop ?? 0) : 0,
        program: a.program,
        priceKop: a.priceKop ?? 0,
        downPaymentKop: a.downPaymentKop ?? 0,
        ...(a.annualRate ? { annualRate: a.annualRate.replace(',', '.') } : {}),
        termYears: a.termYears,
        startDate: a.startDate,
        budget: Object.entries(a.budget)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([catalogKey, amountKop]) => ({ catalogKey, amountKop: amountKop! })),
      };
      const res = await api<{ notes: string[] }>(`/households/${hid}/wizard`, { method: 'POST', body });
      await qc.invalidateQueries({ queryKey: ['h', hid] });
      setResult(res);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold">План готов</h1>
        <p className="mt-2 text-ink-2">Мы собрали этапы сделки, список расходов, счета-цели и черновик кредита. Всё можно поменять.</p>
        {result.notes.length > 0 && (
          <Card tone="info" className="mt-4" title="Что стоит уточнить">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Card>
        )}
        <Card className="mt-4" title="Следующий шаг — «Мой месяц»">
          <p className="text-sm text-ink-2">На одной странице впишите доходы, проверьте расходы на жизнь и посмотрите, сколько остаётся в копилку. Это займёт пару минут.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => navigate('/month')}>Открыть «Мой месяц»</Button>
            <Button variant="secondary" onClick={() => navigate('/')}>
              На главную
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-sm text-muted">
        Шаг {step + 1} из {STEPS.length}: {STEPS[step]}
      </p>
      <div className="mt-2 mb-6 flex gap-1" aria-hidden>
        {STEPS.map((s, i) => (
          <div key={s} className={cx('h-1 flex-1 rounded-full', i <= step ? 'bg-primary' : 'bg-border')} />
        ))}
      </div>
      {existing.data && step === 0 && (
        <Card tone="warn" className="mb-4">
          <p className="text-sm">План уже заполнен. Если пройти мастер заново, этапы и расходы из шаблонов пересоздадутся, а добавленные вами — останутся.</p>
        </Card>
      )}

      {step === 0 && (
        <section className="space-y-3">
          <h1 className="text-2xl font-semibold">Кто будет жить в новой квартире?</h1>
          <Counter label="Взрослые" value={a.adults} min={1} onChange={(v) => set('adults', v)} />
          <Counter label="Дети" value={a.children} onChange={(v) => set('children', v)} />
        </section>
      )}

      {step === 1 && (
        <section className="space-y-3">
          <h1 className="text-2xl font-semibold">Что покупаете?</h1>
          <Choice selected={a.housingType === 'new_ddu'} onClick={() => set('housingType', 'new_ddu')} icon={<Building2 className="size-5" />} title="Новостройку" text="Квартира в строящемся доме по договору долевого участия. Деньги — на эскроу-счёт, ключи — после сдачи дома." />
          <Choice selected={a.housingType === 'secondary'} onClick={() => set('housingType', 'secondary')} icon={<KeyRound className="size-5" />} title="Готовую квартиру" text="Вторичное жильё или новостройка, которая уже сдана. Договор купли-продажи." />
          <Choice selected={a.housingType === 'house'} onClick={() => set('housingType', 'house')} icon={<Home className="size-5" />} title="Дом" text="Готовый дом с участком." />
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Продаёте свою квартиру?</h1>
          <Card>
            <Switch checked={a.sellingOwn} onChange={(v) => set('sellingOwn', v)} label={<>Да, это <Term k="alternative_deal">альтернативная сделка</Term></>} />
            {a.sellingOwn && (
              <div className="mt-3">
                <Field label="Примерно за сколько продаёте" htmlFor="own">
                  <MoneyInput id="own" value={a.ownSalePriceKop} onChange={(v) => set('ownSalePriceKop', v)} />
                </Field>
              </div>
            )}
          </Card>
          <Card>
            <Switch checked={a.useMatcap} onChange={(v) => set('useMatcap', v)} label={<>Используем <Term k="maternity_capital">материнский капитал</Term></>} />
            {a.useMatcap && (
              <div className="mt-3">
                <Field label="Сумма маткапитала" htmlFor="matcap" hint="Остаток можно посмотреть на Госуслугах">
                  <MoneyInput id="matcap" value={a.maternityCapitalKop} onChange={(v) => set('maternityCapitalKop', v)} />
                </Field>
              </div>
            )}
          </Card>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Сколько стоит жильё?</h1>
          <Field label="Примерная стоимость" htmlFor="price">
            <MoneyInput id="price" autoFocus value={a.priceKop} onChange={(v) => set('priceKop', v)} />
          </Field>
          <Field label="Первый взнос — свои деньги" htmlFor="down" hint={a.sellingOwn ? 'Включая деньги от продажи своей квартиры' : undefined}>
            <MoneyInput id="down" value={a.downPaymentKop} onChange={(v) => set('downPaymentKop', v)} />
          </Field>
          {(a.priceKop ?? 0) > 0 && (
            <Card tone="info">
              <p className="text-sm">
                Сумма кредита — <strong className="num">{formatRub(loan, { kopecks: 'never' })}</strong>
                {a.priceKop ? ` (взнос ${Math.round((((a.downPaymentKop ?? 0) + (a.useMatcap ? (a.maternityCapitalKop ?? 0) : 0)) / a.priceKop) * 100)}%)` : ''}
              </p>
            </Card>
          )}
        </section>
      )}

      {step === 4 && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Какая ипотека?</h1>
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice selected={a.program === 'family'} onClick={() => set('program', 'family')} title="Семейная" text="Льготная, для семей с детьми" />
            <Choice selected={a.program === 'base'} onClick={() => set('program', 'base')} title="Обычная" text="Рыночная ставка банка" />
            <Choice selected={a.program === 'it'} onClick={() => set('program', 'it')} title="ИТ-ипотека" text="Для сотрудников аккредитованных ИТ-компаний" />
            <Choice selected={a.program === 'other'} onClick={() => set('program', 'other')} title="Другая" text="Военная, дальневосточная и другие" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ставка, % годовых" htmlFor="rate" hint="Из одобрения банка. Если пока нет — оставьте пустым, подставим ориентир.">
              <Input id="rate" inputMode="decimal" placeholder="например, 6" value={a.annualRate} onChange={(e) => set('annualRate', e.target.value.replace(/[^\d.,]/g, ''))} />
            </Field>
            <Field label="Срок, лет" htmlFor="term">
              <Select id="term" value={a.termYears} onChange={(e) => set('termYears', Number(e.target.value))}>
                {[5, 7, 10, 15, 20, 25, 30].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-xs text-muted">Сервис не продаёт ипотеку и не советует банки: ставку и условия вы берёте из своего одобрения.</p>
        </section>
      )}

      {step === 5 && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Сколько уходит на жизнь в месяц?</h1>
          <p className="text-sm text-ink-2">Примерно, без копеек. Это нужно, чтобы посчитать подушку и понять, сколько остаётся на цели. Можно пропустить и заполнить потом в разделе «Бюджет».</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {BUDGET_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`b-${f.key}`} hint={f.hint}>
                <MoneyInput id={`b-${f.key}`} value={a.budget[f.key] ?? null} onChange={(k) => set('budget', { ...a.budget, [f.key]: k })} />
              </Field>
            ))}
          </div>
          <Card tone="info">
            <p className="text-sm">
              Итого: <strong className="num">{formatRub(Object.values(a.budget).reduce<number>((sum, v) => sum + (v ?? 0), 0), { kopecks: 'never' })}</strong> в месяц
            </p>
          </Card>
        </section>
      )}

      {step === 6 && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Когда начинаете?</h1>
          <Field label="Дата начала" htmlFor="start" hint="От неё рассчитаем плановые даты этапов. Их можно будет поправить.">
            <Input id="start" type="date" value={a.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Card>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">Жильё</dt>
              <dd>{{ new_ddu: 'Новостройка', secondary: 'Готовая квартира', house: 'Дом' }[a.housingType]}</dd>
              <dt className="text-muted">Стоимость</dt>
              <dd className="num">{formatRub(a.priceKop ?? 0, { kopecks: 'never' })}</dd>
              <dt className="text-muted">Кредит</dt>
              <dd className="num">{formatRub(loan, { kopecks: 'never' })}</dd>
              <dt className="text-muted">Срок</dt>
              <dd>{a.termYears} лет</dd>
            </dl>
          </Card>
          {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error.message}</p>}
        </section>
      )}

      <div className="mt-8 flex justify-between gap-3">
        <Button variant="ghost" onClick={() => (step === 0 ? navigate(-1) : setStep(step - 1))}>
          Назад
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep(step + 1)} disabled={!canNext}>
            Дальше
          </Button>
        ) : (
          <Button onClick={submit} loading={busy}>
            Собрать план
          </Button>
        )}
      </div>
    </div>
  );
}
