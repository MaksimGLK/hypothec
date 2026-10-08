import { expect, type Page, test } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
const shots = (name: string) => `e2e/.screens/${test.info().project.name}-${name}.png`;

async function mailCode(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const data = (await res.json()) as { messages: { Subject: string }[] };
    const code = data.messages.map((m) => /(\d{6})/.exec(m.Subject)?.[1]).find(Boolean);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('код не пришёл');
}

async function moneyInput(page: Page, label: string, rubles: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(rubles);
}

test('семья проходит путь: регистрация → мастер → доходы → план → досрочка', async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.ru`;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // регистрация
  await page.goto('/register');
  await page.getByLabel('Как к вам обращаться').fill('Анна');
  await page.getByLabel('Почта').fill(email);
  await page.getByLabel('Пароль').fill('тестовый пароль для e2e');
  await page.getByRole('checkbox', { name: /согласие на обработку/ }).check();
  await page.screenshot({ path: shots('01-register'), fullPage: true });
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  // без сценария — сразу мастер
  await expect(page).toHaveURL(/\/wizard/);
  await expect(page.getByText('Кто будет жить в новой квартире?')).toBeVisible();

  // подтверждение почты кодом из письма
  const code = await mailCode(email);
  await page.getByLabel('Код из письма').fill(code);
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Почта подтверждена')).toBeVisible();

  // мастер
  await page.getByRole('button', { name: 'Увеличить: Дети' }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: /Готовую квартиру/ }).click();
  await page.screenshot({ path: shots('02-wizard'), fullPage: true });
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await moneyInput(page, 'Примерная стоимость', '9000000');
  await moneyInput(page, 'Первый взнос — свои деньги', '2000000');
  await expect(page.getByText(/Сумма кредита —/)).toContainText('7 000 000');
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByLabel('Ставка, % годовых').fill('16');
  await page.getByLabel('Срок, лет').selectOption('20');
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Собрать план' }).click();
  await expect(page.getByRole('heading', { name: 'План готов' })).toBeVisible();

  // доходы одной строкой
  await page.getByRole('button', { name: 'Добавить доходы' }).click();
  await page.getByLabel('Доход одной строкой').fill('Зарплата Анны 250 000 каждый месяц 10-го');
  await page.getByRole('button', { name: 'Разобрать' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Название')).toHaveValue('Зарплата Анны');
  await page.screenshot({ path: shots('03-income-parsed'), fullPage: true });
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Доход добавлен')).toBeVisible();
  await page.getByLabel('Доход одной строкой').fill('Премия 300 000 раз в квартал');
  await page.getByRole('button', { name: 'Разобрать' }).click();
  await page.getByRole('dialog').getByLabel('Дата первого поступления').fill('2026-12-20');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Премия').first()).toBeVisible();
  await page.screenshot({ path: shots('04-incomes'), fullPage: true });

  // ежемесячные траты
  await page.goto('/money/expenses');
  await page.getByRole('radio', { name: 'Каждый месяц' }).click();
  await page.getByRole('button', { name: 'Указать' }).click();
  await moneyInput(page, 'Сумма в месяц', '110000');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText(/Итого:/)).toContainText('110 000');

  // главный экран
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Следующий платёж' })).toBeVisible();
  await expect(page.getByText('Главное сейчас')).toBeVisible();
  await page.screenshot({ path: shots('05-dashboard'), fullPage: true });

  // счета и переводы
  await page.goto('/money/allocation');
  await expect(page.getByText('Что и куда перевести')).toBeVisible();
  await page.screenshot({ path: shots('06-allocation'), fullPage: true });

  // этапы
  await page.goto('/stages');
  await expect(page.getByText(/Одобрение ипотеки/)).toBeVisible();
  await page.screenshot({ path: shots('07-stages'), fullPage: true });

  // досрочка: мгновенный расчёт в браузере
  await page.goto('/loan/prepayment');
  await expect(page.getByText('Быстрый расчёт')).toBeVisible();
  await expect(page.getByText('меньше переплата').first()).toBeVisible();
  await page.getByRole('button', { name: /В сценарий «Основной план»/ }).first().click();
  await expect(page.getByText('Добавлено в сценарий')).toBeVisible();
  await page.screenshot({ path: shots('08-prepayment'), fullPage: true });

  // кредит и график
  await page.goto('/loan');
  await expect(page.getByText('Куда уходят деньги по годам')).toBeVisible();
  await page.screenshot({ path: shots('09-loan'), fullPage: true });

  // урок с расчётом на данных семьи
  await page.goto('/learn');
  await page.getByRole('button', { name: /Как устроен аннуитетный платёж/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('В вашем случае')).toBeVisible();
  await expect(page.getByText(/Первый платёж —/)).toBeVisible();
  await page.getByRole('dialog').screenshot({ path: shots('10-lesson') });
  await page.keyboard.press('Escape');

  // тёмная тема
  await page.goto('/settings');
  await page.getByRole('radio', { name: /Тёмная/ }).click();
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('heading', { name: 'Следующий платёж' })).toBeVisible();
  await page.screenshot({ path: shots('11-dashboard-dark'), fullPage: true });

  // после перезагрузки сессия восстанавливается по cookie
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Следующий платёж' })).toBeVisible();

  expect(errors).toEqual([]);
});
