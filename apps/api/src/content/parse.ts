export interface QuizQuestion {
  question: string;
  options: { text: string; correct: boolean }[];
  explanation: string | null;
}

export interface ParsedLesson {
  key: string;
  title: string;
  minutes: number;
  screens: string[];
  sources: { title: string; url: string }[];
  reviewedAt: string;
  /** Основной текст (Markdown). */
  markdown: string;
  /** Блок «В вашем случае» — шаблон с подстановками {{fact.x|rub}}. */
  personal: string | null;
  quiz: QuizQuestion[];
}

const PERSONAL = '## В вашем случае';
const QUIZ = '## Проверьте себя';

/**
 * Формат урока: frontmatter `ключ: значение` (sources можно повторять: «Название | url»),
 * затем Markdown. Разделы «В вашем случае» и «Проверьте себя» разбираются отдельно.
 */
export function parseLesson(key: string, source: string): ParsedLesson {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  if (!m) throw new Error(`lesson ${key}: нет frontmatter`);
  const meta: Record<string, string[]> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    (meta[k] ??= []).push(line.slice(i + 1).trim());
  }
  const one = (k: string) => {
    const v = meta[k]?.[0];
    if (!v) throw new Error(`lesson ${key}: нет поля ${k}`);
    return v;
  };
  let body = m[2]!;
  let quizText = '';
  let personal: string | null = null;
  const qi = body.indexOf(QUIZ);
  if (qi >= 0) {
    quizText = body.slice(qi + QUIZ.length);
    body = body.slice(0, qi);
  }
  const pi = body.indexOf(PERSONAL);
  if (pi >= 0) {
    personal = body.slice(pi + PERSONAL.length).trim();
    body = body.slice(0, pi);
  }
  const quiz: QuizQuestion[] = [];
  for (const block of quizText.split(/\n(?=\? )/)) {
    const lines = block.trim().split(/\r?\n/).filter(Boolean);
    const q = lines.find((l) => l.startsWith('? '));
    if (!q) continue;
    quiz.push({
      question: q.slice(2).trim(),
      options: lines.filter((l) => /^- \[[ x]\] /.test(l)).map((l) => ({ text: l.slice(6).trim(), correct: l[3] === 'x' })),
      explanation: lines.find((l) => l.startsWith('> '))?.slice(2).trim() ?? null,
    });
  }
  for (const q of quiz) {
    if (q.options.filter((o) => o.correct).length !== 1) throw new Error(`lesson ${key}: в вопросе «${q.question}» должен быть ровно один верный ответ`);
  }
  const reviewedAt = one('reviewedAt');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt)) throw new Error(`lesson ${key}: reviewedAt в формате ГГГГ-ММ-ДД`);
  const sources = (meta.sources ?? []).map((s) => {
    const [title, url] = s.split('|').map((x) => x.trim());
    if (!title || !url?.startsWith('http')) throw new Error(`lesson ${key}: источник «${s}» в формате «Название | https://…»`);
    return { title, url };
  });
  if (!sources.length) throw new Error(`lesson ${key}: нужен хотя бы один источник`);
  return {
    key,
    title: one('title'),
    minutes: Number(one('minutes')),
    screens: (meta.screens?.[0] ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    sources,
    reviewedAt,
    markdown: body.trim(),
    personal,
    quiz,
  };
}
