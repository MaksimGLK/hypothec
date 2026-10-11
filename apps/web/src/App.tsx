import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, type ReactNode, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './api/auth.js';
import { ApiError } from './api/client.js';
import { HouseholdProvider, useHh } from './api/household.js';
import type { ScenarioDto } from './api/types.js';
import { Spinner } from './components/ui/index.js';
import { ToastProvider } from './components/ui/toast.js';
import { AppLayout, MorePage } from './layout/AppLayout.js';
import { ForgotPage, LoginPage, RegisterPage } from './pages/auth/AuthPages.js';
import { ConsentPage } from './pages/auth/ConsentPage.js';
import { InvitePage } from './pages/auth/InvitePage.js';
import { HelpPage } from './pages/HelpPage.js';
import { DashboardPage } from './pages/DashboardPage.js';

// тяжёлые экраны (графики) — отдельными чанками
const WizardPage = lazy(() => import('./pages/WizardPage.js'));
const StagesPage = lazy(() => import('./pages/StagesPage.js'));
const IncomesPage = lazy(() => import('./pages/money/IncomesPage.js'));
const BudgetPage = lazy(() => import('./pages/BudgetPage.js'));
const MonthPage = lazy(() => import('./pages/MonthPage.js'));
const ExpensesPage = lazy(() => import('./pages/money/ExpensesPage.js'));
const AllocationPage = lazy(() => import('./pages/money/AllocationPage.js'));
const LoanPage = lazy(() => import('./pages/loan/LoanPage.js'));
const PrepaymentPage = lazy(() => import('./pages/loan/PrepaymentPage.js'));
const CushionPage = lazy(() => import('./pages/CushionPage.js'));
const CalendarPage = lazy(() => import('./pages/CalendarPage.js'));
const AdvicePage = lazy(() => import('./pages/AdvicePage.js'));
const LearnPage = lazy(() => import('./pages/LearnPage.js'));
const TaxPage = lazy(() => import('./pages/TaxPage.js'));
const FamilyPage = lazy(() => import('./pages/FamilyPage.js'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.js'));
const AccountPage = lazy(() => import('./pages/AccountPage.js'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => (err instanceof ApiError && err.status === 429 ? count < 3 : !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2),
      retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
    },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Spinner label="Проверяем вход" />;
  if (status === 'signed-out') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const next = new URLSearchParams(useLocation().search).get('next');
  if (status === 'loading') return <Spinner />;
  if (status === 'signed-in') return <Navigate to={next && next.startsWith('/') ? next : '/'} replace />;
  return <>{children}</>;
}

/** Пока сценарий не заполнен — ведём в мастер. */
function RequireScenario({ children }: { children: ReactNode }) {
  const { data, isLoading } = useHh<ScenarioDto | null>('/scenario');
  if (isLoading) return <Spinner />;
  if (!data) return <Navigate to="/wizard" replace />;
  return <>{children}</>;
}

const page = (el: ReactNode) => <Suspense fallback={<Spinner />}>{el}</Suspense>;

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<RedirectIfSignedIn><LoginPage /></RedirectIfSignedIn>} />
              <Route path="/register" element={<RedirectIfSignedIn><RegisterPage /></RedirectIfSignedIn>} />
              <Route path="/forgot" element={<ForgotPage />} />
              <Route path="/consent" element={<ConsentPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/invite/:token" element={<RequireAuth><InvitePage /></RequireAuth>} />
              <Route
                element={
                  <RequireAuth>
                    <HouseholdProvider>
                      <AppLayout />
                    </HouseholdProvider>
                  </RequireAuth>
                }
              >
                <Route path="/wizard" element={page(<WizardPage />)} />
                <Route path="/family" element={page(<FamilyPage />)} />
                <Route path="/settings" element={page(<SettingsPage />)} />
                <Route path="/account" element={page(<AccountPage />)} />
                <Route path="/more" element={<MorePage />} />
                <Route path="/learn" element={page(<LearnPage />)} />
                <Route path="/" element={<RequireScenario><DashboardPage /></RequireScenario>} />
                <Route path="/stages" element={<RequireScenario>{page(<StagesPage />)}</RequireScenario>} />
 <Route path="/month" element={<RequireScenario>{page(<MonthPage />)}</RequireScenario>} />
                <Route path="/budget" element={<RequireScenario>{page(<BudgetPage />)}</RequireScenario>} />
                <Route path="/money/incomes" element={<RequireScenario>{page(<IncomesPage />)}</RequireScenario>} />
                <Route path="/money/expenses" element={<RequireScenario>{page(<ExpensesPage />)}</RequireScenario>} />
                <Route path="/money/allocation" element={<RequireScenario>{page(<AllocationPage />)}</RequireScenario>} />
                <Route path="/money" element={<Navigate to="/money/allocation" replace />} />
                <Route path="/loan" element={<RequireScenario>{page(<LoanPage />)}</RequireScenario>} />
                <Route path="/loan/prepayment" element={<RequireScenario>{page(<PrepaymentPage />)}</RequireScenario>} />
                <Route path="/cushion" element={<RequireScenario>{page(<CushionPage />)}</RequireScenario>} />
                <Route path="/calendar" element={<RequireScenario>{page(<CalendarPage />)}</RequireScenario>} />
                <Route path="/advice" element={<RequireScenario>{page(<AdvicePage />)}</RequireScenario>} />
                <Route path="/tax" element={<RequireScenario>{page(<TaxPage />)}</RequireScenario>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
