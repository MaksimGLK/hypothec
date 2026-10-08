import { CheckCircle2, ChevronDown, Circle, Clock3, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useHh, useHhMutation } from '../api/household.js';
import type { ExpenseDto, StageDto } from '../api/types.js';
import { LessonButton, LessonsFor } from '../components/learning.js';
import { Badge, Button, Card, ConfirmButton, cx, DateText, Empty, ErrorBox, Field, Input, Modal, Money, PageHeader, Select, Spinner } from '../components/ui/index.js';

const STATUS: Record<StageDto['status'], { label: string; tone: 'neutral' | 'primary' | 'ok' | 'warn' }> = {
  todo: { label: 'Впереди', tone: 'neutral' },
  in_progress: { label: 'В работе', tone: 'primary' },
  done: { label: 'Готово', tone: 'ok' },
  skipped: { label: 'Не нужно', tone: 'neutral' },
};

export default function StagesPage() {
  const stages = useHh<StageDto[]>('/stages');
  const expenses = useHh<ExpenseDto[]>('/expenses');
  const [adding, setAdding] = useState(false);
  if (stages.isLoading) return <Spinner />;
  if (stages.error) return <ErrorBox error={stages.error} onRetry={() => void stages.refetch()} />;
  const list = stages.data ?? [];
  const done = list.filter((s) => s.status === 'done' || s.status === 'skipped').length;

  return (
    <div>
      <PageHeader
        title="Этапы сделки"
        subtitle={`Пройдено ${done} из ${list.length}. Плановые даты — ориентир, их можно двигать.`}
        action={
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden /> Свой этап
          </Button>
        }
      />
      <div className="mb-4">
        <LessonsFor screen="stages" />
      </div>
      {list.length === 0 ? (
        <Empty title="Этапов пока нет">Пройдите мастер — он соберёт этапы под ваш сценарий покупки.</Empty>
      ) : (
        <ol className="space-y-2">
          {list.map((s, i) => (
            <StageItem key={s.id} stage={s} index={i + 1} expenses={(expenses.data ?? []).filter((e) => e.stageId === s.id)} />
          ))}
        </ol>
      )}
      <AddStage open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function StageItem({ stage, index, expenses }: { stage: StageDto; index: number; expenses: ExpenseDto[] }) {
  const [open, setOpen] = useState(stage.status === 'in_progress');
  const update = useHhMutation<Partial<StageDto> & { version: number }>('PATCH', `/stages/${stage.id}`);
  const remove = useHhMutation('DELETE', `/stages/${stage.id}`, { success: 'Этап удалён' });
  const addDoc = useHhMutation<{ title: string }>('POST', `/stages/${stage.id}/documents`);
  const toggleDoc = useHhMutation<{ _id: string; isReady: boolean }>('PATCH', (b) => `/stages/${stage.id}/documents/${b._id}`);
  const removeDoc = useHhMutation<{ _id: string }>('DELETE', (b) => `/stages/${stage.id}/documents/${b._id}`);
  const [docTitle, setDocTitle] = useState('');
  const isDone = stage.status === 'done';
  const readyDocs = stage.documents.filter((d) => d.isReady).length;
  const plan = expenses.reduce((s, e) => s + e.planKop, 0);
  const fact = expenses.reduce((s, e) => s + (e.factKop ?? 0), 0);

  const toggleDone = () =>
    update.mutate({ status: isDone ? 'todo' : 'done', actualDate: isDone ? null : new Date().toISOString().slice(0, 10), version: stage.version });

  return (
    <li className={cx('rounded-2xl border bg-surface', stage.status === 'in_progress' ? 'border-primary' : 'border-border', stage.status === 'skipped' && 'opacity-60')}>
      <div className="flex items-center gap-3 p-3 sm:p-4">
        <button type="button" onClick={toggleDone} aria-label={isDone ? 'Отметить невыполненным' : 'Отметить выполненным'} className="shrink-0">
          {isDone ? <CheckCircle2 className="size-6 text-ok" /> : stage.status === 'in_progress' ? <Clock3 className="size-6 text-primary" /> : <Circle className="size-6 text-muted" />}
        </button>
        <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="min-w-0">
            <span className={cx('block font-medium', isDone && 'text-ink-2 line-through')}>
              {index}. {stage.title}
            </span>
            <span className="mt-0.5 block text-xs text-muted">
              {isDone ? (
                <>
                  выполнено <DateText date={stage.actualDate} />
                </>
              ) : (
                <>
                  план: <DateText date={stage.plannedDate} />
                </>
              )}
              {stage.documents.length > 0 && ` · документы ${readyDocs}/${stage.documents.length}`}
              {plan > 0 && <> · расходы <Money kop={plan} /></>}
            </span>
          </span>
          <ChevronDown className={cx('size-5 shrink-0 text-muted transition', open && 'rotate-180')} aria-hidden />
        </button>
      </div>
      {open && (
        <div className="space-y-4 border-t border-border p-4">
          {stage.hint && <p className="text-sm leading-relaxed text-ink-2">{stage.hint}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Статус" htmlFor={`st-${stage.id}`}>
              <Select id={`st-${stage.id}`} value={stage.status} onChange={(e) => update.mutate({ status: e.target.value as StageDto['status'], version: stage.version })}>
                {Object.entries(STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Плановая дата" htmlFor={`pd-${stage.id}`}>
              <Input id={`pd-${stage.id}`} type="date" value={stage.plannedDate ?? ''} onChange={(e) => update.mutate({ plannedDate: e.target.value || null, version: stage.version })} />
            </Field>
            <Field label="Фактическая дата" htmlFor={`ad-${stage.id}`}>
              <Input id={`ad-${stage.id}`} type="date" value={stage.actualDate ?? ''} onChange={(e) => update.mutate({ actualDate: e.target.value || null, version: stage.version })} />
            </Field>
          </div>
          {stage.templateKey === 'move_in' && <p className="text-xs text-muted">Дата этого этапа — дата ключей: от неё зависят расходы на обустройство, окончание аренды и право на вычет.</p>}

          <div>
            <h3 className="mb-2 text-sm font-medium">Документы</h3>
            <ul className="space-y-1">
              {stage.documents.map((d) => (
                <li key={d.id} className="group flex items-center gap-2">
                  <label className="flex flex-1 items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={d.isReady} onChange={(e) => toggleDoc.mutate({ _id: d.id, isReady: e.target.checked })} />
                    <span className={cx(d.isReady && 'text-ink-2 line-through')}>{d.title}</span>
                  </label>
                  <button type="button" onClick={() => removeDoc.mutate({ _id: d.id })} className="rounded p-1 text-muted opacity-60 hover:opacity-100" aria-label={`Удалить: ${d.title}`}>
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (docTitle.trim()) addDoc.mutate({ title: docTitle.trim() }, { onSuccess: () => setDocTitle('') });
              }}
            >
              <Input aria-label="Новый документ" placeholder="Добавить документ" className="h-9" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
              <Button size="sm" variant="secondary" type="submit" disabled={!docTitle.trim()}>
                Добавить
              </Button>
            </form>
          </div>

          {expenses.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Расходы этапа</h3>
              <ul className="space-y-1 text-sm">
                {expenses.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span>
                      {e.name} {e.recurrence === 'yearly' && <Badge>ежегодно</Badge>}
                    </span>
                    <span className="text-ink-2">
                      {e.factKop != null ? <Money kop={e.factKop} /> : e.percentOfLoanBalance ? `${e.percentOfLoanBalance.replace('.', ',')}% от долга` : <Money kop={e.planKop} />}
                    </span>
                  </li>
                ))}
              </ul>
              {fact > 0 && (
                <p className="mt-1 text-xs text-muted">
                  Потрачено <Money kop={fact} /> из плана <Money kop={plan} />
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {stage.lessonKey ? <LessonButton lessonKey={stage.lessonKey}>Что важно на этом этапе</LessonButton> : <span />}
            <ConfirmButton confirm={`Удалить этап «${stage.title}»? Привязанные расходы останутся.`} onConfirm={() => remove.mutate(undefined)}>
              <Trash2 className="size-4" aria-hidden /> Удалить этап
            </ConfirmButton>
          </div>
        </div>
      )}
    </li>
  );
}

function AddStage({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const create = useHhMutation<{ title: string; plannedDate: string | null }>('POST', '/stages', { success: 'Этап добавлен' });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Свой этап">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { title, plannedDate: date || null },
            {
              onSuccess: () => {
                setTitle('');
                setDate('');
                onOpenChange(false);
              },
            },
          );
        }}
      >
        <Field label="Название" htmlFor="new-stage">
          <Input id="new-stage" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, согласовать перепланировку" />
        </Field>
        <Field label="Плановая дата" htmlFor="new-stage-date">
          <Input id="new-stage-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Card tone="info">
          <p className="text-sm">Свои этапы не удаляются при повторном прохождении мастера.</p>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" loading={create.isPending}>
            Добавить
          </Button>
        </div>
      </form>
    </Modal>
  );
}
