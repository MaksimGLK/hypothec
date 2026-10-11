import { Banknote, BookOpen, CalendarDays, CircleHelp, ClipboardList, Home, Table2, Landmark, LifeBuoy, Lightbulb, Menu, PieChart, Receipt, Settings, Shield, Users, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../api/auth.js';
import { useHousehold } from '../api/household.js';
import { Disclaimer } from '../components/learning.js';
import { cx, Segmented } from '../components/ui/index.js';
import { VerifyEmailBanner } from '../pages/auth/VerifyEmailBanner.js';

interface Item {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
  /** Только в продвинутом режиме. */
  advanced?: boolean;
}

const MAIN: Item[] = [
  { to: '/month', label: 'Мой месяц', icon: Table2 },
  { to: '/', label: 'Обзор', icon: Home, end: true },
  { to: '/loan', label: 'Кредит', icon: Landmark, end: true },
  { to: '/loan/prepayment', label: 'Досрочка', icon: Landmark },
  { to: '/stages', label: 'Сделка', icon: ClipboardList },
  { to: '/cushion', label: 'Подушка', icon: LifeBuoy },
  { to: '/budget', label: 'Бюджет подробно', icon: PieChart, advanced: true },
  { to: '/money/incomes', label: 'Доходы подробно', icon: Banknote, advanced: true },
  { to: '/money/allocation', label: 'Счета и переводы', icon: Wallet, advanced: true },
  { to: '/money/expenses', label: 'Расходы сделки', icon: Receipt, advanced: true },
  { to: '/calendar', label: 'Календарь', icon: CalendarDays, advanced: true },
  { to: '/tax', label: 'Налоговый вычет', icon: Receipt, advanced: true },
  { to: '/advice', label: 'Советы', icon: Lightbulb },
  { to: '/learn', label: 'Уроки и словарь', icon: BookOpen },
];
const SECONDARY: Item[] = [
  { to: '/help', label: 'Как пользоваться', icon: CircleHelp },
  { to: '/family', label: 'Семья', icon: Users },
  { to: '/settings', label: 'Настройки', icon: Settings },
  { to: '/account', label: 'Мои данные', icon: Shield },
];

/** Нижняя панель на телефоне — пять главных разделов. */
const MOBILE: { to: string; label: string; icon: typeof Home; match: (p: string) => boolean }[] = [
  { to: '/month', label: 'Мой месяц', icon: Table2, match: (p) => p.startsWith('/month') },
  { to: '/', label: 'Обзор', icon: Home, match: (p) => p === '/' },
  { to: '/loan', label: 'Кредит', icon: Landmark, match: (p) => p.startsWith('/loan') },
  { to: '/stages', label: 'Сделка', icon: ClipboardList, match: (p) => p.startsWith('/stages') },
  { to: '/more', label: 'Ещё', icon: Menu, match: (p) => !['/', '/stages'].includes(p) && !p.startsWith('/month') && !p.startsWith('/loan') },
];

function useNav() {
  const { uiMode } = useAuth();
  return MAIN.filter((i) => uiMode === 'advanced' || !i.advanced);
}

/** Переключатель «Простой / Продвинутый». */
export function ModeSwitch() {
  const { uiMode, setUiMode } = useAuth();
  return (
    <div className="px-3">
      <Segmented
        label="Режим"
        value={uiMode}
        onChange={(m) => void setUiMode(m)}
        options={[
          { value: 'simple', label: 'Простой' },
          { value: 'advanced', label: 'Продвинутый' },
        ]}
      />
      <p className="mt-1.5 text-xs text-muted">{uiMode === 'simple' ? 'Главное без лишних настроек.' : 'Все разделы: счета и переводы, сценарии, вычеты, календарь.'}</p>
    </div>
  );
}

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
  const nav = useNav();
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
          {nav.map((i) => (
            <SideLink key={i.to} item={i} />
          ))}
        </nav>
        <div className="my-3 border-t border-border" />
        <nav className="flex flex-col gap-0.5" aria-label="Аккаунт">
          {SECONDARY.map((i) => (
            <SideLink key={i.to} item={i} />
          ))}
        </nav>
        <div className="mt-auto pt-4">
          <ModeSwitch />
          <p className="mt-3 px-3 text-xs text-muted">{user?.email}</p>
        </div>
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
  const nav = useNav();
  const items = [...nav.filter((i) => !['/', '/stages', '/loan', '/month'].includes(i.to)), ...SECONDARY];
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Ещё</h1>
      <div className="mb-4 -mx-3">
        <ModeSwitch />
      </div>
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

export function Tabs({ items: all }: { items: { to: string; label: ReactNode; end?: boolean; advanced?: boolean }[] }) {
  const { uiMode } = useAuth();
  const items = all.filter((i) => uiMode === 'advanced' || !i.advanced);
  if (items.length < 2) return null;
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
