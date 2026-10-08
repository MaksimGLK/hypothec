import { addDays, type CalendarEvent, type CalendarEventType, formatDateRu, formatRub } from '@hypothec/core';
import { and, eq, gt, inArray, isNotNull, lte, notInArray, sql } from 'drizzle-orm';
import { todayInMoscow } from '../config.js';
import { householdMembers, notificationPreferences, notifications, users } from '../db/schema.js';
import type { AppDeps } from '../deps.js';
import { renderEmail } from '../lib/mailer.js';
import { getPlan } from './plan.js';

export interface ReminderPref {
  email: boolean;
  push: boolean;
  /** За сколько дней до события напомнить (0 — в день события). */
  daysBefore: number;
}

export type ReminderType = Exclude<CalendarEventType, 'income'>;
export type NotificationPrefs = Record<ReminderType, ReminderPref>;

export const REMINDER_LABELS: Record<ReminderType, string> = {
  loan_payment: 'Платёж по ипотеке',
  transfer: 'Переводы по счетам',
  prepayment: 'Досрочный платёж',
  prepayment_notice: 'Заявление на досрочку',
  insurance: 'Продление страховки',
  expense: 'Расходы сделки',
  stage: 'Этапы сделки',
  tax_declaration: 'Декларация на вычет',
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  loan_payment: { email: true, push: true, daysBefore: 3 },
  transfer: { email: true, push: true, daysBefore: 0 },
  prepayment: { email: true, push: true, daysBefore: 3 },
  prepayment_notice: { email: true, push: true, daysBefore: 2 },
  insurance: { email: true, push: true, daysBefore: 30 },
  expense: { email: false, push: true, daysBefore: 3 },
  stage: { email: true, push: true, daysBefore: 1 },
  tax_declaration: { email: true, push: true, daysBefore: 0 },
};

export function mergePrefs(stored: unknown): NotificationPrefs {
  const s = (stored ?? {}) as Partial<NotificationPrefs>;
  const out = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const k of Object.keys(out) as ReminderType[]) out[k] = { ...out[k], ...(s[k] ?? {}) };
  return out;
}

const HORIZON_DAYS = 45;

function when(daysBefore: number): string {
  if (daysBefore === 0) return 'Сегодня';
  if (daysBefore === 1) return 'Завтра';
  return `Через ${daysBefore} дн.`;
}

/** Текст напоминания простым языком. */
export function reminderText(e: CalendarEvent, daysBefore: number): { title: string; body: string } {
  const amount = e.amountKop ? formatRub(e.amountKop, { kopecks: 'never' }) : '';
  const date = formatDateRu(e.date, { year: false });
  const w = when(daysBefore);
  switch (e.type) {
    case 'loan_payment':
      return { title: `${w}: платёж по ипотеке ${amount}`, body: `${date} — платёж ${amount}. Проверьте, что на ипотечном счёте достаточно денег.` };
    case 'transfer':
      return { title: `${w}: разложите деньги по счетам`, body: `${e.title}: ${e.details ?? ''}` };
    case 'prepayment':
      return { title: `${w}: досрочный платёж ${amount}`, body: `${date} по плану досрочный платёж ${amount}. Убедитесь, что заявление в банк подано.` };
    case 'prepayment_notice':
      return { title: `${w}: подать заявление на досрочку`, body: `${e.details ?? ''}. Сумма досрочки — ${amount}.` };
    case 'insurance':
      return {
        title: `${w}: ${e.title.toLowerCase()}`,
        body: `${date} — продление полиса, по плану около ${amount}. Полис можно сравнить у других страховщиков, которых принимает ваш банк.`,
      };
    case 'expense':
      return { title: `${w}: ${e.title}`, body: `${date} — ${e.title}, по плану ${amount}.` };
    case 'stage':
      return { title: `${w}: ${e.title}`, body: `По плану на ${date} — этап «${e.title}». Отметьте его в чек-листе, когда сделаете.` };
    case 'tax_declaration':
      return { title: e.title, body: `По вашим данным можно вернуть около ${amount}. ${e.details ?? ''}` };
    default:
      return { title: e.title, body: date };
  }
}

function scheduledAt(date: string, hour: number): Date {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+03:00`);
}

/**
 * Пересобирает напоминания семьи по текущему плану: добавляет новые, обновляет изменившиеся,
 * отменяет те, чьих событий больше нет (например, сдвинулась дата или удалили досрочку).
 */
export async function rebuildHouseholdReminders(deps: AppDeps, householdId: string): Promise<{ scheduled: number; cancelled: number }> {
  const { db } = deps;
  const now = deps.now();
  const today = todayInMoscow(now);
  const { plan } = await getPlan(deps, householdId);
  const horizon = addDays(today, HORIZON_DAYS);
  const events = plan.calendar.filter((e) => e.type !== 'income' && e.date >= today && e.date <= horizon);

  const members = await db
    .select({ userId: users.id, prefs: notificationPreferences.prefs })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(and(eq(householdMembers.householdId, householdId), isNotNull(users.emailVerifiedAt)));

  let scheduled = 0;
  let cancelled = 0;
  for (const m of members) {
    const prefs = mergePrefs(m.prefs);
    const keys: string[] = [];
    const rows: (typeof notifications.$inferInsert)[] = [];
    for (const e of events) {
      const pref = prefs[e.type as ReminderType];
      if (!pref?.email) continue;
      const sendDate = addDays(e.date, -pref.daysBefore);
      const at = scheduledAt(sendDate, deps.config.REMINDER_HOUR);
      // если окно «за N дней» уже прошло, а событие ещё впереди — напомним сейчас
      const scheduledFor = at < now ? now : at;
      const daysLeft = sendDate < today ? Math.max(0, Math.round((scheduledAt(e.date, 12).getTime() - now.getTime()) / 86_400_000)) : pref.daysBefore;
      const { title, body } = reminderText(e, daysLeft);
      const dedupeKey = `${m.userId}:${e.id}:${pref.daysBefore}:email`;
      keys.push(dedupeKey);
      rows.push({ userId: m.userId, householdId, type: e.type, title, body, eventDate: e.date, scheduledFor, channel: 'email', dedupeKey });
    }
    if (rows.length) {
      await db
        .insert(notifications)
        .values(rows)
        .onConflictDoUpdate({
          target: notifications.dedupeKey,
          set: { title: sql`excluded.title`, body: sql`excluded.body`, scheduledFor: sql`excluded.scheduled_for` },
          setWhere: sql`${notifications.status} = 'pending'`,
        });
      scheduled += rows.length;
    }
    const stale = await db
      .update(notifications)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(notifications.userId, m.userId),
          eq(notifications.householdId, householdId),
          eq(notifications.status, 'pending'),
          keys.length ? notInArray(notifications.dedupeKey, keys) : sql`true`,
        ),
      )
      .returning({ id: notifications.id });
    cancelled += stale.length;
  }
  return { scheduled, cancelled };
}

/** Отправляет наступившие напоминания одним письмом на человека. */
export async function sendDueNotifications(deps: AppDeps, limit = 200): Promise<number> {
  const { db } = deps;
  const now = deps.now();
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ n: notifications, email: users.email, name: users.name })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .where(and(eq(notifications.status, 'pending'), eq(notifications.channel, 'email'), lte(notifications.scheduledFor, now)))
      .orderBy(notifications.scheduledFor)
      .limit(limit)
      .for('update', { of: notifications, skipLocked: true });
    const byUser = new Map<string, typeof due>();
    for (const d of due) byUser.set(d.n.userId, [...(byUser.get(d.n.userId) ?? []), d]);
    let sent = 0;
    for (const items of byUser.values()) {
      const ids = items.map((i) => i.n.id);
      try {
        const subject = items.length === 1 ? items[0]!.n.title : `Напоминания на ${formatDateRu(todayInMoscow(now), { year: false })}: ${items.length}`;
        const { text, html } = renderEmail(
          subject,
          items.flatMap((i) => (items.length === 1 ? [i.n.body] : [`• ${i.n.title}. ${i.n.body}`])).concat(['Настроить напоминания можно в разделе «Настройки».']),
        );
        await deps.mailer.send({ to: items[0]!.email, subject, text, html });
        await tx.update(notifications).set({ status: 'sent', sentAt: now }).where(inArray(notifications.id, ids));
        sent += ids.length;
      } catch (err) {
        await tx.update(notifications).set({ status: 'failed', error: String(err).slice(0, 500) }).where(inArray(notifications.id, ids));
      }
    }
    return sent;
  });
}

/** Отменить будущие напоминания семьи (например, при выходе участника). */
export async function cancelUserReminders(deps: AppDeps, userId: string, householdId: string) {
  await deps.db
    .update(notifications)
    .set({ status: 'cancelled' })
    .where(and(eq(notifications.userId, userId), eq(notifications.householdId, householdId), eq(notifications.status, 'pending'), gt(notifications.scheduledFor, deps.now())));
}
