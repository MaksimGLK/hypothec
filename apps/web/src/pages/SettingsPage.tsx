import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useHh, useHhMutation } from '../api/household.js';
import type { SettingsDto } from '../api/types.js';
import { Term } from '../components/learning.js';
import { ModeSwitch } from '../layout/AppLayout.js';
import { Button, Card, Field, Input, MoneyInput, PageHeader, Segmented, Spinner, Switch } from '../components/ui/index.js';
import { useToast } from '../components/ui/toast.js';

type Theme = 'light' | 'dark' | 'system';

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem('hp-theme', theme);
  } catch {
    /* без сохранения */
  }
}

function readTheme(): Theme {
  try {
    return (localStorage.getItem('hp-theme') as Theme) ?? 'system';
  } catch {
    return 'system';
  }
}

export default function SettingsPage() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <div>
      <PageHeader title="Настройки" />
      <Card title="Оформление">
        <Segmented
          label="Тема"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: <span className="inline-flex items-center gap-1.5"><Sun className="size-4" aria-hidden />Светлая</span> },
            { value: 'dark', label: <span className="inline-flex items-center gap-1.5"><Moon className="size-4" aria-hidden />Тёмная</span> },
            { value: 'system', label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-4" aria-hidden />Как в системе</span> },
          ]}
        />
      </Card>
      <Card className="mt-4" title="Режим">
        <div className="-mx-3">
          <ModeSwitch />
        </div>
      </Card>
      <Reminders />
      <PlanSettings />
    </div>
  );
}

interface Pref {
  email: boolean;
  push: boolean;
  daysBefore: number;
}

function Reminders() {
  const qc = useQueryClient();
  const toast = useToast();
  const prefs = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api<{ prefs: Record<string, Pref>; labels: Record<string, string> }>('/me/notification-preferences') });
  const save = useMutation({
    mutationFn: (p: Record<string, Pref>) => api('/me/notification-preferences', { method: 'PUT', body: { prefs: p } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notification-prefs'] });
      toast.show('Напоминания сохранены');
    },
  });
  if (!prefs.data) return <Spinner />;
  const p = prefs.data.prefs;
  const update = (k: string, patch: Partial<Pref>) => save.mutate({ ...p, [k]: { ...p[k]!, ...patch } });
  return (
    <Card className="mt-4" title="Напоминания на почту">
      <div id="reminders" />
      <ul className="divide-y divide-border">
        {Object.entries(prefs.data.labels).map(([k, label]) => (
          <li key={k} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-48 flex-1">
              <Switch checked={p[k]!.email} onChange={(v) => update(k, { email: v })} label={label} />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              за
              <Input type="number" min={0} max={60} className="h-9 w-16" value={p[k]!.daysBefore} disabled={!p[k]!.email} onChange={(e) => update(k, { daysBefore: Number(e.target.value) })} aria-label={`${label}: за сколько дней`} />
              дн.
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Письма приходят утром по московскому времени, все напоминания дня — одним письмом. Push-уведомления появятся в мобильном приложении.</p>
    </Card>
  );
}

function PlanSettings() {
  const settings = useHh<SettingsDto>('/settings');
  const save = useHhMutation<Record<string, unknown>>('PATCH', '/settings', { success: 'Сохранено, план пересчитан' });
  const [v, setV] = useState<SettingsDto | null>(null);
  useEffect(() => {
    if (settings.data) setV(settings.data);
  }, [settings.data]);
  if (!v) return null;
  return (
    <Card className="mt-4" title="Для советов">
      <p className="mb-4 text-sm text-ink-2">Эти цифры нужны, чтобы сравнить досрочку со вкладом и понять, есть ли смысл в рефинансировании. Укажите то, что видите сами, — сервис не подбирает банки и вклады.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ставка по вкладу, %" htmlFor="dep" hint="Которую вы реально можете получить">
          <Input id="dep" inputMode="decimal" value={v.depositRatePercent ?? ''} onChange={(e) => setV({ ...v, depositRatePercent: e.target.value.replace(',', '.') || null })} />
        </Field>
        <Field label={<><Term k="refinancing">Рыночная ставка</Term> по ипотеке, %</>} htmlFor="mkt">
          <Input id="mkt" inputMode="decimal" value={v.marketRatePercent ?? ''} onChange={(e) => setV({ ...v, marketRatePercent: e.target.value.replace(',', '.') || null })} />
        </Field>
        <Field label="Расходы на рефинансирование" htmlFor="refi" hint="Оценка, страховка, регистрация">
          <MoneyInput id="refi" value={v.refinanceCostsKop ?? null} onChange={(k) => setV({ ...v, refinanceCostsKop: k })} />
        </Field>
        <Field label={<>Порог <Term k="dti">нагрузки</Term>, % дохода</>} htmlFor="dti">
          <Input id="dti" type="number" min={10} max={90} value={v.dtiWarnPercent ?? 45} onChange={(e) => setV({ ...v, dtiWarnPercent: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          loading={save.isPending}
          onClick={() =>
            save.mutate({
              depositRatePercent: v.depositRatePercent ?? null,
              marketRatePercent: v.marketRatePercent ?? null,
              refinanceCostsKop: v.refinanceCostsKop ?? null,
              dtiWarnPercent: v.dtiWarnPercent,
              version: settings.data!.version,
            })
          }
        >
          Сохранить
        </Button>
      </div>
    </Card>
  );
}
