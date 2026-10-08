import { useHh, useHhMutation } from '../api/household.js';
import type { Recommendation } from '../api/types.js';
import { RecommendationCard } from '../components/recommendation.js';
import { Button, Card, DateText, Empty, ErrorBox, PageHeader, Spinner } from '../components/ui/index.js';

export default function AdvicePage() {
  const recs = useHh<{ items: Recommendation[]; hidden: { ruleKey: string; status: string; until: string | null }[] }>('/recommendations');
  if (recs.isLoading) return <Spinner />;
  if (recs.error || !recs.data) return <ErrorBox error={recs.error} />;
  return (
    <div>
      <PageHeader title="Советы" subtitle="Подсказки на ваших цифрах: что и почему стоит сделать. Только факты и рубли — решение за вами." />
      {recs.data.items.length === 0 ? (
        <Empty title="Сейчас советов нет">План выглядит устойчиво. Советы появятся, если что-то изменится.</Empty>
      ) : (
        <div className="space-y-3">
          {recs.data.items.map((r) => (
            <RecommendationCard key={r.ruleKey} rec={r} />
          ))}
        </div>
      )}
      {recs.data.hidden.length > 0 && (
        <Card className="mt-6" title="Скрытые и отложенные">
          <ul className="divide-y divide-border">
            {recs.data.hidden.map((h) => (
              <Hidden key={h.ruleKey} item={h} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const TITLES: Record<string, string> = {
  cushion_low: 'Подушка меньше 3 месяцев',
  prepayment_before_cushion: 'Досрочка раньше подушки',
  high_debt_load: 'Высокая нагрузка',
  mortgage_from_unstable: 'Ипотека из нестабильных денег',
  reduce_payment_mode: 'Режим досрочки',
  early_prepayment: 'Ранняя досрочка',
  deposit_lower_than_loan: 'Досрочка выгоднее вклада',
  deposit_higher_than_loan: 'Вклад выгоднее досрочки',
  tax_deduction_unclaimed: 'Налоговый вычет',
  insurance_renewal: 'Продление страховки',
  refinance_check: 'Рефинансирование',
  credit_purchases: 'Покупки в кредит',
  seller_deposit_before_approval: 'Задаток до одобрения',
  annual_without_reserve: 'Резерв на ежегодные платежи',
  freed_money: 'Освободившиеся деньги',
};

function Hidden({ item }: { item: { ruleKey: string; status: string; until: string | null } }) {
  const restore = useHhMutation('DELETE', `/recommendations/${item.ruleKey}/state`, { success: 'Совет вернулся' });
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span>
        {TITLES[item.ruleKey] ?? item.ruleKey}
        <span className="ml-2 text-xs text-muted">{item.status === 'snoozed' && item.until ? <>отложен до <DateText date={item.until} /></> : 'скрыт'}</span>
      </span>
      <Button size="sm" variant="ghost" onClick={() => restore.mutate(undefined)}>
        Вернуть
      </Button>
    </li>
  );
}
