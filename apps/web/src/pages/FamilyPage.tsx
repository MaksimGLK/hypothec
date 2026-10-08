import { useState } from 'react';
import { useAuth } from '../api/auth.js';
import { useHh, useHhMutation, useHousehold } from '../api/household.js';
import type { InvitationDto, MemberDto } from '../api/types.js';
import { Badge, Button, Card, ConfirmButton, DateText, ErrorBox, Field, Input, PageHeader, Spinner } from '../components/ui/index.js';

export default function FamilyPage() {
  const { user } = useAuth();
  const { current } = useHousehold();
  const members = useHh<MemberDto[]>('/members');
  const invitations = useHh<InvitationDto[]>('/invitations');
  const [email, setEmail] = useState('');
  const [name, setName] = useState(current?.name ?? '');
  const invite = useHhMutation<{ email: string }>('POST', '/invitations', { success: 'Приглашение отправлено на почту' });
  const rename = useHhMutation<{ name: string }>('PATCH', '', { success: 'Сохранено' });
  const isOwner = current?.role === 'owner';
  if (members.isLoading) return <Spinner />;
  if (members.error) return <ErrorBox error={members.error} />;
  return (
    <div>
      <PageHeader title="Семья" subtitle="Пригласите супруга или супругу — вы будете видеть и вести один план." />
      <Card title="Участники">
        <ul className="divide-y divide-border">
          {members.data!.map((m) => (
            <MemberRow key={m.id} member={m} me={m.userId === user?.id} canManage={isOwner} />
          ))}
        </ul>
      </Card>

      {isOwner && (
        <Card className="mt-4" title="Пригласить">
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate({ email }, { onSuccess: () => setEmail('') });
            }}
          >
            <div className="flex-1">
              <Field label="Почта" htmlFor="inv-email" hint="Пришлём ссылку. Приглашение действует 7 дней.">
                <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" loading={invite.isPending} className="sm:mb-6">
              Пригласить
            </Button>
          </form>
          {(invitations.data ?? []).filter((i) => i.status === 'pending').length > 0 && (
            <ul className="mt-3 divide-y divide-border text-sm">
              {invitations.data!.filter((i) => i.status === 'pending').map((i) => (
                <Invite key={i.id} inv={i} />
              ))}
            </ul>
          )}
        </Card>
      )}

      {isOwner && (
        <Card className="mt-4" title="Название плана">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate({ name });
            }}
          >
            <Input aria-label="Название" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="secondary" loading={rename.isPending}>
              Сохранить
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function MemberRow({ member, me, canManage }: { member: MemberDto; me: boolean; canManage: boolean }) {
  const role = useHhMutation<{ role: 'owner' | 'member' }>('PATCH', `/members/${member.id}`, { success: 'Права изменены' });
  const remove = useHhMutation('DELETE', `/members/${member.id}`, { success: me ? 'Вы вышли из семьи' : 'Участник исключён' });
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {member.displayName ?? member.name} {me && <span className="text-sm text-muted">(вы)</span>}
        </p>
        <p className="text-sm text-ink-2">{member.email}</p>
      </div>
      <Badge tone={member.role === 'owner' ? 'primary' : 'neutral'}>{member.role === 'owner' ? 'владелец' : 'участник'}</Badge>
      {canManage && !me && member.role === 'member' && (
        <Button size="sm" variant="ghost" onClick={() => role.mutate({ role: 'owner' })}>
          Сделать владельцем
        </Button>
      )}
      {(me || canManage) && (
        <ConfirmButton
          confirm={me ? 'Выйти из семьи? Вы потеряете доступ к общему плану.' : `Исключить ${member.name}? Доступ к плану пропадёт, данные плана останутся.`}
          onConfirm={() => remove.mutate(undefined, { onSuccess: () => me && window.location.assign('/') })}
        >
          {me ? 'Выйти' : 'Исключить'}
        </ConfirmButton>
      )}
    </li>
  );
}

function Invite({ inv }: { inv: InvitationDto }) {
  const revoke = useHhMutation('DELETE', `/invitations/${inv.id}`, { success: 'Приглашение отозвано' });
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <span>
        {inv.email} · до <DateText date={inv.expiresAt.slice(0, 10)} />
      </span>
      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(undefined)}>
        Отозвать
      </Button>
    </li>
  );
}
