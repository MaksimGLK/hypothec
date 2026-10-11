import { formatDateRu } from '@hypothec/core';
import { useState } from 'react';
import { useHh, useHhMutation } from '../api/household.js';
import { Button, Card, Money, MoneyInput } from './ui/index.js';

interface Pending {
  id: string;
  date: string;
  amountKop: number;
  planKop: number;
}

/**
 * Дата досрочки наступила — сумму уже списали со счёта «Досрочка». Просим подтвердить или поправить по факту.
 */
export function PendingPrepayments() {
  const { data } = useHh<Pending[]>('/prepayments/pending');
  if (!data?.length) return null;
  return (
    <div className="space-y-3">
      {data.map((p) => (
        <PendingCard key={p.id} p={p} />
      ))}
    </div>
  );
}

function PendingCard({ p }: { p: Pending }) {
  const confirm = useHhMutation<{ action: string; amountKop?: number }>('POST', `/prepayments/${p.id}/confirm`, { success: 'Сохранено — график и остаток пересчитаны' });
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState<number | null>(p.amountKop);
  return (
    <Card tone="info" title={`Досрочка ${formatDateRu(p.date, { year: false })} — внесли?`}>
      <p className="text-sm">
        По плану в этот день досрочный платёж <Money kop={p.amountKop} className="font-medium" />. Эту сумму уже списали со счёта «Досрочка».
      </p>
      {editing ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (amount) confirm.mutate({ action: 'amount', amountKop: amount });
          }}
        >
          <div className="w-40">
            <MoneyInput aria-label="Сколько принял банк" autoFocus value={amount} onChange={setAmount} />
          </div>
          <Button type="submit" size="sm" loading={confirm.isPending} disabled={!amount}>
            Сохранить
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Отмена
          </Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => confirm.mutate({ action: 'confirm' })} loading={confirm.isPending}>
            Да, внёс
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Сумма другая
          </Button>
          <Button size="sm" variant="secondary" onClick={() => confirm.mutate({ action: 'skip' })}>
            Не вносил
          </Button>
          <Button size="sm" variant="ghost" onClick={() => confirm.mutate({ action: 'restore' })}>
            Внёс, остаток счёта уже поправил сам
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">«Не вносил» — деньги вернутся на счёт «Досрочка», и досрочка уйдёт из расчёта кредита. Её можно добавить заново на другую дату.</p>
    </Card>
  );
}
