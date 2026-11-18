import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client.js';
import { useHh, useHhMutation, useHousehold } from '../api/household.js';
import type { LoanDto, MemberDto, PrepaymentScenarioDto, ScenarioDto, TaxMemberDto, TaxResult } from '../api/types.js';
import { LessonsFor, Term } from '../components/learning.js';
import { Badge, Button, Card, DateInput, DateText, ErrorBox, Field, Input, Money, MoneyInput, PageHeader, Select, Spinner, Switch } from '../components/ui/index.js';
import { useToast } from '../components/ui/toast.js';

export default function TaxPage() {
  const { hid } = useHousehold();
  const navigate = useNavigate();
  const toast = useToast();
  const members = useHh<MemberDto[]>('/members');
  const tax = useHh<{ members: TaxMemberDto[]; version: number }>('/tax-members');
  const result = useHh<TaxResult>('/tax-deductions');
  const scenario = useHh<ScenarioDto>('/scenario');
  const loans = useHh<LoanDto[]>('/loans');
  const scenarios = useHh<PrepaymentScenarioDto[]>('/prepayment-scenarios');
  const save = useHhMutation<{ members: TaxMemberDto[]; version: number }>('PUT', '/tax-members', { success: 'Сохранено, вычет пересчитан' });
  const saveScenario = useHhMutation<Record<string, unknown>>('PATCH', '/scenario');
  const [busy, setBusy] = useState(false);
  if (members.isLoading || tax.isLoading) return <Spinner />;
  if (members.error || tax.error) return <ErrorBox error={members.error ?? tax.error} />;
  const stored = tax.data!.members;
  const rows: TaxMemberDto[] = members.data!.map(
    (m) =>
      stored.find((t) => t.memberId === m.id) ?? {
        memberId: m.id,
        name: m.displayName ?? m.name,
        annualTaxableIncomeKop: 0,
        ndflRatePercent: '13',
        propertyDeductionUsedKop: 0,
        interestDeductionUsed: false,
        costSharePercent: String(Math.round(100 / members.data!.length)),
        interestSharePercent: String(Math.round(100 / members.data!.length)),
        claimed: false,
      },
  );
  const r = result.data;

  const toPrepayment = async () => {
    const loan = loans.data?.[0];
    const active = scenarios.data?.find((s) => s.isActive);
    if (!loan) return;
    setBusy(true);
    try {
      const sc = await api<PrepaymentScenarioDto>(`/households/${hid}/prepayment-scenarios`, { method: 'POST', body: { name: 'Вычеты в досрочку', ...(active ? { copyFromId: active.id } : {}) } });
      await api(`/households/${hid}/prepayment-scenarios/from-tax`, { method: 'POST', body: { scenarioId: sc.id, loanId: loan.id } });
      navigate(`/loan/prepayment?scenario=${sc.id}`);
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Налоговый вычет" subtitle="Сколько налога можно вернуть с покупки и с процентов — на каждого из супругов." />
      <div className="mb-4">
        <LessonsFor screen="tax" />
      </div>
      {r && (
        <Card className="mb-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted">С покупки</div>
              <Money kop={r.totalPropertyRefundKop} className="text-xl font-semibold" />
            </div>
            <div>
              <div className="text-xs text-muted">С процентов за весь срок</div>
              <Money kop={r.totalInterestRefundKop} className="text-xl font-semibold" />
            </div>
            <div>
              <div className="text-xs text-muted">Ещё не заявлено</div>
              <Money kop={r.unclaimedKop} className="text-xl font-semibold text-ok" />
            </div>
          </div>
          {r.years.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-medium">По годам</h3>
              <ul className="space-y-1 text-sm">
                {Object.entries(
                  r.years.reduce<Record<number, number>>((acc, y) => ({ ...acc, [y.taxYear]: (acc[y.taxYear] ?? 0) + y.propertyRefundKop + y.interestRefundKop }), {}),
                )
                  .slice(0, 6)
                  .map(([year, amount]) => (
                    <li key={year} className="flex justify-between">
                      <span>
                        За {year} год — декларация в {Number(year) + 1}
                      </span>
                      <Money kop={amount} />
                    </li>
                  ))}
              </ul>
              <Button className="mt-4" size="sm" onClick={toPrepayment} loading={busy}>
                Посчитать вычеты в досрочку
              </Button>
            </>
          )}
          {r.years.length === 0 && <p className="mt-3 text-sm text-ink-2">Заполните доходы супругов ниже — и мы посчитаем.</p>}
        </Card>
      )}

      <Card className="mb-4" title="Когда появляется право на вычет">
        <p className="mb-3 text-sm text-ink-2">После регистрации собственности; для новостройки — после акта приёма-передачи. Если не указать, берём дату ключей.</p>
        <div className="max-w-xs">
          <Field label="Дата" htmlFor="right-date" hint={scenario.data?.keysDate ? <>Дата ключей: <DateText date={scenario.data.keysDate} /></> : undefined}>
            <DateInput id="right-date" value={scenario.data?.rightDate ?? ''} onChange={(e) => scenario.data && saveScenario.mutate({ rightDate: e.target.value || null, version: scenario.data.version })} />
          </Field>
        </div>
      </Card>

      <div className="space-y-4">
        {rows.map((m, i) => (
          <MemberCard key={m.memberId} value={m} onSave={(next) => save.mutate({ members: rows.map((x, j) => (j === i ? next : x)), version: tax.data!.version })} saving={save.isPending} />
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">
        Лимиты: вычет с покупки — до 2 млн ₽ расходов на человека (возврат до 260 000 ₽ при ставке 13%), с процентов — до 3 млн ₽ (до 390 000 ₽) и только по одному объекту. За год возвращают не больше уплаченного НДФЛ. Источник — ФНС России.
      </p>
    </div>
  );
}

function MemberCard({ value, onSave, saving }: { value: TaxMemberDto; onSave(v: TaxMemberDto): void; saving: boolean }) {
  const [v, setV] = useState(value);
  const set = <K extends keyof TaxMemberDto>(k: K, val: TaxMemberDto[K]) => setV((x) => ({ ...x, [k]: val }));
  return (
    <Card title={v.name} action={v.claimed ? <Badge tone="ok">вычет заявлен</Badge> : undefined}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Доход за год до вычета налога" htmlFor={`ti-${v.memberId}`} hint="Сумма из справки о доходах (2-НДФЛ)">
          <MoneyInput id={`ti-${v.memberId}`} value={v.annualTaxableIncomeKop || null} onChange={(k) => set('annualTaxableIncomeKop', k ?? 0)} />
        </Field>
        <Field label="Ставка НДФЛ" htmlFor={`nr-${v.memberId}`}>
          <Select id={`nr-${v.memberId}`} value={v.ndflRatePercent} onChange={(e) => set('ndflRatePercent', e.target.value)}>
            <option value="13">13%</option>
            <option value="15">15%</option>
          </Select>
        </Field>
        <Field label="Доля расходов на покупку, %" htmlFor={`cs-${v.memberId}`} hint="Супруги делят расходы между собой как выгоднее">
          <Input id={`cs-${v.memberId}`} type="number" min={0} max={100} value={v.costSharePercent} onChange={(e) => set('costSharePercent', e.target.value)} />
        </Field>
        <Field label="Доля процентов, %" htmlFor={`is-${v.memberId}`}>
          <Input id={`is-${v.memberId}`} type="number" min={0} max={100} value={v.interestSharePercent} onChange={(e) => set('interestSharePercent', e.target.value)} />
        </Field>
        <Field label="Уже использовано раньше (база)" htmlFor={`pu-${v.memberId}`} hint="Если вычет с покупки уже получали по другой квартире">
          <MoneyInput id={`pu-${v.memberId}`} value={v.propertyDeductionUsedKop || null} onChange={(k) => set('propertyDeductionUsedKop', k ?? 0)} />
        </Field>
      </div>
      <div className="mt-3 space-y-1">
        <Switch checked={v.interestDeductionUsed} onChange={(c) => set('interestDeductionUsed', c)} label={<>Вычет <Term k="tax_deduction">с процентов</Term> уже получал по другой квартире</>} />
        <Switch checked={v.claimed} onChange={(c) => set('claimed', c)} label="Вычет по этой квартире уже заявлен" />
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" type="button" loading={saving} onClick={() => onSave({ ...v, costSharePercent: String(v.costSharePercent), interestSharePercent: String(v.interestSharePercent) })}>
          Сохранить
        </Button>
      </div>
    </Card>
  );
}
