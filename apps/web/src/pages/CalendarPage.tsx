import { addMonths, endOfMonth, formatDateRu, formatMonthRu, startOfMonth } from '@hypothec/core';
import { Banknote, CalendarCheck, ChevronLeft, ChevronRight, Download, FileText, Landmark, Receipt, Shield, Wallet } from 'lucide-react';
import { useState } from 'react';
import { download } from '../api/client.js';
import { useHh, useHousehold } from '../api/household.js';
import type { CalendarEvent } from '../api/types.js';
import { Button, cx, ErrorBox, Money, PageHeader, Spinner } from '../components/ui/index.js';
import { useToast } from '../components/ui/toast.js';

const ICONS: Record<CalendarEvent['type'], { icon: typeof Banknote; cls: string; label: string }> = {
  loan_payment: { icon: Landmark, cls: 'text-primary', label: 'Платёж' },
  income: { icon: Banknote, cls: 'text-ok', label: 'Поступление' },
  transfer: { icon: Wallet, cls: 'text-ink-2', label: 'Перевод' },
  stage: { icon: CalendarCheck, cls: 'text-primary', label: 'Этап' },
  insurance: { icon: Shield, cls: 'text-warn', label: 'Страховка' },
  expense: { icon: Receipt, cls: 'text-ink-2', label: 'Расход' },
  prepayment: { icon: Landmark, cls: 'text-ok', label: 'Досрочка' },
  prepayment_notice: { icon: FileText, cls: 'text-warn', label: 'Заявление' },
  tax_declaration: { icon: FileText, cls: 'text-primary', label: 'Вычет' },
};

export default function CalendarPage() {
  const { hid } = useHousehold();
  const toast = useToast();
  const [month, setMonth] = useState(() => startOfMonth(new Date().toISOString().slice(0, 10)));
  const [hidden, setHidden] = useState<Set<CalendarEvent['type']>>(new Set(['transfer']));
  const events = useHh<CalendarEvent[]>(`/calendar?from=${month}&to=${endOfMonth(month)}`);
  const list = (events.data ?? []).filter((e) => !hidden.has(e.type));
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of list) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  return (
    <div>
      <PageHeader
        title="Календарь"
        subtitle="Платежи, поступления, этапы, страховка, досрочка и вычет — в одной ленте."
        action={
          <Button size="sm" variant="secondary" onClick={() => download(`/households/${hid}/calendar.ics`, 'ipoteka.ics').catch((e: Error) => toast.show(e.message, 'error'))}>
            <Download className="size-4" aria-hidden /> В календарь телефона
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Предыдущий месяц" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-36 text-center font-medium capitalize">{formatMonthRu(month)}</span>
          <Button size="sm" variant="ghost" aria-label="Следующий месяц" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(ICONS) as CalendarEvent['type'][]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={!hidden.has(t)}
              onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; })}
              className={cx('rounded-full border px-2.5 py-1 text-xs', hidden.has(t) ? 'border-border text-muted' : 'border-primary bg-primary-soft text-primary')}
            >
              {ICONS[t].label}
            </button>
          ))}
        </div>
      </div>
      {events.isLoading ? (
        <Spinner />
      ) : events.error ? (
        <ErrorBox error={events.error} />
      ) : byDate.size === 0 ? (
        <p className="text-sm text-ink-2">В этом месяце событий нет.</p>
      ) : (
        <ol className="space-y-4">
          {[...byDate.entries()].map(([date, items]) => (
            <li key={date}>
              <h2 className="mb-2 text-sm font-medium text-muted">{formatDateRu(date, { year: false })}</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {items.map((e) => {
                  const I = ICONS[e.type];
                  return (
                    <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                      <I.icon className={cx('mt-0.5 size-5 shrink-0', I.cls)} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{e.title}</p>
                        {e.details && <p className="mt-0.5 text-xs text-ink-2">{e.details}</p>}
                      </div>
                      {e.amountKop ? <Money kop={e.amountKop} className="text-sm" /> : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
