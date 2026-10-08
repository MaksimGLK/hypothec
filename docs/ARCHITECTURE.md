# Ипотечный планировщик — архитектура (черновик на согласование)

Статус: **согласовано** (2026-10-08). Изменение относительно черновика: вход по логину (email) и паролю вместо одноразовых кодов.

---

## 1. Ключевые технические решения

| Вопрос | Решение | Почему |
|---|---|---|
| Монорепо | **pnpm workspaces + Turborepo** | Кэш сборки/тестов, понятные зависимости между пакетами |
| Язык | TypeScript strict везде | Одно ядро для веба, сервера и мобилки |
| Бэкенд | **Fastify** + `fastify-type-provider-zod` | Легче NestJS, Zod-схемы из `api-contract` напрямую валидируют запросы и генерируют OpenAPI |
| БД | PostgreSQL 16 + **Drizzle ORM** (SQL-миграции) | Без бинарного движка, типы выводятся из схемы, миграции — обычный SQL, удобно ревьюить |
| Фоновые задачи | **pg-boss** (очередь в Postgres) | Напоминания и письма без отдельного Redis |
| Почта | SMTP (nodemailer); локально — **Mailpit** в Docker | Коды входа и напоминания видно в браузере при разработке |
| Веб | **React + Vite** (SPA), React Router + TanStack Query, Tailwind + Radix UI (диалоги, всплывающие подсказки) | Приложение целиком за авторизацией — SSR не нужен; SPA ближе к модели мобильного клиента (тот же API) |
| Графики | Recharts | Достаточно для графиков платежей и сравнений |
| Мобилка | Expo (React Native), на MVP — пустая структура, подключённые `core` и `api-contract` | Проверяем, что ядро собирается под RN с первого дня |
| Тесты | Vitest (core, api), Testcontainers для интеграционных тестов API с реальным Postgres, Playwright — смоук веба | |
| Документация API | OpenAPI 3.1, генерируется из Zod, Swagger UI на `/api/docs` | Контракт для мобильного клиента |

### Деньги и точность

- Все суммы — **целые копейки** (`number`, безопасно до ~90 трлн ₽; в API — целое число `amountKop`).
- Промежуточные вычисления (проценты, степени в аннуитете) — **decimal.js** с точностью 40 знаков; округление до копейки — `ROUND_HALF_UP` (как в большинстве банков), в одной функции `roundKop()`.
- Ставки — строка-десятичная в API (`"16.00"`) и `Decimal` в ядре. Никаких `float` в денежных путях; линтер-правило запрещает арифметику над полями `*Kop` вне модуля `money`.
- Начисление процентов, два режима (настройка кредита):
  - `monthly` — ставка/12 (так считается эталон: 10 315 920 ₽, 16%, 120 мес → 172 805 ₽);
  - `daily` — ставка/365(366) × фактические дни периода (так считают многие российские банки; нужно для сверки с банковским графиком).

---

## 2. Структура монорепозитория

```
hypothec/
├─ packages/
│  ├─ core/                  # чистая финансовая логика, 0 зависимостей от UI/сервера (только decimal.js, date-fns)
│  │  ├─ money/              # Kop, roundKop, форматирование "1 234 567,89 ₽"
│  │  ├─ loan/               # аннуитет, дифф., смена ставки, досрочка (3 режима), график, сверка с банком
│  │  ├─ prepayment/         # сценарии досрочки, сравнение до 4, «сейчас vs через N лет»
│  │  ├─ income/             # раскладка доходов по датам, надёжность, периодичность, quick-input парсер
│  │  ├─ allocation/         # конверты, правила приоритетов, календарь переводов, резерв на ежегодные платежи
│  │  ├─ cushion/            # цель подушки, прогноз даты, стресс-тест
│  │  ├─ tax/                # вычеты с покупки и процентов, лимиты на каждого супруга
│  │  ├─ stages/             # шаблоны этапов по сценариям, генерация плана из ответов мастера
│  │  ├─ expenses/           # справочник расходов, регулярные (страховка ежегодно), «после ключей»
│  │  ├─ projection/         # buildPlan(input) → весь пересчитанный план (единая точка входа)
│  │  ├─ recommendations/    # движок: факты → условия (JSON) → эффект → текст
│  │  └─ calendar/           # единая лента событий из projection
│  ├─ api-contract/          # Zod-схемы запросов/ответов, коды ошибок, типы; экспорт OpenAPI
│  ├─ content/               # уроки (MDX/Markdown + frontmatter: источники, дата проверки), словарь, правила рекомендаций (JSON)
│  ├─ ui-tokens/             # цвета/отступы/типографика для веба и RN (светлая/тёмная тема)
│  └─ config/                # общие tsconfig, eslint, prettier
├─ apps/
│  ├─ api/                   # Fastify, /api/v1, Drizzle, pg-boss воркер (тот же образ, отдельный процесс)
│  ├─ web/                   # React + Vite
│  └─ mobile/                # Expo-заготовка
├─ docker-compose.yml        # postgres, mailpit, api, worker, web
├─ .env.example
└─ README.md
```

**Принцип пересчёта.** `core/projection.buildPlan(PlanInput, today)` — чистая функция: на вход все данные семьи, на выход график(и), календарь переводов, прогнозы целей, подушка, рекомендации, события календаря. Сервер — источник истины (`GET /plan/projection`, кэш по `household.revision`). Клиент может вызывать то же ядро локально для мгновенного «что если» (ползунки досрочки) — это не нарушает API-first, потому что мобилка делает ровно то же; всё, что сохраняется, идёт только через API.

---

## 3. Модель данных

Все таблицы: `id uuid`, `created_at`, `updated_at`; данные семьи — с `household_id`. Для совместного редактирования — `version int` на сущности (оптимистичная блокировка, 409 при конфликте) и `households.revision` (растёт при любом изменении, ключ кэша пересчёта).

### Пользователи и доступ
- **users** — email, имя, `deleted_at`.
- **auth_identities** — `user_id`, `provider` (`password` | `phone` | `vk` | `yandex` | `sber`), `subject`. Логин — email. Новые способы входа = новая строка, схема не меняется.
- **users.password_hash** — argon2id (memory 19 MiB, t=2). Требования к паролю: от 8 символов, проверка по списку самых распространённых паролей; без требований «заглавная + цифра + спецсимвол».
- **email_codes** — одноразовые коды для подтверждения email и сброса пароля: `user_id`, `purpose` (`verify_email` | `reset_password` | `delete_account`), хэш кода, `expires_at` (15 мин), `attempts` (≤5), `consumed_at`.
- **login_attempts** — защита от перебора: после 5 неудачных попыток — задержка нарастает, после 10 — блок на 15 минут по паре email+IP.
- **refresh_sessions** — `user_id`, хэш токена, `device_name`, `platform` (web/ios/android), `expires_at` (60 дней), `rotated_from`. Ротация при каждом обновлении, повторное использование старого токена → отзыв всей цепочки.
- **consents** — `user_id`, тип (ПДн, рассылка), версия документа, дата, IP. Регистрация без согласия на ПДн невозможна.
- **households** — название, `revision`, настройки (N месяцев подушки, порядок целей).
- **household_members** — `household_id`, `user_id`, `role` (`owner` | `member`), `display_name` (для вычетов «на каждого супруга»).
- **invitations** — email, токен (хэш), роль, срок, статус.

### План покупки
- **purchase_scenarios** — ответы мастера: состав семьи, тип жилья (`new_ddu` | `secondary` | `house`), альтернативная сделка, маткапитал (сумма), программа (`family` | `base` | `it` | `other`), стоимость, взнос, плановая дата ключей.
- **stages** — `scenario_id`, `template_key` (null у пользовательских), название, статус (`todo`|`in_progress`|`done`|`skipped`), `planned_date`, `actual_date`, `hint_key` (ссылка на текст в content), `sort`.
- **stage_documents** — `stage_id`, название, `is_ready`.
- **expenses** — `stage_id?`, `catalog_key?`, категория (`mandatory`|`optional`|`after_keys`), название, `plan_kop`, `fact_kop?`, `date`, `recurrence` (`once`|`monthly`|`yearly`), `end_date?`, `priority` (для «после ключей»), `loan_id?` (страховка привязана к кредиту и живёт весь срок), `paid_by_credit` (покупка в кредит/рассрочку → правило рекомендаций).

### Доходы и конверты
- **incomes** — `member_id?`, название, тип (`salary`|`advance`|`bonus`|`self_employed`|`rent`|`one_off`|`tax_refund`|`gift`|`property_sale`), `amount_kop`, периодичность (`monthly`|`quarterly`|`yearly`|`once`), `day_of_month` / `date`, `reliability` (`stable`|`unstable`|`expected`), `start_date`, `end_date`, `start_trigger?` (`keys_date` — «аренда начнётся после переезда», дата сдвигается вместе с ключами).
- **living_expenses** — базовые траты семьи в месяц (нужны для подушки и стресс-теста).
- **accounts** (конверты) — `kind` (`mortgage`|`cushion`|`setup`|`prepayment`|`life`|`annual_reserve`|`custom`), название, `balance_kop` (фактический остаток, вводит пользователь), `target_kop?`, `sort`.
- **allocation_rules** — упорядоченный список: `account_id`, `priority`, `source_filter` (`stable`|`any`|`irregular`), `target_type` (`amount`|`until_target`|`percent_of_rest`). Создаётся по умолчанию из настроек семьи, редактируется.
- **transfers_fact** — отметки «перевёл», чтобы календарь показывал выполнено/нет.

### Кредиты
- **loans** — название, банк (свободный текст), `principal_kop`, `rate`, `term_months`, `type` (`annuity`|`differentiated`), `issue_date`, `payment_day`, `interest_mode` (`monthly`|`daily`), правила досрочки: `prepay_only_on_payment_date bool`, `prepay_min_kop`, `prepay_notice_days`; `market_rate_hint?` (для правила о рефинансировании, вводит пользователь).
- **loan_rate_changes** — `loan_id`, `from_date`, `rate` (конец льготного периода и т.п.).
- **prepayment_scenarios** — `name`, `is_active` (активный попадает в основной план), `color`. До 4 сравниваются рядом.
- **prepayments** — `scenario_id`, `loan_id`, вид (`monthly`|`one_off`), `amount_kop`, `date`/`start_date`/`end_date`, режим (`reduce_term`|`reduce_payment`|`reduce_payment_keep_amount`), `source` (`manual`|`tax_refund`).
- **bank_schedules** + **bank_schedule_rows** — импорт CSV: дата, платёж, проценты, тело, остаток; сверка с расчётом.
- **tax_deduction_settings** — на каждого участника: использовал ли вычет ранее, доля в собственности, ставка НДФЛ, уже возвращено.

### Рекомендации, уведомления, контент
- **recommendation_rules** — `key`, `version`, `is_active`, `definition jsonb` (см. §5), `published_at`. Читаются API при пересчёте → правки без релиза.
- **recommendation_states** — `household_id`, `rule_key`, `status` (`dismissed`|`snoozed`), `until`, `fingerprint` (чтобы рекомендация вернулась, если ситуация существенно изменилась).
- **notifications** — `user_id`, тип, `payload`, `scheduled_at`, `channel` (`email`|`push`), `status`, `dedupe_key`.
- **notification_preferences** — `user_id`, тип события, каналы, за сколько дней.
- **push_devices** — задел для мобилки (токен Expo/APNs/FCM).
- **content_items** — уроки, словарь, подсказки этапов: `key`, `kind`, `version`, `body`, `sources[]`, `reviewed_at`. Источник — `packages/content` в репо, загружается в БД командой `pnpm content:sync`; API отдаёт из БД.
- **audit_log** — кто из семьи что изменил (полезно при совместном редактировании и для 152-ФЗ).

Связи коротко: `user —< household_members >— household`; `household —< purchase_scenario —< stages —< stage_documents`; `household —< loans —< loan_rate_changes`; `household —< prepayment_scenarios —< prepayments >— loan`; `household —< incomes / expenses / accounts / allocation_rules`.

---

## 4. API `/api/v1`

> Источник истины — OpenAPI: `/api/v1/docs` (Swagger UI) и `pnpm --filter @hypothec/api openapi > openapi.json`. Ниже — обзор.

Авторизация: `Authorization: Bearer <access>` (JWT, 15 мин). Все пути семьи — `/households/:hid/...`, проверка членства в middleware. Ошибки — единый формат `{ code, message, details }`. Изменяющие запросы принимают `version` → 409 при конфликте.

**Auth**
- `POST /auth/register` `{ email, password, name, consents, device }` → `{ access, refresh, user }` + письмо с кодом подтверждения
- `POST /auth/login` `{ email, password, device }` → `{ access, refresh, user }`
- `POST /auth/verify-email` `{ code }`, `POST /auth/verify-email/resend`
- `POST /auth/password/forgot` `{ email }` (ответ всегда 204, чтобы не раскрывать наличие аккаунта)
- `POST /auth/password/reset` `{ email, code, newPassword }` → отзывает все сессии
- `POST /auth/password/change` `{ currentPassword, newPassword }`
- `POST /auth/refresh` `{ refresh }` → новая пара
- `POST /auth/logout`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`

**Профиль и данные**
- `GET/PATCH /me`
- `GET /me/export` → JSON со всеми данными пользователя и его семей
- `POST /me/delete/request` → код на почту; `DELETE /me` `{ password, code }` — полное удаление. Семья, где пользователь один, удаляется; иначе права владельца переходят супругу
- `GET/PUT /me/notification-preferences`

**Семья**
- `POST /households`, `GET /households`, `GET/PATCH /households/:hid`
- `GET /households/:hid/members`, `PATCH/DELETE .../members/:mid`
- `POST /households/:hid/invitations`, `DELETE .../invitations/:id`
- `POST /invitations/:token/accept`

**Мастер и этапы**
- `POST /households/:hid/wizard` — ответы мастера → создаёт сценарий, этапы, расходы, конверты, черновик кредита
- `GET/PATCH /households/:hid/scenario`
- `GET/POST /households/:hid/stages`, `PATCH/DELETE .../stages/:id`, `POST .../stages/reorder`
- `POST/PATCH/DELETE .../stages/:id/documents[/:docId]`

**Деньги**
- CRUD: `/households/:hid/expenses`, `/incomes`, `/accounts`, `/loans`, `/loans/:id/rate-changes`, `/living-expenses`
- `POST /households/:hid/incomes/parse` `{ text: "Премия 110 000 каждый месяц 15-го" }` → черновик дохода (парсер в core)
- `GET/PUT /households/:hid/allocation-rules`
- `POST /households/:hid/transfers/:date/:accountId/done`
- `GET /catalog/expenses`, `GET /catalog/stage-templates`

**Досрочка**
- CRUD `/households/:hid/prepayment-scenarios` и `.../:sid/prepayments`
- `POST /households/:hid/prepayment-scenarios/compare` `{ ids[≤4] }` → переплата, экономия, дата закрытия, графики
- `POST /households/:hid/what-if` — расчёт без сохранения (любой частичный PlanInput поверх текущего)

**Пересчитанный план** (всё считает `core.buildPlan`)
- `GET /households/:hid/dashboard` — главный экран одним запросом
- `GET /households/:hid/projection` — полный план (ETag = revision)
- `GET /households/:hid/loans/:id/schedule?scenario=`
- `GET /households/:hid/allocation-calendar?from&to`
- `GET /households/:hid/cushion` — цель, прогресс, прогноз даты
- `POST /households/:hid/stress-test` `{ removeIncomeIds[] }`
- `GET /households/:hid/calendar?from&to` (+ `.ics`-экспорт)
- `GET /households/:hid/tax-deductions`

**Импорт**
- `POST /households/:hid/loans/:id/bank-schedule` (CSV) → `GET .../bank-schedule/diff`

**Рекомендации и обучение**
- `GET /households/:hid/recommendations` (с объяснением: факты, формула эффекта)
- `PUT|DELETE /households/:hid/recommendations/:key/state` — скрыть/отложить/вернуть
- `POST /households/:hid/recommendations/:key/apply` → создаёт черновик в what-if-сценарии / напоминание
- `GET /content/lessons`, `GET /content/lessons/:key?householdId=` (урок с персональным расчётом), `GET /content/glossary`

**Служебное**: `GET /health`, `GET /api/docs`.

---

## 5. Движок рекомендаций

Проблема: «правила как данные» и «эффект в рублях» конфликтуют — расчёт эффекта требует кода. Решение в три слоя:

1. **Факты** (код в core, версионируется с релизом): именованные метрики из projection — `cushionMonths`, `dtiStable`, `mortgagePaidFromUnstable`, `prepaymentWhileCushionLow`, `annualPaymentsWithoutReserve`, `depositNetRate`, `loanRate`, `deductionAvailableKop` и т.д.
2. **Калькуляторы эффекта** (код в core): `prepaySavingsNowVsLater(amount, years)`, `reduceTermVsPayment(prepaymentId)`, `refinanceBenefit(newRate, costs)`, `creditPurchaseOverpay(expenseId)` …
3. **Правило** (данные, `recommendation_rules.definition`):
   ```json
   {
     "key": "cushion_before_prepayment",
     "version": 3,
     "when": { "and": [ { "<": [ { "fact": "cushionMonths" }, 3 ] }, { ">": [ { "fact": "plannedPrepaymentKop" }, 0 ] } ] },
     "effect": { "calc": "cushionMonthsNow" },
     "severity": "high",
     "urgency": { "fact": "daysToNextPrepayment" },
     "title": "Сначала подушка, потом досрочка",
     "text": "Сейчас семья продержится без дохода {{effect.months}} мес. Деньги, внесённые в досрочку, обратно не достать.",
     "actions": [ { "type": "apply_scenario", "patch": "redirect_prepayment_to_cushion" }, { "type": "lesson", "key": "cushion" } ],
     "sources": ["https://fincult.info/..."],
     "reviewedAt": "2026-10-01"
   }
   ```
   Условия — JSON-Logic над фактами. Новые правила и тексты из существующих фактов и калькуляторов — без релиза; новый вид факта — релиз core (честное ограничение).

Сортировка: `эффект в ₽ (нормированный) × срочность × severity`. Каждая рекомендация возвращается с `explanation: { facts: {...}, formula: "..." }`. Стартовые 14 правил из ТЗ — все реализуемы этой схемой; на каждое — тесты «срабатывает / не срабатывает / эффект в рублях».

---

## 6. Ключевые алгоритмы ядра (кратко)

- **График кредита**: помесячный проход с учётом смен ставки (пересчёт аннуитета с даты смены на остаток и оставшийся срок), досрочных платежей и режима. «Уменьшить платёж, но платить прежнюю сумму» = после досрочки банк пересчитывает платёж вниз, а семья сама доплачивает разницу как ежемесячную досрочку. Последний платёж корректируется на остаток копеек; доплата больше остатка обрезается до остатка; правила банка (только в дату платежа, минимум) применяются к датам досрочки с предупреждением.
- **Календарь распределения**: лента поступлений по датам (с учётом надёжности и периодов) → для каждого поступления раскладка по `allocation_rules` в порядке приоритета; конверт «Ипотечный платёж» заполняется только из `stable` и рассчитывается «назад» от даты платежа (к дню X нужно Y — с какой зарплаты сколько); ежегодные платежи → помесячный резерв `сумма / месяцев до даты`. Нестабильные/ожидаемые деньги — только на цели (настраивается).
- **Подушка**: цель = N × (платежи по кредитам + базовые траты); прогноз даты — симуляция наполнения по календарю распределения.
- **Стресс-тест**: убираем выбранные доходы, симулируем месяцы до опустошения подушки, отмечаем первый дефицит.
- **Вычеты**: имущественный — до 2 млн ₽ базы на человека, проценты — до 3 млн ₽ на человека, ставка НДФЛ и уже использованное — из настроек; результат можно одной кнопкой превратить в разовые досрочки в сценарии.

---

## 7. Экраны веба

1. Регистрация (email, пароль, согласие на ПДн), вход, восстановление пароля
2. Мастер (6 шагов) → «Ваш план готов»
3. **Главная**: следующий платёж и готовность ипотечного счёта, подушка, цели, дата закрытия и экономия от досрочки, ближайшие этапы, 1–3 рекомендации
4. Этапы сделки — чек-лист с датами, документами, подсказками и расходами
5. Расходы — план/факт по этапам, блок «после ключей» с приоритетами
6. Доходы — список + быстрый ввод одной строкой, шаблоны, надёжность
7. Счета и календарь переводов — «12-го: 60 000 → Ипотека, 15 000 → Подушка»
8. Кредиты — параметры, смены ставки, правила банка, график, сверка с банковским CSV
9. Досрочка — конструктор сценариев, сравнение до 4, «1 млн сейчас vs через 5 лет», вычеты в досрочку
10. Подушка и стресс-тест
11. Календарь (месяц/список)
12. Рекомендации (все, с объяснением) и Уроки/Словарь
13. Семья и доступ, Настройки (тема, уведомления), Мои данные (экспорт, удаление)

Везде: суммы `1 234 567 ₽`, термины подчёркнуты пунктиром → всплывающее объяснение из словаря, плашка «Расчёты носят информационный характер».

---

## 8. Безопасность и 152-ФЗ

- Развёртывание: Docker-образы, совместимые с российскими облаками (Yandex Cloud / Selectel / VK Cloud); БД и бэкапы — в РФ.
- Никаких внешних ресурсов с зарубежных CDN в вебе (шрифты и скрипты — self-hosted), без сторонней аналитики на MVP.
- TLS на входе (reverse proxy), HSTS; пароли — argon2id, refresh-токены и коды — только хэши; rate-limit и прогрессивная задержка на вход.
- Веб хранит refresh в httpOnly-cookie (через тот же эндпоинт), мобилка — в SecureStore.
- Согласие с версией документа; экспорт всех данных; удаление аккаунта — физическое удаление строк в течение 30 дней (сразу — анонимизация), включая бэкапы по ротации.

---

## 9. План этапов

1. **Архитектура** (этот документ) — ждёт подтверждения.
2. **Ядро** `packages/core` + `api-contract` + тесты (эталон 172 805 ₽ / 10,42 млн, досрочка во всех режимах, смена ставки, граничные случаи, все 14 правил).
3. **Бэкенд**: auth, семья и приглашения, CRUD, projection/dashboard, напоминания (pg-boss + email), экспорт/удаление, контент.
4. **Веб**: все экраны MVP, тёмная/светлая тема, mobile-first.
5. Заготовка Expo, README, docker-compose, `.env.example`.

После каждого этапа: как запустить и проверить, что готово, что осталось.

## 10. Принятые решения

1. Бэкенд — Fastify.
2. Веб — React + Vite SPA.
3. ORM — Drizzle.
4. Проценты по умолчанию — `monthly` (ставка/12), `daily` — настройка кредита.
5. Тексты уроков и правил — пишем по официальным источникам с датой проверки.
6. Вход — email + пароль; коды на email только для подтверждения почты, сброса пароля и удаления аккаунта.
