import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, LogOut } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../api/auth.js';
import { api, ApiError, download } from '../api/client.js';
import { Badge, Button, Card, Field, Input, Modal, PageHeader } from '../components/ui/index.js';
import { useToast } from '../components/ui/toast.js';

interface SessionDto {
  id: string;
  platform: 'web' | 'ios' | 'android';
  deviceName: string | null;
  lastUsedAt: string;
  current: boolean;
}

export default function AccountPage() {
  const { user, logout, reloadUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  return (
    <div>
      <PageHeader title="Мои данные" subtitle={user?.email} />
      <Card title="Профиль">
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await api('/me', { method: 'PATCH', body: { name } });
            await reloadUser();
            toast.show('Сохранено');
          }}
        >
          <Input aria-label="Имя" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="secondary">
            Сохранить
          </Button>
        </form>
      </Card>
      <ChangePassword />
      <Sessions />
      <Card className="mt-4" title="Выгрузка данных">
        <p className="text-sm text-ink-2">Все ваши данные и данные ваших семейных планов одним файлом (JSON).</p>
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => download('/me/export', `ipoteka-dannye-${new Date().toISOString().slice(0, 10)}.json`).catch((e: Error) => toast.show(e.message, 'error'))}
        >
          <Download className="size-4" aria-hidden /> Скачать мои данные
        </Button>
      </Card>
      <DeleteAccount />
      <Button variant="ghost" className="mt-6" onClick={() => void logout()}>
        <LogOut className="size-4" aria-hidden /> Выйти
      </Button>
    </div>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/auth/password/change', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setCurrent('');
      setNext('');
      toast.show('Пароль изменён. На других устройствах нужно войти заново.');
    } catch (err) {
      setError(err as ApiError);
    }
  };
  return (
    <Card className="mt-4" title="Пароль">
      <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={submit}>
        <Field label="Текущий" htmlFor="pw-cur">
          <Input id="pw-cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Новый" htmlFor="pw-new">
          <Input id="pw-new" type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary">
          Сменить
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-danger">{error.message}</p>}
    </Card>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionDto[]>('/auth/sessions') });
  return (
    <Card className="mt-4" title="Устройства">
      <ul className="divide-y divide-border">
        {sessions.data?.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate">{s.deviceName ?? { web: 'Браузер', ios: 'iPhone', android: 'Android' }[s.platform]}</span>
              <span className="text-xs text-muted">был активен {new Date(s.lastUsedAt).toLocaleString('ru-RU')}</span>
            </span>
            {s.current ? (
              <Badge tone="primary">это устройство</Badge>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => api(`/auth/sessions/${s.id}`, { method: 'DELETE' }).then(() => qc.invalidateQueries({ queryKey: ['sessions'] }))}>
                Выйти
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DeleteAccount() {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'intro' | 'code'>('intro');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mt-4" title="Удаление аккаунта">
      <p className="text-sm text-ink-2">Все ваши данные будут удалены без возможности восстановления. Если в семейном плане есть другой участник, план останется у него.</p>
      <Button variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
        Удалить аккаунт
      </Button>
      <Modal open={open} onOpenChange={(o) => (setOpen(o), setStep('intro'))} title="Удалить аккаунт">
        {step === 'intro' ? (
          <div className="space-y-4">
            <p className="text-sm">Перед удалением можно скачать свои данные. Чтобы подтвердить, пришлём код на почту.</p>
            {error && <p className="text-sm text-danger">{error.message}</p>}
            <Button variant="danger" loading={busy} onClick={() => run(async () => (await api('/me/delete/request', { method: 'POST' }), setStep('code')))}>
              Прислать код
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api('/me', { method: 'DELETE', body: { password, code } });
                await logout();
              });
            }}
          >
            <Field label="Код из письма" htmlFor="del-code">
              <Input id="del-code" inputMode="numeric" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Пароль" htmlFor="del-pw">
              <Input id="del-pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p className="text-sm text-danger">{error.message}</p>}
            <Button type="submit" variant="danger" loading={busy}>
              Удалить навсегда
            </Button>
          </form>
        )}
      </Modal>
    </Card>
  );
}
