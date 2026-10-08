import { useState } from 'react';
import { useAuth } from '../../api/auth.js';
import { api, ApiError } from '../../api/client.js';
import { Button, Input } from '../../components/ui/index.js';
import { useToast } from '../../components/ui/toast.js';

/** Пока почта не подтверждена, напоминания не приходят — просим ввести код. */
export function VerifyEmailBanner() {
  const { user, reloadUser } = useAuth();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user || user.emailVerified) return null;
  const verify = async () => {
    setBusy(true);
    try {
      await api('/auth/verify-email', { method: 'POST', body: { code } });
      await reloadUser();
      toast.show('Почта подтверждена');
    } catch (err) {
      toast.show((err as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-b border-border bg-warn-soft px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 text-sm">
        <p className="flex-1">Подтвердите почту {user.email} — без этого не придут напоминания о платежах. Код в письме.</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <Input aria-label="Код из письма" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-9 w-28" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <Button size="sm" type="submit" loading={busy} disabled={code.length !== 6}>
            Подтвердить
          </Button>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => api('/auth/verify-email/resend', { method: 'POST' }).then(() => toast.show('Отправили новый код'), (e: ApiError) => toast.show(e.message, 'error'))}
          >
            Новый код
          </Button>
        </form>
      </div>
    </div>
  );
}
