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

  // инструкция открывается без входа
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Как пользоваться планировщиком' })).toBeVisible();
  await page.screenshot({ path: shots('00-help'), fullPage: true });

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
  // расходы на жизнь
  await moneyInput(page, 'Коммуналка', '8000');
  await moneyInput(page, 'Продукты', '40000');
  await moneyInput(page, 'Кафе, доставка, развлечения', '12000');
  await expect(page.getByText(/Итого:/)).toContainText('60 000');
  await page.screenshot({ path: shots('02b-wizard-budget'), fullPage: true });
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Собрать план' }).click();
  await expect(page.getByRole('heading', { name: 'План готов' })).toBeVisible();

  // «Мой месяц»: доход прямо в строке таблицы
  await page.getByRole('button', { name: 'Открыть «Мой месяц»' }).click();
  await expect(page.getByRole('heading', { name: 'Мой месяц' })).toBeVisible();
  await page.getByLabel('Новый доход: название').fill('Аванс Анны');
  await page.getByLabel('Новый доход: день').fill('25');
  await page.getByLabel('Новый доход: сумма').fill('60000');
  await page.getByRole('button', { name: 'Добавить доход' }).click();
  await expect(page.getByText('Доход добавлен')).toBeVisible();
  // разовый доход: с датой, виден только в своём месяце
  const ym = new Date().toISOString().slice(0, 7);
  await page.getByRole('radio', { name: 'Разовый' }).click();
  await page.getByLabel('Новый доход: название').fill('Продажа машины');
  await page.getByLabel('Новый доход: дата').fill(`${ym}-27`);
  await page.getByLabel('Новый доход: сумма').fill('200000');
  await page.getByRole('button', { name: 'Добавить доход' }).click();
  await expect(page.getByRole('button', { name: 'Дата поступления: изменить' })).toContainText('27');
  await expect(page.getByText('Разово в этом месяце')).toBeVisible();
  await page.getByRole('button', { name: 'Дата поступления: изменить' }).click();
  await page.getByLabel('Дата поступления', { exact: true }).fill(`${ym}-28`);
  await page.getByLabel('Дата поступления', { exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Дата поступления: изменить' })).toContainText('28');
  await page.getByRole('button', { name: 'Следующий месяц' }).click();
  await expect(page.getByRole('button', { name: 'Дата поступления: изменить' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
  await page.screenshot({ path: shots('03a-month-once'), fullPage: true });
  await page.getByRole('button', { name: 'Удалить: Продажа машины' }).click();
  await expect(page.getByText('Разово в этом месяце')).toHaveCount(0);
  // план расходов правится в строке
  await page.getByRole('button', { name: 'План: Продукты: изменить' }).click();
  await page.getByLabel('План: Продукты').fill('42000');
  await page.getByLabel('План: Продукты').press('Enter');
  await expect(page.getByRole('button', { name: 'План: Продукты: изменить' })).toContainText('42 000');
  // «Потрачено» правится в ячейке: итог и «+сумма»
  await page.getByRole('button', { name: 'Потрачено: Продукты: изменить' }).click();
  await page.getByLabel('Потрачено: Продукты').fill('5000');
  await page.getByLabel('Потрачено: Продукты').press('Enter');
  await expect(page.getByRole('button', { name: 'Потрачено: Продукты: изменить' })).toContainText('5 000');
  await page.getByRole('button', { name: 'Потрачено: Продукты: изменить' }).click();
  await page.getByLabel('Потрачено: Продукты').fill('+2500');
  await page.getByLabel('Потрачено: Продукты').press('Enter');
  await expect(page.getByRole('button', { name: 'Потрачено: Продукты: изменить' })).toContainText('7 500');
  // вне плана
  await page.getByLabel('Вне плана: на что').fill('ДР Максима');
  await page.getByLabel('Вне плана: сумма').fill('25000');
  await page.getByRole('button', { name: 'Добавить трату вне плана' }).click();
  await expect(page.getByText('ДР Максима')).toBeVisible();
  // копилка: факт рядом с планом
  await page.getByRole('button', { name: 'Подушка', exact: true }).first().click().catch(() => {});
  await page.getByRole('button', { name: 'Факт: Подушка: изменить' }).click();
  await page.getByLabel('Факт: Подушка').fill('15000');
  await page.getByLabel('Факт: Подушка').press('Enter');
  await expect(page.getByText('Факт сохранён — остаток счёта обновлён')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Факт: Подушка: изменить' })).toContainText('15 000');
  await page.screenshot({ path: shots('03a-month'), fullPage: true });

  // выписка из банка: разбор, категории, внесение
  await page.getByRole('link', { name: 'Загрузить выписку' }).first().click();
  await page.getByLabel('Файл выписки').setInputFiles('e2e/fixtures/tbank.csv');
  await expect(page.getByText(/Т-Банк ·/)).toBeVisible();
  await expect(page.getByLabel('Категория: Пятёрочка')).toHaveValue(/.+/);
  await page.screenshot({ path: shots('03b-import'), fullPage: true });
  await page.getByRole('button', { name: /^Внести 2 траты/ }).click();
  await expect(page.getByRole('heading', { name: 'Мой месяц' })).toBeVisible();
  await expect(page.getByText(/Внесено трат: 2/)).toBeVisible();

  // доходы одной строкой — подробный раздел
  await page.goto('/money/incomes');
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

  // бюджет: план из мастера, трата одной строкой
  await page.goto('/budget');
  await expect(page.getByRole('heading', { name: 'Бюджет', exact: true })).toBeVisible();
  await page.getByLabel('Трата одной строкой').fill('пятёрочка 3 450');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByText(/«Продукты»/)).toBeVisible();
  await expect(page.getByText('пятёрочка')).toBeVisible();
  // постоянный счёт — одной кнопкой
  await page.getByRole('button', { name: /Отметить «Коммуналка» оплаченной/ }).click();
  await expect(page.getByText('«Коммуналка» — отмечено оплаченным')).toBeVisible();
  await expect(page.getByText('по плану')).toBeVisible();
  await expect(page.getByText(/Куда уходит доход/).first()).toBeVisible();
  await page.screenshot({ path: shots('04b-budget'), fullPage: true });

  // главный экран
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Следующий платёж' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Бюджет этого месяца' })).toBeVisible();
  await expect(page.getByText(/Первые шаги: \d из 7/)).toBeVisible();
  await page.screenshot({ path: shots('05-dashboard'), fullPage: true });

  // счета и переводы
  await page.goto('/money/allocation');
  await expect(page.getByText('Что и куда перевести')).toBeVisible();
  await page.screenshot({ path: shots('06-allocation'), fullPage: true });

  // этапы
  await page.goto('/stages');
  await expect(page.getByText(/Одобрение ипотеки/)).toBeVisible();
  await page.screenshot({ path: shots('07-stages'), fullPage: true });

  // досрочка в простом режиме: одна сумма, сокращение срока
  await page.goto('/loan/prepayment');
  await expect(page.getByText('Сколько сэкономит досрочка')).toBeVisible();
  await expect(page.getByText('Переплата станет меньше на')).toBeVisible();
  await page.screenshot({ path: shots('08a-prepayment-simple'), fullPage: true });

  // продвинутый режим: все разделы и полный калькулятор
  await page.goto('/settings');
  await page.locator('main').getByRole('radio', { name: 'Продвинутый' }).click();
  await expect(page.locator('main').getByText(/Все разделы/)).toBeVisible();
  // распределение долями: подушка и досрочка одновременно
  await page.goto('/money/allocation');
  await page.getByRole('radio', { name: 'Долями' }).click();
  await expect(page.getByText(/Каждое поступление делится между целями/)).toBeVisible();
  await expect(page.getByLabel('Доля: Досрочка')).toBeVisible();
  await page.screenshot({ path: shots('06b-allocation-split'), fullPage: true });

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
