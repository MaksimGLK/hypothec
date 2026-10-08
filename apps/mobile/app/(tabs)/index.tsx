import { formatDateRu, formatRub } from '@hypothec/core';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useHh } from '../../src/household';
import { useTheme } from '../../src/theme';
import type { DashboardDto } from '../../src/types';
import { Big, Body, Card, Disclaimer, Label } from '../../src/ui';

const rub = (kop: number) => formatRub(kop, { kopecks: 'never' });

export default function Dashboard() {
  const t = useTheme();
  const { data: d, isLoading, refetch, isRefetching, error } = useHh<DashboardDto>('/dashboard');
  if (isLoading) return <ActivityIndicator style={{ marginTop: 40 }} color={t.primary} />;
  if (error || !d) return <Body>{(error as Error | null)?.message ?? 'План пока не заполнен — пройдите мастер на сайте.'}</Body>;
  const np = d.nextPayment;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}>
      <Label>{formatDateRu(d.today)}</Label>
      <Card title="Следующий платёж">
        {np ? (
          <>
            <Big>{rub(np.amountKop)}</Big>
            <Body muted>{formatDateRu(np.date)}</Body>
            <Body>{np.readyNow ? 'На ипотечном счёте уже есть нужная сумма.' : np.ready ? 'Если сделать запланированные переводы, к дате платежа будет достаточно.' : `К дате платежа может не хватить ${rub(np.shortfallKop)}.`}</Body>
          </>
        ) : (
          <Body muted>Платежей пока нет.</Body>
        )}
      </Card>
      <Card title="Подушка безопасности">
        <Big>
          {Number.isFinite(d.cushion.monthsCovered) ? String(d.cushion.monthsCovered).replace('.', ',') : '—'}
          <Text style={{ fontSize: 16, color: t.ink2 }}> из {d.cushion.targetMonths} мес.</Text>
        </Big>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: t.border, overflow: 'hidden' }}>
          <View style={{ width: `${Math.round(d.cushion.progress * 100)}%`, height: 8, backgroundColor: t.primary }} />
        </View>
        <Body muted>
          {rub(d.cushion.currentKop)} из {rub(d.cushion.targetKop)}
        </Body>
      </Card>
      {d.payoff && (
        <Card title="Когда закроется кредит">
          <Big>{formatDateRu(d.payoff.date)}</Big>
          {d.payoff.savingsKop > 0 && <Body>Экономия от досрочки — {rub(d.payoff.savingsKop)}</Body>}
        </Card>
      )}
      {d.recommendations.slice(0, 2).map((r) => (
        <Card key={r.ruleKey} title={r.title}>
          <Body muted>{r.text}</Body>
        </Card>
      ))}
      <Disclaimer />
    </ScrollView>
  );
}
