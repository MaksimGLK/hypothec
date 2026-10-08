import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export function createSmtpMailer(config: Config): Mailer {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } } : {}),
  });
  return {
    async send(m) {
      await transport.sendMail({ from: config.MAIL_FROM, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) });
    },
  };
}

/** Почта в памяти — для тестов. */
export function createMemoryMailer(): Mailer & { sent: MailMessage[]; last(to: string): MailMessage | undefined } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(m) {
      sent.push(m);
    },
    last(to) {
      return [...sent].reverse().find((m) => m.to === to);
    },
  };
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Простой HTML-шаблон письма: спокойный, без картинок и трекеров. */
export function renderEmail(title: string, paragraphs: string[], footer = 'Расчёты носят информационный характер.'): { text: string; html: string } {
  const text = [title, '', ...paragraphs, '', '—', footer].join('\n');
  const html = `<!doctype html><html lang="ru"><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2933;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">
<h2 style="font-weight:600;font-size:20px">${escape(title)}</h2>
${paragraphs.map((p) => `<p>${escape(p)}</p>`).join('\n')}
<p style="color:#6b7280;font-size:13px;margin-top:32px">${escape(footer)}</p></body></html>`;
  return { text, html };
}
