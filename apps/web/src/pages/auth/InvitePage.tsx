import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../api/client.js';
import { Button } from '../../components/ui/index.js';

export function InvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      const h = await api<{ id: string }>(`/invitations/${token}/accept`, { method: 'POST' });
      localStorage.setItem('hp-household', h.id);
      await qc.invalidateQueries();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center">
        <h1 className="text-xl font-semibold">Приглашение в семейный план</h1>
        <p className="mt-2 text-sm text-ink-2">Вы будете видеть и редактировать общий план покупки жилья вместе с тем, кто вас пригласил.</p>
        {error && <p className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error.message}</p>}
        <Button className="mt-5 w-full" onClick={accept} loading={busy}>
          Присоединиться
        </Button>
      </div>
    </div>
  );
}
