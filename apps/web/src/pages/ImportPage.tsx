import { formatDateRu, formatRub, parseCsvText, type ColumnMapping, type OperationKind } from '@hypothec/core';
import { ArrowLeft, FileUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useHh, useHhMutation } from '../api/household.js';
import type { LivingDto } from '../api/types.js';
import { Badge, Button, Card, cx, Money, PageHeader, Segmented, Select, Spinner, Switch } from '../components/ui/index.js';
import { useToast } from '../components/ui/toast.js';

interface PreviewOp {
  line: number;
  date: string;
  amountKop: number;
  outflow: boolean;
  description: string;
  bankCategory: string | null;
  mcc: string | null;
  kind: OperationKind;
  importKey: string;
  merchantKey: string;
  suggestion: { categoryId: string | null; reason: string; reasonText: string };
  duplicate: boolean;
}
interface Preview {
  bank: string;
  bankName: string;
  header: string[];
  headerRow: number;
  mapping: ColumnMapping | null;
  errors: { line: number; message: string }[];
  operations: PreviewOp[];
  summary: { expenseKop: number; incomeKop: number; transferKop: number; loanKop: number; cashKop: number; duplicates: number; period: { from: string; to: string } | null };
}
type Cell = string | number | null;

const KIND: Record<OperationKind, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'primary' }> = {
  expense: { label: 'расход', tone: 'neutral' },
  income: { label: 'поступление', tone: 'ok' },
  transfer: { label: 'перевод себе', tone: 'primary' },
  loan: { label: 'кредит', tone: 'primary' },
  cash: { label: 'наличные', tone: 'warn' },
  failed: { label: 'не прошла', tone: 'neutral' },
};

/** Файл → таблица строк. CSV (UTF-8 или Windows-1251) и Excel (.xlsx). Даты из Excel — строкой ГГГГ-ММ-ДД. */
async function readTable(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    const data = await readSheet(file);
    return data.map((row) =>
      row.map((c) => {
        if (c instanceof Date) return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
        if (typeof c === 'number') return c;
        if (c === null || c === undefined) return null;
        return String(c);
      }),
    );
  }
  if (name.endsWith('.xls')) throw new Error('Старый формат .xls не поддерживается. Сохраните выписку как .xlsx или CSV.');
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf);
  return parseCsvText(text);
}

const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Дата', required: true },
  { key: 'amount', label: 'Сумма (со знаком)' },
  { key: 'expense', label: 'Расход (если отдельно)' },
  { key: 'income', label: 'Приход (если отдельно)' },
  { key: 'description', label: 'Описание', required: true },
  { key: 'category', label: 'Категория банка' },
];

export default function ImportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const cats = useHh<LivingDto[]>('/living-expenses');
  const preview = useHhMutation<{ rows: Cell[][]; manual?: { headerRow: number; mapping: ColumnMapping } }, Preview>('POST', '/budget/import/preview', { silent: true });
  const commit = useHhMutation<Record<string, unknown>, { created: number; skipped: number; learned: number }>('POST', '/budget/import/commit');
  const [rows, setRows] = useState<Cell[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [manual, setManual] = useState<{ headerRow: number; mapping: Partial<ColumnMapping> }>({ headerRow: 0, mapping: {} });
  const [choice, setChoice] = useState<Record<string, string | null>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'expense' | 'all'>('expense');
  const [learn, setLearn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const data = preview.data;

  const onFile = async (file: File) => {
    setError(null);
    setChoice({});
    setExcluded(new Set());
    try {
      const table = await readTable(file);
      setRows(table);
      setFileName(file.name);
      const res = await preview.mutateAsync({ rows: table.slice(0, 5000) });
      // уже внесённые раньше — сразу исключены
      setExcluded(new Set(res.operations.filter((o) => o.duplicate).map((o) => o.importKey)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ops = data?.operations ?? [];
  const visible = filter === 'expense' ? ops.filter((o) => o.kind === 'expense') : ops;
  const catOf = (o: PreviewOp) => (o.importKey in choice ? choice[o.importKey]! : o.suggestion.categoryId);
  const selected = ops.filter((o) => o.kind === 'expense' && !excluded.has(o.importKey) && !o.duplicate);
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of selected) {
      const id = (o.importKey in choice ? choice[o.importKey] : o.suggestion.categoryId) ?? '';
      m.set(id, (m.get(id) ?? 0) + o.amountKop);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [selected, choice]);
  const catName = (id: string | null | undefined) => (id ? (cats.data?.find((c) => c.id === id)?.name ?? '—') : 'Без категории (вне плана)');

  const submit = async () => {
    const items = selected.map((o) => ({ importKey: o.importKey, merchantKey: o.merchantKey, date: o.date, amountKop: o.amountKop, description: o.description, categoryId: catOf(o) }));
    if (!items.length) return;
    const r = await commit.mutateAsync({ items, learn });
    toast.show(`Внесено трат: ${r.created}${r.skipped ? `, уже были: ${r.skipped}` : ''}`);
    navigate('/month');
  };

  return (
    <div>
      <Link to="/month" className="inline-flex items-center gap-1 text-sm text-primary">
        <ArrowLeft className="size-4" aria-hidden /> Мой месяц
      </Link>
      <PageHeader title="Загрузить выписку из банка" subtitle="Сервис разложит траты по категориям бюджета. Перед внесением всё можно проверить и поправить." />

      <Card>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border px-4 py-8 text-center hover:bg-surface-2">
          <FileUp className="size-8 text-primary" aria-hidden />
          <span className="font-medium">{fileName || 'Выберите файл выписки'}</span>
          <span className="text-sm text-ink-2">CSV или Excel (.xlsx) из приложения банка</span>
          <input type="file" accept=".csv,.xlsx,.xls,text/csv" className="sr-only" aria-label="Файл выписки" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-primary">Как выгрузить выписку из Т-Банка, ВТБ и Альфа-Банка</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
            <li>
              <strong>Т-Банк:</strong> в личном кабинете на сайте откройте карту или счёт → «Выписка» (или «Операции» → выгрузка), выберите период и формат CSV или Excel.
            </li>
            <li>
              <strong>ВТБ:</strong> в ВТБ Онлайн откройте карту или счёт → «Выписка», выберите период и формат Excel.
            </li>
            <li>
              <strong>Альфа-Банк:</strong> в Альфа-Онлайн откройте счёт → «Выписка», выберите период и формат Excel или CSV.
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted">Названия пунктов меню у банков иногда меняются. Подойдёт любая выписка с колонками «дата», «сумма» и «описание». Файл не хранится — сохраняются только внесённые траты.</p>
        </details>
      </Card>

      {error && <p className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {preview.isPending && <Spinner label="Разбираем выписку" />}

      {data && !data.mapping && rows && (
        <Card className="mt-4" title="Укажите, где что в выписке">
          <p className="mb-3 text-sm text-ink-2">Не удалось сами определить столбцы. Выберите строку заголовков и колонки — это нужно один раз для такого файла.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Строка заголовков
              <Select className="mt-1" value={manual.headerRow} onChange={(e) => setManual({ ...manual, headerRow: Number(e.target.value) })}>
                {rows.slice(0, 15).map((r, i) => (
                  <option key={i} value={i}>
                    {i + 1}: {r.filter(Boolean).slice(0, 4).join(' · ').slice(0, 60)}
                  </option>
                ))}
              </Select>
            </label>
            {MAPPING_FIELDS.map((f) => (
              <label key={f.key} className="text-sm">
                {f.label}
                {f.required && ' *'}
                <Select
                  className="mt-1"
                  value={manual.mapping[f.key] ?? ''}
                  onChange={(e) => setManual({ ...manual, mapping: { ...manual.mapping, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) } })}
                >
                  <option value="">—</option>
                  {(rows[manual.headerRow] ?? []).map((h, i) => (
                    <option key={i} value={i}>
                      {String(h ?? `Колонка ${i + 1}`)}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          <Button
            className="mt-4"
            disabled={manual.mapping.date === undefined || manual.mapping.description === undefined || (manual.mapping.amount === undefined && manual.mapping.expense === undefined)}
            onClick={() => preview.mutate({ rows: rows.slice(0, 5000), manual: { headerRow: manual.headerRow, mapping: manual.mapping as ColumnMapping } })}
          >
            Разобрать
          </Button>
        </Card>
      )}

      {data && data.mapping && (
        <>
          <Card className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                {data.bankName}
                {data.summary.period && (
                  <span className="font-normal text-ink-2">
                    {' '}
                    · {formatDateRu(data.summary.period.from, { year: false })} — {formatDateRu(data.summary.period.to)}
                  </span>
                )}
              </p>
              <span className="text-sm text-ink-2">операций: {ops.length}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <SummaryItem label="Расходы" kop={data.summary.expenseKop} />
              <SummaryItem label="Поступления" kop={data.summary.incomeKop} hint="не вносятся — сверьте с планом доходов" />
              <SummaryItem label="Переводы себе" kop={data.summary.transferKop} hint="не считаются расходом" />
              <SummaryItem label="Кредит и наличные" kop={data.summary.loanKop + data.summary.cashKop} hint="не вносятся автоматически" />
            </div>
            {data.summary.duplicates > 0 && <p className="mt-2 text-sm text-warn">Уже внесено раньше: {data.summary.duplicates} — эти операции пропущены.</p>}
            {data.errors.length > 0 && <p className="mt-2 text-xs text-muted">Не прочитано строк: {data.errors.length} (например, строка {data.errors[0]!.line}).</p>}
          </Card>

          <Card className="mt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <Segmented
                label="Какие операции показать"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'expense', label: 'Расходы' },
                  { value: 'all', label: 'Все операции' },
                ]}
              />
              <span className="text-xs text-muted">Проверьте категории — их можно поменять в каждой строке</span>
            </div>
            <ul className="divide-y divide-border">
              {visible.map((o) => {
                const isExpense = o.kind === 'expense';
                const off = excluded.has(o.importKey) || o.duplicate;
                return (
                  <li key={o.importKey} className={cx('grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 py-2 text-sm sm:grid-cols-[auto_90px_1fr_220px_110px]', off && 'opacity-50')}>
                    <input
                      type="checkbox"
                      aria-label={`Вносить: ${o.description}`}
                      className="size-4 accent-[var(--primary)]"
                      disabled={!isExpense || o.duplicate}
                      checked={isExpense && !off}
                      onChange={(e) => {
                        const n = new Set(excluded);
                        if (e.target.checked) n.delete(o.importKey);
                        else n.add(o.importKey);
                        setExcluded(n);
                      }}
                    />
                    <span className="hidden text-ink-2 sm:block">{formatDateRu(o.date, { year: false })}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{o.description}</span>
                      <span className="text-xs text-muted">
                        <span className="sm:hidden">{formatDateRu(o.date, { year: false })} · </span>
                        {o.bankCategory ?? ''} {o.duplicate && '· уже внесено'}
                      </span>
                    </span>
                    <span className="order-last col-span-3 sm:order-none sm:col-span-1">
                      {isExpense ? (
                        <>
                          <Select
                            aria-label={`Категория: ${o.description}`}
                            className="h-9 text-sm"
                            value={catOf(o) ?? ''}
                            disabled={off}
                            onChange={(e) => setChoice({ ...choice, [o.importKey]: e.target.value || null })}
                          >
                            <option value="">Без категории (вне плана)</option>
                            {(cats.data ?? []).map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </Select>
                          {!(o.importKey in choice) && <span className="text-xs text-muted">{o.suggestion.reasonText}</span>}
                        </>
                      ) : (
                        <Badge tone={KIND[o.kind].tone}>{KIND[o.kind].label}</Badge>
                      )}
                    </span>
                    <Money kop={o.outflow ? o.amountKop : o.amountKop} kopecks="auto" className={cx('text-right font-medium', !o.outflow && 'text-ok')} />
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="mt-4" title="Будет внесено">
            {byCategory.length === 0 ? (
              <p className="text-sm text-ink-2">Ничего не выбрано.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {byCategory.map(([id, kop]) => (
                  <li key={id} className="flex justify-between">
                    <span>{catName(id || null)}</span>
                    <Money kop={kop} />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <Switch checked={learn} onChange={setLearn} label="Запомнить категории для этих получателей — в следующий раз подставлю сам" />
            </div>
            <Button className="mt-3" onClick={submit} loading={commit.isPending} disabled={!selected.length}>
              Внести {selected.length} {plural(selected.length, 'трату', 'траты', 'трат')} на {formatRub(selected.reduce((s, o) => s + o.amountKop, 0), { kopecks: 'never' })}
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function SummaryItem({ label, kop, hint }: { label: string; kop: number; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2.5">
      <div className="text-xs text-muted">{label}</div>
      <Money kop={kop} className="font-semibold" />
      {hint && <div className="text-[11px] leading-tight text-muted">{hint}</div>}
    </div>
  );
}
