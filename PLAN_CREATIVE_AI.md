# Т7.7 — приватні AI Tools у Creative Workspace

Вкладка AI Tools на `/creative/workspace/:id`; API `/api/creative/projects/:id/workspace/ai`. Виконання через наявні реєстри imageGeneration / videoGeneration, платформні ключі й серверне середовище. DeepSeek — текстовий провайдер і не пропонується як генератор зображень / відео.

## Дії та права

`creative:image:generate`, `creative:image:edit`, `creative:video:generate`, `creative:video:edit` — окремі дії. Власник активного Workspace має їх; обраному активному фахівцю потрібні WORK на Workspace і явний підтверджений набір дозволів ШІ. Надання / відкликання з CAS, необов’язковим строком і подією аудиту. Це не створює учасників чи Core grants. Фахівець має отримати окремий VIEW Style Bible; для сутностей / бібліотечних референсів потрібні відповідні grants. Роль або WORK самі не дають дій ШІ; чужий admin не обходить перевірку книги. FORBIDDEN опублікованого брифу має пріоритет над чернеткою.

Окремо перевіряється актуальний платформний `canGenerateImages`. Зображення використовують наявну image quota тарифу. Додатковий ліміт Workspace за 00:00 UTC: 20 прийнятих спроб image, 5 video на користувача за добу, незалежно від проєкту й успіху; одне RUNNING завдання на користувача. Відео має цей явний денний ліміт; окремої тарифної video quota в наявному продукті немає. Байти результату заряджають storage quota фактичного ініціатора перед записом. Refund існуючих квот не автоматизовано.

## Контекст і приватність

Клієнт передає інструкцію, whitelist параметрів, ID вибраних сутностей / бібліотечних референсів. Довільні URL, base64 референси, ключі або готовий context не приймаються. Сервер формує контекст із дозволених назв / типів сутностей, їхніх видимих правил канону та активної незмінної версії Style Bible. Біографії canonical, рукопис, нотатки й приховані сутності не додаються. Дозволений MANAGE Style Bible може задати override лише поточного завдання; базова версія не змінюється.

Private media читаються після перевірки book / asset scope; передаються як inline bytes. Gemini використовує нативні `data` / `mime_type`, Leonardo — власний приватний reference upload, Seedream — наявний транспорт із inline reference. OpenAI image reference-edit не заявляється, поки наявний адаптер його не підтримує. Моделі пропонують свої розміри / формати / кількість референсів / тривалість; unsupported параметри відхиляються до провайдера. Ключі, сирі помилки провайдера й приватні інструкції не повертаються в model/job endpoints.

Дозволи, reference доступ, стан проєкту, parent revision і контекст перевіряються повторно перед провайдером та перед збереженням. При вимкненні акаунта, відкликанні дозволу / доступу або зміні активних правил результат відхиляється. Уже оплачений зовнішній запит скасувати заднім числом неможливо; витрати залишаються в usage.

## Генерація, редагування та jobs

Запит повертає durable job одразу; UI polling 3 с, без довгого HTTP-запиту через Railway. Idempotency за user / requestId; повтор із тим самим тілом повертає той самий job, інше тіло — конфлікт. Одночасний первинний запит може отримати 409: повторіть той самий requestId для стану. Перезапуск зберігає jobs і дозволи. Прострочені RUNNING jobs через 20 хв переводяться FAILED при наступному читанні / новому запуску; автоматичного повторного платного виклику немає. Worker у процесі; зовнішній provider task після crash не відновлюється.

Результат — приватний DRAFT у SQLite Workspace, фактичний автор / provider / model / settings, внутрішні jobId й promptReference, immutable generationContext (style version / override, entities / reference IDs). Приватна інструкція й точний контекст зберігаються в job, не повертаються загальним списком. SQLite-транзакція asset / completed job / event. Це не автоматичні approval, import, publish чи CANON. Явні review та перенесення Т7.5 зберігають generationContext.

Image edit — нова версія на основі вибраного власного поточного зображення, з приватним reference. Video edit — нова відеоверсія за першим кадром вибраного власного відео: FFmpeg витягує кадр у тимчасовій теці, provider генерує новий ролик; старий ролик і version chain залишаються. Це frame-conditioned remake, не довільне редагування всіх кадрів існуючого ролика. Runtime Docker додає FFmpeg; локальний executable перевіряється живим video тестом. FINAL / ARCHIVED, чужий parent і застаріла ревізія захищені.

## Перевірка

`npm run test:creative-ai`: справжні Express/SQLite/Core та byte storage, fake provider boundary (жодних платних запитів). `CORE_TEST_DATABASE_URL` — той самий прогін із ізольованим PostgreSQL. `--browser` — actual React / API, preview / підтвердження / job / mobile.

`npm run test:creative-ai-provider`: реальний Gemini dispatch та Leonardo adapter з HTTP stubs, приватний upload / submit / poll / bytes / usage без public file. Наявні image/video, Workspace/media/Bible regression, повний npm test, lint/build. Production Firebase, справжні провайдерні ключі / баланси, Docker rebuild і Railway limits — ручне приймання, не доведене HTTP stubs.

[Ручний сценарій Т7.7](docs/acceptance/T7.7.md).
