import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../api/auth.js';
import { api, ApiError } from '../../api/client.js';
import { Button, Field, Input } from '../../components/ui/index.js';

function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-3 size-12" />
          <p className="text-sm text-muted">Ипотечный планировщик</p>
          <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">{children}</div>
        {footer && <div className="mt-5 text-center text-sm text-ink-2">{footer}</div>}
      </div>
    </div>
  );
}

function FormError({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
      {error.message}
    </p>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const next = params.get('next');
  return (
    <AuthShell
      title="Вход"
      footer={
        <>
          Нет аккаунта?{' '}
          <Link to={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-primary">
            Зарегистрироваться
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Почта" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Пароль" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FormError error={error} />
        <Button type="submit" loading={busy}>
          Войти
        </Button>
        <Link to="/forgot" className="text-center text-sm text-ink-2">
          Забыли пароль?
        </Link>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ name: '', email: '', password: '', consent: false, marketing: false });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.consent) return;
    setBusy(true);
    setError(null);
    try {
      await register({ name: form.name, email: form.email, password: form.password, marketing: form.marketing });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const next = params.get('next');
  return (
    <AuthShell
      title="Регистрация"
      footer={
        <>
          Уже есть аккаунт?{' '}
          <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-primary">
            Войти
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Как к вам обращаться" htmlFor="name">
          <Input id="name" autoComplete="given-name" required value={form.name} onChange={(e) => set('name')(e.target.value)} />
        </Field>
        <Field label="Почта" htmlFor="email" error={error?.field('email')}>
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => set('email')(e.target.value)} />
        </Field>
        <Field label="Пароль" htmlFor="password" hint="Не короче 8 символов. Удобно взять фразу из нескольких слов." error={error?.code === 'weak_password' ? error.message : error?.field('password')}>
          <Input id="password" type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={(e) => set('password')(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={form.consent} onChange={(e) => set('consent')(e.target.checked)} required />
          <span>
            Я даю{' '}
            <Link to="/consent" target="_blank" className="text-primary underline">
              согласие на обработку персональных данных
            </Link>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={form.marketing} onChange={(e) => set('marketing')(e.target.checked)} />
          <span>Присылать новости сервиса (не чаще раза в месяц)</span>
        </label>
        {error && !['weak_password'].includes(error.code) && !error.field('email') && <FormError error={error} />}
        <Button type="submit" loading={busy} disabled={!form.consent}>
          Создать аккаунт
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Восстановление пароля" footer={<Link to="/login" className="text-primary">Вернуться ко входу</Link>}>
      {step === 'email' ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api('/auth/password/forgot', { method: 'POST', body: { email }, noRefresh: true });
              setStep('code');
            });
          }}
        >
          <p className="text-sm text-ink-2">Пришлём на почту код для сброса пароля.</p>
          <Field label="Почта" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <FormError error={error} />
          <Button type="submit" loading={busy}>
            Получить код
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api('/auth/password/reset', { method: 'POST', body: { email, code, newPassword: password }, noRefresh: true });
              navigate('/login', { replace: true });
            });
          }}
        >
          <p className="text-sm text-ink-2">Если аккаунт с адресом {email} есть, код уже в почте. Он действует 15 минут.</p>
          <Field label="Код из письма" htmlFor="code">
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Новый пароль" htmlFor="password" hint="Не короче 8 символов">
            <Input id="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <FormError error={error} />
          <Button type="submit" loading={busy}>
            Сохранить пароль
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
