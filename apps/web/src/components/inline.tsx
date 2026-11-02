import { formatDateRu, formatRub } from '@hypothec/core';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { cx, DateInput, parseRubles } from './ui/index.js';

/**
 * Ячейка «как в таблице»: показывает значение, по нажатию превращается в поле, Enter или уход с поля — сохранить, Esc — отменить.
 */
function useCell<T>(value: T, onSave: (v: T) => void, parse: (text: string) => T | undefined, format: (v: T) => string) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  const start = () => {
    setText(format(value));
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const v = parse(text);
    if (v !== undefined && v !== value) onSave(v);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(false);
  };
  return { editing, text, setText, ref, start, commit, onKeyDown };
}

export function MoneyCell({ value, onSave, label, placeholder = 'впишите', className }: { value: number; onSave(kop: number): void; label: string; placeholder?: string; className?: string }) {
  const c = useCell(
    value,
    onSave,
    (t) => {
      const k = parseRubles(t);
      return k === null ? 0 : Number.isNaN(k) ? undefined : k;
    },
    (v) => (v ? String(v / 100).replace('.', ',') : ''),
  );
  if (c.editing) {
    return (
      <input
        ref={c.ref}
        aria-label={label}
        inputMode="decimal"
        className={cx('h-8 w-28 rounded-lg border border-primary bg-surface px-2 text-right num focus:outline-none', className)}
        value={c.text}
        onChange={(e) => c.setText(e.target.value.replace(/[^\d\s,.]/g, ''))}
        onBlur={c.commit}
        onKeyDown={c.onKeyDown}
      />
    );
  }
  return (
    <button type="button" onClick={c.start} aria-label={`${label}: изменить`} className={cx('num rounded-lg px-2 py-1 text-right hover:bg-surface-2', !value && 'text-warn', className)}>
      {value ? formatRub(value, { kopecks: 'auto' }) : placeholder}
    </button>
  );
}

export function TextCell({ value, onSave, label, className }: { value: string; onSave(v: string): void; label: string; className?: string }) {
  const c = useCell(value, onSave, (t) => (t.trim() ? t.trim() : undefined), (v) => v);
  if (c.editing) {
    return (
      <input
        ref={c.ref}
        aria-label={label}
        className={cx('h-8 w-full min-w-0 rounded-lg border border-primary bg-surface px-2 focus:outline-none', className)}
        value={c.text}
        onChange={(e) => c.setText(e.target.value)}
        onBlur={c.commit}
        onKeyDown={c.onKeyDown}
      />
    );
  }
  return (
    <button type="button" onClick={c.start} aria-label={`${label}: изменить`} className={cx('min-w-0 truncate rounded-lg px-2 py-1 text-left hover:bg-surface-2', className)}>
      {value}
    </button>
  );
}

/** Дата разового поступления: показываем «12 ноября», по нажатию — поле даты. */
export function DateCell({ value, onSave, label }: { value: string | null | undefined; onSave(date: string): void; label: string }) {
  const c = useCell(
    value ?? '',
    onSave,
    (t) => t || undefined,
    (v) => v,
  );
  if (c.editing) {
    return (
      <DateInput
        ref={c.ref}
        autoFocus
        picker={false}
        aria-label={label}
        className="h-8 w-32 rounded-lg border border-primary bg-surface px-2 focus:outline-none"
        value={c.text}
        onChange={(e) => c.setText(e.target.value)}
        onBlur={c.commit}
        onKeyDown={c.onKeyDown}
      />
    );
  }
  return (
    <button type="button" onClick={c.start} aria-label={`${label}: изменить`} className={cx('rounded-lg px-2 py-1 text-center hover:bg-surface-2', !value && 'text-warn')}>
      {value ? formatDateRu(value, { year: false }) : '—'}
    </button>
  );
}

export function DayCell({ value, onSave, label }: { value: number | null | undefined; onSave(day: number): void; label: string }) {
  const c = useCell(
    value ?? 0,
    onSave,
    (t) => {
      const n = Number(t.replace(/\D/g, ''));
      return n >= 1 && n <= 31 ? n : undefined;
    },
    (v) => (v ? String(v) : ''),
  );
  if (c.editing) {
    return (
      <input
        ref={c.ref}
        aria-label={label}
        inputMode="numeric"
        className="h-8 w-14 rounded-lg border border-primary bg-surface px-2 text-center focus:outline-none"
        value={c.text}
        onChange={(e) => c.setText(e.target.value)}
        onBlur={c.commit}
        onKeyDown={c.onKeyDown}
      />
    );
  }
  return (
    <button type="button" onClick={c.start} aria-label={`${label}: изменить`} className={cx('w-14 rounded-lg px-2 py-1 text-center hover:bg-surface-2', !value && 'text-warn')}>
      {value ? `${value}-го` : '—'}
    </button>
  );
}

/**
 * Ячейка «Потрачено»: можно вписать итог за месяц («7500») или добавить к уже потраченному («+2500»).
 */
export function FactCell({ value, onSave, label, over }: { value: number; onSave(totalKop: number): void; label: string; over?: boolean }) {
  const c = useCell(
    value,
    onSave,
    (t) => {
      const trimmed = t.trim();
      const add = trimmed.startsWith('+');
      const k = parseRubles(add ? trimmed.slice(1) : trimmed);
      if (k === null) return add ? undefined : 0;
      if (Number.isNaN(k)) return undefined;
      return add ? value + k : k;
    },
    () => '',
  );
  if (c.editing) {
    return (
      <input
        ref={c.ref}
        aria-label={label}
        inputMode="text"
        placeholder={value ? `${Math.round(value / 100)} или +сумма` : 'сумма'}
        className="h-8 w-28 rounded-lg border border-primary bg-surface px-2 text-right num placeholder:text-xs focus:outline-none"
        value={c.text}
        onChange={(e) => c.setText(e.target.value.replace(/[^\d\s,.+]/g, ''))}
        onBlur={c.commit}
        onKeyDown={c.onKeyDown}
      />
    );
  }
  return (
    <button type="button" onClick={c.start} aria-label={`${label}: изменить`} className={cx('num rounded-lg px-2 py-1 text-right hover:bg-surface-2', over ? 'text-danger' : 'text-ink-2')}>
      {formatRub(value, { kopecks: 'auto' })}
    </button>
  );
}
