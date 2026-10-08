import type { AppDeps } from '../deps.js';
import { renderEmail } from '../lib/mailer.js';

export async function sendVerifyEmail(deps: AppDeps, to: string, name: string, code: string) {
  const { text, html } = renderEmail('Подтвердите почту', [
    `${name}, здравствуйте!`,
    `Код подтверждения: ${code}`,
    'Код действует 15 минут. Если вы не регистрировались в Ипотечном планировщике, просто проигнорируйте это письмо.',
  ]);
  await deps.mailer.send({ to, subject: `Код подтверждения: ${code}`, text, html });
}

export async function sendResetPassword(deps: AppDeps, to: string, code: string) {
  const { text, html } = renderEmail('Восстановление пароля', [
    `Код для сброса пароля: ${code}`,
    'Код действует 15 минут. Если вы не запрашивали сброс, ничего делать не нужно — пароль останется прежним.',
  ]);
  await deps.mailer.send({ to, subject: `Код для сброса пароля: ${code}`, text, html });
}

export async function sendDeleteAccountCode(deps: AppDeps, to: string, code: string) {
  const { text, html } = renderEmail('Удаление аккаунта', [
    `Код для подтверждения удаления: ${code}`,
    'После удаления все ваши данные будут стёрты без возможности восстановления. Перед этим можно выгрузить их в разделе «Мои данные».',
    'Если вы не запрашивали удаление, смените пароль.',
  ]);
  await deps.mailer.send({ to, subject: 'Подтверждение удаления аккаунта', text, html });
}

export async function sendInvitation(deps: AppDeps, to: string, inviterName: string, householdName: string, token: string) {
  const link = `${deps.config.PUBLIC_WEB_URL}/invite/${token}`;
  const { text, html } = renderEmail('Приглашение в семейный план', [
    `${inviterName} приглашает вас вести вместе план покупки жилья «${householdName}».`,
    `Чтобы присоединиться, откройте ссылку: ${link}`,
    'Приглашение действует 7 дней.',
  ]);
  await deps.mailer.send({ to, subject: `${inviterName} приглашает вас в семейный план`, text, html });
}
