import * as Popover from '@radix-ui/react-popover';
import { formatDateRu } from '@hypothec/core';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Check, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { api } from '../api/client.js';
import { useHousehold } from '../api/household.js';
import type { GlossaryTerm, LessonDto, LessonListItem } from '../api/types.js';
import { Markdown } from './markdown.js';
import { Button, cx, ErrorBox, Modal, Spinner } from './ui/index.js';

export function useGlossary() {
  return useQuery({ queryKey: ['glossary'], queryFn: () => api<GlossaryTerm[]>('/content/glossary'), staleTime: 3_600_000 });
}

export function useLessons() {
  return useQuery({ queryKey: ['lessons'], queryFn: () => api<LessonListItem[]>('/content/lessons'), staleTime: 3_600_000 });
}

/** Термин с подсказкой: пунктирное подчёркивание, по нажатию — короткое объяснение из словаря. */
export function Term({ k, children }: { k: string; children: ReactNode }) {
  const { data } = useGlossary();
  const [lesson, setLesson] = useState<string | null>(null);
  const term = data?.find((t) => t.key === k);
  if (!term) return <>{children}</>;
  return (
    <>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className="cursor-help underline decoration-muted decoration-dotted underline-offset-4">
            {children}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content sideOffset={6} collisionPadding={16} className="z-50 max-w-xs rounded-xl border border-border bg-surface p-3 text-sm shadow-lg">
            <p className="font-semibold">{term.term}</p>
            <p className="mt-1 text-ink-2">{term.short}</p>
            {term.lessonKey && (
              <button type="button" className="mt-2 text-sm font-medium text-primary" onClick={() => setLesson(term.lessonKey)}>
                Подробнее в уроке →
              </button>
            )}
            <Popover.Arrow className="fill-surface" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {lesson && <LessonModal lessonKey={lesson} onClose={() => setLesson(null)} />}
    </>
  );
}

/** Уроки к текущему экрану: «открыл досрочку — увидел урок про досрочку». */
export function LessonsFor({ screen }: { screen: string }) {
  const { data } = useLessons();
  const [open, setOpen] = useState<string | null>(null);
  const items = data?.filter((l) => l.screens.includes(screen)) ?? [];
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((l) => (
        <button
          key={l.key}
          type="button"
          onClick={() => setOpen(l.key)}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-primary-soft px-3 py-1.5 text-left text-sm text-primary hover:opacity-90"
        >
          <BookOpen className="size-4" aria-hidden />
          {l.title} · {l.minutes} мин
        </button>
      ))}
      {open && <LessonModal lessonKey={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function LessonModal({ lessonKey, onClose }: { lessonKey: string; onClose(): void }) {
  const { hid } = useHousehold();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['h', hid, 'lesson', lessonKey],
    queryFn: () => api<LessonDto>(`/content/lessons/${lessonKey}?householdId=${hid}`),
  });
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={data?.title ?? 'Урок'} {...(data ? { description: `${data.minutes} мин чтения` } : {})}>
      {error ? <ErrorBox error={error} onRetry={() => void refetch()} /> : isLoading || !data ? <Spinner /> : <LessonBody lesson={data} />}
    </Modal>
  );
}

export function LessonBody({ lesson }: { lesson: LessonDto }) {
  return (
    <article className="space-y-5 text-[15px]">
      <Markdown text={lesson.markdown} />
      {lesson.personal && (
        <div className="rounded-xl bg-primary-soft p-4">
          <h3 className="mb-2 font-semibold text-primary">В вашем случае</h3>
          <Markdown text={lesson.personal} />
        </div>
      )}
      {lesson.quiz.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-semibold">Проверьте себя</h3>
          {lesson.quiz.map((q, i) => (
            <Quiz key={i} q={q} />
          ))}
        </div>
      )}
      <footer className="border-t border-border pt-3 text-xs text-muted">
        <p>
          Источники:{' '}
          {lesson.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && ', '}
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                {s.title}
              </a>
            </span>
          ))}
        </p>
        <p className="mt-1">Текст проверен {formatDateRu(lesson.reviewedAt)}. Расчёты носят информационный характер.</p>
      </footer>
    </article>
  );
}

function Quiz({ q }: { q: LessonDto['quiz'][number] }) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <fieldset className="rounded-xl border border-border p-3">
      <legend className="px-1 text-sm font-medium">{q.question}</legend>
      <div className="mt-1 flex flex-col gap-2">
        {q.options.map((o, i) => {
          const chosen = picked === i;
          const reveal = picked !== null;
          return (
            <button
              key={i}
              type="button"
              disabled={reveal}
              onClick={() => setPicked(i)}
              className={cx(
                'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm',
                !reveal && 'border-border hover:bg-surface-2',
                reveal && o.correct && 'border-ok bg-ok-soft',
                reveal && chosen && !o.correct && 'border-danger bg-danger-soft',
                reveal && !chosen && !o.correct && 'border-border opacity-60',
              )}
            >
              {o.text}
              {reveal && o.correct && <Check className="size-4 text-ok" aria-label="верно" />}
              {reveal && chosen && !o.correct && <X className="size-4 text-danger" aria-label="неверно" />}
            </button>
          );
        })}
      </div>
      {picked !== null && q.explanation && <p className="mt-2 text-sm text-ink-2">{q.explanation}</p>}
    </fieldset>
  );
}

export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={cx('text-xs text-muted', className)}>
      Расчёты носят информационный характер и строятся только на данных, которые вы ввели. Сервис не продаёт ипотеку и не советует конкретные банки, страховые компании или ценные бумаги.
    </p>
  );
}

export function LessonButton({ lessonKey, children = 'Урок' }: { lessonKey: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <BookOpen className="size-4" aria-hidden />
        {children}
      </Button>
      {open && <LessonModal lessonKey={lessonKey} onClose={() => setOpen(false)} />}
    </>
  );
}
