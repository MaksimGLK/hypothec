import * as Dialog from '@radix-ui/react-dialog';
import { formatDateNum, formatDateRu, formatRub, rub } from '@hypothec/core';
import { CalendarDays, Loader2, X } from 'lucide-react';
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, forwardRef, useEffect, useId, useRef, useState } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ── кнопки ──
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-ink hover:opacity-90',
  secondary: 'bg-surface text-ink border border-border hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-9 px-3 text-sm' : 'h-11 px-4',
        VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

// ── карточки и заголовки ──
export function Card({ children, className, title, action, tone }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; tone?: 'warn' | 'danger' | 'ok' | 'info' }) {
  const toneCls = tone === 'warn' ? 'bg-warn-soft border-transparent' : tone === 'danger' ? 'bg-danger-soft border-transparent' : tone === 'ok' ? 'bg-ok-soft border-transparent' : tone === 'info' ? 'bg-info-soft border-transparent' : 'bg-surface border-border';
  return (
    <section className={cx('rounded-2xl border p-4 sm:p-5', toneCls, className)}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} — Ипотечный планировщик`;
  }, [title]);
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

// ── поля ──
export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | undefined; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? <p className="text-sm text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const inputCls = 'h-11 w-full rounded-xl border border-border bg-surface px-3 text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-[var(--ring)]';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...rest }, ref) => (
  <input ref={ref} className={cx(inputCls, className)} {...rest} />
));
Input.displayName = 'Input';

/** Что набрано в поле → дата ISO; null — набрано не до конца или такой даты нет. */
function parseDateText(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const [d, mon, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mon - 1, d));
  if (y < 1900 || dt.getUTCMonth() !== mon - 1 || dt.getUTCDate() !== d) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Цифры → дд/мм/гггг; вставленные 2026-11-18 и 18.11.2026 тоже понимаем. */
function maskDateText(raw: string): string {
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  /** Дата ISO (2026-11-18) или пустая строка. */
  value: string;
  /** Срабатывает, только когда дата набрана целиком или поле очищено. */
  onChange(e: { target: { value: string } }): void;
  /** Кнопка календаря. Без неё поле занимает меньше места. */
  picker?: boolean;
};

/**
 * Дата всегда в виде дд/мм/гггг. Встроенное поле браузера показывает формат по языку системы,
 * поэтому видимое поле — текстовое, а календарь открывается у скрытого встроенного.
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(({ value, onChange, picker = true, className, onBlur, disabled, ...rest }, ref) => {
  const shown = value ? formatDateNum(value) : '';
  const [text, setText] = useState(shown);
  const native = useRef<HTMLInputElement>(null);
  const invalid = text !== '' && parseDateText(text) === null;
  useEffect(() => {
    // набор не сбрасываем: пока дата неполная, value остаётся прежним и эффект не срабатывает
    setText((t) => (parseDateText(t) === (value || null) ? t : shown));
  }, [value, shown]);
  return (
    <span className="relative block">
      <input
        ref={(el) => {
          if (el) el.setCustomValidity(invalid ? 'Введите дату: дд/мм/гггг' : '');
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="дд/мм/гггг"
        disabled={disabled}
        value={text}
        className={cx(inputCls, 'num', picker && 'pr-10', className)}
        onChange={(e) => {
          const next = maskDateText(e.target.value);
          setText(next);
          const iso = parseDateText(next);
          if (iso !== null) onChange({ target: { value: iso } });
          else if (next === '') onChange({ target: { value: '' } });
        }}
        onBlur={(e) => {
          // недонабранное не оставляем: на экране должна быть дата, которая реально сохранена
          if (invalid) setText(shown);
          onBlur?.(e);
        }}
      />
      {picker && (
        <>
          <input
            ref={native}
            type="date"
            tabIndex={-1}
            aria-hidden
            disabled={disabled}
            value={value}
            className="pointer-events-none absolute right-0 bottom-0 h-px w-px opacity-0"
            onChange={(e) => onChange({ target: { value: e.target.value } })}
          />
          <button
            type="button"
            aria-label="Открыть календарь"
            disabled={disabled}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-ink disabled:opacity-50"
            onClick={() => {
              try {
                native.current?.showPicker();
              } catch {
                native.current?.focus();
              }
            }}
          >
            <CalendarDays className="size-4" aria-hidden />
          </button>
        </>
      )}
    </span>
  );
});
DateInput.displayName = 'DateInput';

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, 'pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

/** Рубли → копейки. «1 250 000», «1250000,50», «1.5» → целые копейки; пусто → null. */
export function parseRubles(text: string): number | null {
  const cleaned = text.replace(/[\s ₽]/g, '').replace(',', '.');
  if (!cleaned) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return NaN;
  return rub(Number(cleaned));
}

function groupDigits(text: string): string {
  const [int, frac] = text.replace(/[\s ]/g, '').replace('.', ',').split(',');
  const grouped = (int ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac !== undefined ? `${grouped},${frac.slice(0, 2)}` : grouped;
}

/** Поле суммы: пользователь вводит рубли с разделителями разрядов, наружу — копейки. */
export function MoneyInput({ value, onChange, id, placeholder, autoFocus, ...rest }: { value: number | null | undefined; onChange(kop: number | null): void; id?: string; placeholder?: string; autoFocus?: boolean; 'aria-label'?: string }) {
  const toText = (v: number | null | undefined) => (v === null || v === undefined ? '' : groupDigits((v / 100).toString()));
  const [text, setText] = useState(toText(value));
  useEffect(() => {
    const parsed = parseRubles(text);
    if (parsed !== value && !(Number.isNaN(parsed) && value === null)) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        className={cx(inputCls, 'pr-9 text-right num')}
        value={text}
        placeholder={placeholder ?? '0'}
        autoFocus={autoFocus}
        aria-label={rest['aria-label']}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d\s ,.]/g, '');
          setText(groupDigits(raw));
          const kop = parseRubles(raw);
          onChange(kop === null || Number.isNaN(kop) ? null : kop);
        }}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted">₽</span>
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange(v: boolean): void; label: ReactNode; id?: string }) {
  const autoId = useId();
  const sid = id ?? autoId;
  return (
    <label htmlFor={sid} className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="text-sm">{label}</span>
      <button
        id={sid}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-primary' : 'bg-border')}
      >
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange(v: NoInfer<T>): void; options: { value: NoInfer<T>; label: ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('rounded-lg px-3 py-1.5 text-sm transition', value === o.value ? 'bg-surface font-medium shadow-sm' : 'text-ink-2')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── отображение ──
export function Money({ kop, kopecks = 'never', className }: { kop: number | null | undefined; kopecks?: 'auto' | 'always' | 'never'; className?: string }) {
  if (kop === null || kop === undefined) return <span className={className}>—</span>;
  return <span className={cx('num', className)}>{formatRub(kop, { kopecks })}</span>;
}

export function DateText({ date, year = true }: { date: string | null | undefined; year?: boolean }) {
  if (!date) return <span className="text-muted">—</span>;
  return <time dateTime={date}>{formatDateRu(date, { year })}</time>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'primary' }) {
  const t = { neutral: 'bg-surface-2 text-ink-2', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger', primary: 'bg-primary-soft text-primary' }[tone];
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', t)}>{children}</span>;
}

export function Progress({ value, tone = 'primary', label }: { value: number; tone?: 'primary' | 'warn' | 'ok'; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const color = tone === 'warn' ? 'bg-warn' : tone === 'ok' ? 'bg-ok' : 'bg-primary';
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spinner({ label = 'Загрузка' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-10 text-muted" role="status">
      <Loader2 className="size-6 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-md text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Не удалось загрузить данные';
  return (
    <Card tone="danger">
      <p className="text-sm">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </Card>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

// ── модальное окно (на телефоне — снизу) ──
export function Modal({ open, onOpenChange, title, children, description }: { open: boolean; onOpenChange(v: boolean): void; title: string; description?: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(560px,calc(100vw-32px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          aria-describedby={description ? undefined : undefined}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 text-sm text-ink-2">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="Закрыть">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Кнопка с подтверждением: для удаления. */
export function ConfirmButton({ children, confirm, onConfirm, variant = 'ghost', size = 'sm', loading }: { children: ReactNode; confirm: string; onConfirm(): void; variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} loading={loading ?? false}>
        {children}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Точно?">
        <p className="text-sm text-ink-2">{confirm}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            Да
          </Button>
        </div>
      </Modal>
    </>
  );
}
