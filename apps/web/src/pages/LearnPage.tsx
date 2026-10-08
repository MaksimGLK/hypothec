import { BookOpen, Search } from 'lucide-react';
import { useState } from 'react';
import { LessonModal, useGlossary, useLessons } from '../components/learning.js';
import { Input, PageHeader, Spinner } from '../components/ui/index.js';

export default function LearnPage() {
  const lessons = useLessons();
  const glossary = useGlossary();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const terms = (glossary.data ?? []).filter((t) => {
    const s = q.trim().toLowerCase();
    return !s || t.term.toLowerCase().includes(s) || t.short.toLowerCase().includes(s) || t.aliases.some((a) => a.toLowerCase().includes(s));
  });
  return (
    <div>
      <PageHeader title="Уроки и словарь" subtitle="Короткие уроки на 2–3 минуты. В каждом — расчёт на ваших цифрах и пара вопросов для самопроверки." />
      {lessons.isLoading ? (
        <Spinner />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {lessons.data?.map((l) => (
            <li key={l.key}>
              <button type="button" onClick={() => setOpen(l.key)} className="flex w-full items-start gap-3 rounded-2xl border border-border bg-surface p-4 text-left hover:bg-surface-2">
                <BookOpen className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="block font-medium">{l.title}</span>
                  <span className="text-sm text-muted">{l.minutes} мин</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Словарь</h2>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Поиск по словарю" placeholder="Найти термин" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <dl className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {terms.map((t) => (
            <div key={t.key} className="px-4 py-3">
              <dt className="font-medium">{t.term}</dt>
              <dd className="mt-0.5 text-sm text-ink-2">
                {t.short}{' '}
                {t.lessonKey && (
                  <button type="button" className="text-primary" onClick={() => setOpen(t.lessonKey)}>
                    Урок →
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      {open && <LessonModal lessonKey={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
