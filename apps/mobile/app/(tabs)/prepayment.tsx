import { addMonths, compareModes, formatRub, type LoanInput, type PrepaymentInput, rub } from '@hypothec/core';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView } from 'react-native';
import { useHh } from '../../src/household';
import { useTheme } from '../../src/theme';
import type { LoanDto, PrepaymentScenarioDto } from '../../src/types';
import { Big, Body, Card, Disclaimer, Field, Label } from '../../src/ui';

/**
 * Досрочка считается на телефоне тем же ядром @hypothec/core, что на сервере и в вебе, — мгновенно и без сети.
 */
export default function Prepayment() {
  const t = useTheme();
  const loans = useHh<LoanDto[]>('/loans');
  const scenarios = useHh<PrepaymentScenarioDto[]>('/prepayment-scenarios');
  const [amountText, setAmountText] = useState('500000');
  const loan = loans.data?.[0];
  const existing = (scenarios.data?.find((s) => s.isActive)?.prepayments ?? []) as PrepaymentInput[];

  const result = useMemo(() => {
    const amount = Number(amountText.replace(/\D/g, ''));
    if (!loan || !amount) return null;
    const input = { ...loan, rateChanges: loan.rateChanges ?? [] } as LoanInput;
    const today = new Date().toISOString().slice(0, 10);
    const date = addMonths(today > loan.issueDate ? today : loan.issueDate, 1);
    const p: PrepaymentInput = { id: 'mobile', loanId: loan.id, kind: 'one_off', amountKop: rub(amount), date, mode: 'reduce_term' };
    return { base: compareModes(input, existing), next: compareModes(input, [...existing, p]) };
  }, [loan, existing, amountText]);

  if (loans.isLoading) return <ActivityIndicator style={{ marginTop: 40 }} color={t.primary} />;
  if (!loan) return <Body>Добавьте кредит на сайте — расчёт появится здесь.</Body>;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Field label="Разовая досрочка, ₽" keyboardType="number-pad" value={amountText} onChangeText={setAmountText} />
      {result &&
        (
          [
            ['Сократить срок', result.next.reduceTerm, result.base.reduceTerm],
            ['Уменьшить платёж', result.next.reducePayment, result.base.reducePayment],
            ['Уменьшить платёж, платить прежнюю сумму', result.next.reducePaymentKeepAmount, result.base.reducePaymentKeepAmount],
          ] as const
        ).map(([title, r, b]) => (
          <Card key={title} title={title}>
            <Label>меньше переплата</Label>
            <Big color={t.ok}>{formatRub(r.savingsKop - b.savingsKop, { kopecks: 'never' })}</Big>
            <Body muted>
              {r.monthsSaved - b.monthsSaved > 0 ? `Закроется на ${r.monthsSaved - b.monthsSaved} мес. раньше` : 'Срок прежний'} · платёж после: {formatRub(r.paymentAfterFirstPrepaymentKop, { kopecks: 'never' })}
            </Body>
          </Card>
        ))}
      <Disclaimer />
    </ScrollView>
  );
}
