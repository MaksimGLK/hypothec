import { type BudgetMonth, formatRub, type SpendingDraft } from '@hypothec/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { api } from '../../src/api/client';
import { useHh, useHouseholdId } from '../../src/household';
import { useTheme } from '../../src/theme';
import { Big, Body, Button, Card, Field, Label } from '../../src/ui';

const rub = (kop: number) => formatRub(kop, { kopecks: 'never' });

/** Траты на ходу: «пятёрочка 1 250» — и сумма ложится в категорию бюджета. */
export default function Budget() {
  const t = useTheme();
  const qc = useQueryClient();
  const hid = useHouseholdId();
  const month = new Date().toISOString().slice(0, 7);
  const summary = useHh<BudgetMonth>(`/budget/summary?month=${month}`);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async (line: string) => {
      const d = await api<SpendingDraft>(`/households/${hid}/budget/parse`, { method: 'POST', body: { text: line } });
      if (!d.amountKop) throw new Error('Не нашли сумму — напишите, например, «продукты 1 250»');
      await api(`/households/${hid}/budget/spendings`, {
        method: 'POST',
        body: { categoryId: d.categoryId, amountKop: d.amountKop, date: new Date().toISOString().slice(0, 10), note: d.note || null },
      });
      return d;
    },
    onSuccess: async (d) => {
      const name = summary.data?.categories.find((c) => c.categoryId === d.categoryId)?.name ?? 'без категории';
      setMessage(`${rub(d.amountKop!)} → ${name}`);
      setText('');
      await qc.invalidateQueries({ queryKey: ['h', hid] });
    },
    onError: (e) => setMessage((e as Error).message),
  });

  if (summary.isLoading) return <ActivityIndicator style={{ marginTop: 40 }} color={t.primary} />;
  const s = summary.data;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Card title="Добавить трату">
        <Field label="Трата одной строкой" placeholder="пятёрочка 1 250" value={text} onChangeText={setText} returnKeyType="done" onSubmitEditing={() => text.trim() && add.mutate(text)} />
        <Button title="Добавить" onPress={() => text.trim() && add.mutate(text)} loading={add.isPending} />
        {message && <Body muted>{message}</Body>}
      </Card>
      {s && (
        <Card title="Этот месяц">
          <Label>Потрачено из плана</Label>
          <Big color={s.leftKop < 0 ? t.danger : t.ink}>
            {rub(s.factKop)} <Text style={{ fontSize: 16, color: t.ink2 }}>из {rub(s.planKop)}</Text>
          </Big>
          {s.dailyAllowanceKop !== null && s.leftKop > 0 && <Body muted>Можно тратить около {rub(s.dailyAllowanceKop)} в день до конца месяца.</Body>}
          <View style={{ gap: 10, marginTop: 8 }}>
            {s.categories.map((c) => (
              <View key={c.categoryId} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Body>{c.name}</Body>
                  <Text style={{ color: c.leftKop < 0 ? t.danger : t.ink2, fontVariant: ['tabular-nums'] }}>
                    {rub(c.factKop)} / {rub(c.planKop)}
                  </Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: t.border, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.min(100, c.planKop ? (c.factKop / c.planKop) * 100 : 0)}%`, height: 6, backgroundColor: c.leftKop < 0 ? t.danger : t.primary }} />
                </View>
              </View>
            ))}
          </View>
        </Card>
      )}
    </ScrollView>
  );
}
