import { Banknote, BookOpen, CalendarDays, ClipboardList, Home, Landmark, LifeBuoy, Lightbulb, Menu, Receipt, Settings, Shield, Users, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../api/auth.js';
import { useHousehold } from '../api/household.js';
import { Disclaimer } from '../components/learning.js';
import { cx } from '../components/ui/index.js';
import { VerifyEmailBanner } from '../pages/auth/VerifyEmailBanner.js';

interface Item {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
}

const MAIN: Item[] = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/stages', label: 'Сделка', icon: ClipboardList },
  { to: '/money/incomes', label: 'Доходы', icon: Banknote },
  { to: '/money/expenses', label: 'Расходы', icon: Receipt },
  { to: '/money/allocation', label: 'Счета и переводы', icon: Wallet },
  { to: '/loan', label: 'Кредит', icon: Landmark, end: true },
  { to: '/loan/prepayment', label: 'Досрочка', icon: Landmark },
  { to: '/cushion', label: 'Подушка', icon: LifeBuoy },
  { to: '/calendar', label: 'Календарь', icon: CalendarDays },
  { to: '/advice', label: 'Советы', icon: Lightbulb },
  { to: '/tax', label: 'Налоговый вычет', icon: Receipt },
  { to: '/learn', label: 'Уроки и словарь', icon: BookOpen },
];
const SECONDARY: Item[] = [
  { to: '/family', label: 'Семья', icon: Users },
  { to: '/settings', label: 'Настройки', icon: Settings },
  { to: '/account', label: 'Мои данные', icon: Shield },
];

/** Нижняя панель на телефоне — пять главных разделов. */
const MOBILE: { to: string; label: string; icon: typeof Home; match: (p: string) => boolean }[] = [
  { to: '/', label: 'Главная', icon: Home, match: (p) => p === '/' },
  { to: '/stages', label: 'Сделка', icon: ClipboardList, match: (p) => p.startsWith('/stages') },
  { to: '/money/allocation', label: 'Деньги', icon: Wallet, match: (p) => p.startsWith('/money') },
  { to: '/loan', label: 'Кредит', icon: Landmark, match: (p) => p.startsWith('/loan') },
  { to: '/more', label: 'Ещё', icon: Menu, match: (p) => !['/', '/stages'].includes(p) && !p.startsWith('/money') && !p.startsWith('/loan') },
];

function SideLink({ item }: { item: Item }) {
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2 text-sm', isActive ? 'bg-primary-soft font-medium text-primary' : 'text-ink-2 hover:bg-surface-2')}
    >
      <item.icon className="size-4" aria-hidden />
      {item.label}
    </NavLink>
  );
}

export function AppLayout() {
  const { pathname } = useLocation();
  const { current, households, select } = useHousehold();
  const { user } = useAuth();
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface px-3 py-5 lg:flex">
        <div className="mb-4 px-3">
          <p className="font-semibold">Ипотечный планировщик</p>
          {households.length > 1 ? (
            <select className="mt-1 w-full bg-transparent text-sm text-ink-2" value={current?.id} onChange={(e) => select(e.target.value)} aria-label="Семья">
              {households.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-muted">{current?.name}</p>
          )}
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="Разделы">
          {MAIN.map((i) => (
            <SideLink key={i.to} item={i} />
          ))}
        </nav>
        <div className="my-3 border-t border-border" />
        <nav className="flex flex-col gap-0.5" aria-label="Аккаунт">
          {SECONDARY.map((i) => (
            <SideLink key={i.to} item={i} />
          ))}
        </nav>
        <p className="mt-auto px-3 pt-4 text-xs text-muted">{user?.email}</p>
      </aside>

      <div className="min-w-0 flex-1">
        <VerifyEmailBanner />
        <main className="mx-auto w-full max-w-5xl px-4 pt-5 pb-28 sm:px-6 lg:pt-8 lg:pb-10">
          <Outlet />
          <Disclaimer className="mt-10" />
        </main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 backdrop-blur lg:hidden" aria-label="Разделы">
        {MOBILE.map((i) => {
          const active = i.match(pathname);
          return (
            <NavLink key={i.to} to={i.to} className={cx('flex flex-col items-center gap-0.5 py-2 text-[11px]', active ? 'text-primary' : 'text-muted')} aria-current={active ? 'page' : undefined}>
              <i.icon className="size-5" aria-hidden />
              {i.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

/** Экран «Ещё» на телефоне: все остальные разделы списком. */
export function MorePage() {
  const items = [...MAIN.filter((i) => !['/', '/stages', '/loan'].includes(i.to)), ...SECONDARY];
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Ещё</h1>
      <nav className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} className="flex items-center gap-3 px-4 py-3.5">
            <i.icon className="size-5 text-muted" aria-hidden />
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function Tabs({ items }: { items: { to: string; label: ReactNode; end?: boolean }[] }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 lg:hidden" aria-label="Подразделы">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end ?? false} className={({ isActive }) => cx('shrink-0 rounded-lg px-3 py-1.5 text-sm', isActive ? 'bg-surface font-medium shadow-sm' : 'text-ink-2')}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
