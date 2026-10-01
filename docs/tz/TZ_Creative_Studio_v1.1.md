# Fusion Lab Creative Studio

## Технічне завдання: маршрути автора та творчого фахівця, біржа, доступ до книги, Creative Workspace та візуальний канон

**Версія:** 1.0\
**Основна мова:** українська\
**Мета:** створити у Fusion Lab Studio середовище співпраці автора з
реальними творчими фахівцями --- дизайнерами, ілюстраторами,
фотографами, відеографами, 3D-художниками, верстальниками та іншими
виконавцями.

------------------------------------------------------------------------

# 0. Концепція

Creative Studio не є просто фриланс-біржею або файловим менеджером.
Замовлення має бути пов'язане з книгою, її персонажами, сценами,
локаціями, стилем, медіаматеріалами та контрольованими правами доступу.

Наскрізний процес:

`Автор → Бриф → Біржа → Вибір фахівця → Доступ до книги → Creative Workspace → Review → Media Library → Visual Bible`

Творчий фахівець --- **реальна людина**. AI є лише інструментом,
доступним відповідно до ролі, проєкту, дозволів і лімітів.

# 1. Принцип чесності

Для функцій використовувати машинні стани:

-   `AVAILABLE` --- доступно зараз;
-   `PLANNED` --- заплановано;
-   `IN_DEVELOPMENT` --- у розробці;
-   `BETA` --- тестовий режим;
-   `DISABLED` --- тимчасово вимкнено.

Недоступна функція не повинна мати CTA, що імітує реальну операцію.
Допустимі: **«Дізнатися більше»**, **«Повідомити про запуск»**.

# 2. Маршрут автора

## 2.1 Реєстрація

Автор використовує Fusion Lab Account. Після входу бачить доступні книги
та проєкти.

## 2.2 Вибір проєкту

Типи: книга, курс, навчальна програма, STEAM-проєкт, стартап, фізичний
продукт, інше.

## 2.3 Творчий бриф

Типи робіт: - обкладинка; - ілюстрація; - персонаж; - локація; - карта
світу; - предмет/артефакт; - буктрейлер; - промовідео; - матеріали для
соцмереж; - реклама; - верстка; - інше.

Поля: назва, опис, результат, формат, розміри, стиль, кількість
концептів, раунди правок, дедлайн, бюджет/умови, референси, AI policy,
вихідні файли.

Кнопка **«Допомогти скласти ТЗ»** може формувати AI-чернетку, але
публікація можлива лише після підтвердження автором.

## 2.4 Доступ до матеріалів

Автор явно обирає доступні частини, глави, сцени, персонажів, локації,
предмети, референси, Style Bible, Visual Bible та медіа.

## 2.5 Публікація

`DRAFT → MODERATION → OPEN`

## 2.6 Вибір фахівця

Автор порівнює заявки, портфоліо, термін і умови. Після вибору
створюється Creative Project.

## 2.7 Review

Автор переглядає версії, ставить pin-коментарі, просить правки та
затверджує результат. Автоматичного затвердження немає.

# 3. Маршрут творчого фахівця

## 3.1 Заявка

Поля: ім'я/псевдонім/студія, опис, країна, мови, спеціалізації,
посилання, приклади робіт.

Статуси:
`DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED / NEEDS_CHANGES / REJECTED`

## 3.2 Профіль

Аватар, bio, спеціалізації, портфоліо, послуги, мови, інструменти, умови
співпраці, доступність.

## 3.3 Заявка на замовлення

До вибору виконавця видно лише публічний бриф. Заявка містить
повідомлення, термін, умови та релевантні роботи.

## 3.4 Після вибору

Фахівець отримує доступ до Creative Project і лише до дозволеного
автором scope.

# 4. Біржа замовлень

**Маршрут:** `/creative/marketplace`

## 4.1 Мета

Каталог творчих завдань, пов'язаних із книгами та іншими проєктами
Fusion Lab.

## 4.2 Header

-   **Створити замовлення**
-   **Мої замовлення**
-   **Мої заявки**

## 4.3 Категорії

Обкладинки, ілюстрації, персонажі, локації, карти, відео, буктрейлери,
реклама, соцмережі, верстка, 3D, інше.

## 4.4 Фільтри

Категорія, тип проєкту, бюджет, дедлайн, мова, формат, статус, AI
policy.

## 4.5 Картка

Назва, тип роботи, короткий опис, тип проєкту, категорія, дедлайн,
бюджет/«договірний», кількість заявок, статус. Приватний зміст книги не
показувати.

## 4.6 Сторінка замовлення

Секції: завдання, результат, формати, стиль, термін, умови, публічні
референси, дозволена інформація про автора, форма заявки.

## 4.7 Статуси

`DRAFT`, `MODERATION`, `OPEN`, `SPECIALIST_SELECTED`, `IN_PROGRESS`,
`REVIEW`, `COMPLETED`, `CANCELLED`, `ARCHIVED`.

## 4.8 Межі

Не обіцяти escrow, утримання коштів, арбітраж або фінансові гарантії до
фактичної реалізації.

# 5. Доступ до книги

**Маршрут:** `/creative/access/[creativeProjectId]`

## 5.1 Мета

Granular access control до конкретних сутностей книги.

## 5.2 Дерево

`Книга → Частини → Глави → Сцени`, а також Персонажі, Локації, Предмети,
Референси, Visual Bible, Style Bible.

## 5.3 Рівні

-   `NONE`
-   `VIEW`
-   `COMMENT`
-   `WORK`
-   `MANAGE`

## 5.4 Правила

Права перевіряються сервером. Недоступна сутність не потрапляє в API,
realtime payload, AI context, пошук, export, prompt, preview чи
download.

## 5.5 Тимчасовий доступ

`valid_from`, `valid_until`, ручне відкликання, audit trail.

## 5.6 Least privilege

Фахівець не отримує всю книгу за замовчуванням. Початковий scope
формується лише з явно обраних автором матеріалів.

# 6. Creative Workspace

**Маршрут:** `/creative/workspace/[creativeProjectId]`

## 6.1 Вкладки

Огляд, Бриф, Матеріали, Роботи, Чат, Коментарі, Версії, AI Tools,
Учасники, Історія.

## 6.2 Desktop

Ліворуч: бриф, checklist, дозволені сутності, референси, Style Bible,
дедлайн.\
Центр: Canvas/Viewer --- image/video/PDF, zoom, fullscreen, порівняння.\
Праворуч: чат, pin-коментарі, статус, activity, review actions.

Mobile: колонки перетворюються на вкладки.

## 6.3 Workflow asset

`DRAFT → SUBMITTED_FOR_REVIEW → CHANGES_REQUESTED → RESUBMITTED → APPROVED → FINAL`

Додатково: `REJECTED`, `ARCHIVED`.

## 6.4 Pin-коментарі

Для зображення: координати x/y. Для відео: timecode. Поля: author, text,
status, created_at, resolved_at.

## 6.5 Версії

Side-by-side, before/after, overlay для зображень, history. Нова версія
не перезаписує попередню.

## 6.6 AI Tools

Приклади permissions: - `creative:image:generate` -
`creative:image:edit` - `creative:video:generate` -
`creative:assets:upload` - `creative:assets:download`

API-ключі провайдерів не передаються браузеру. AI context формується
лише з дозволених сутностей.

## 6.7 Чат

Текст, посилання, вкладення, згадування, системні події, unread state,
realtime, історія. Чат не замінює annotations.

# 7. Візуальна біблія

**Маршрут:** `/creative/bible/[bookId]`

## 7.1 Мета

Канонічне сховище затверджених образів і візуальних правил.

Media Library = **що створено**.\
Visual Bible = **що вважається правильним образом світу книги**.

## 7.2 Розділи

Персонажі, локації, предмети, костюми, транспорт, архітектура, істоти,
символи, палітри, обкладинки.

## 7.3 Персонаж

Ім'я, master image, ракурси, full body, profile, expressions, одяг,
візуальний вік, ключові ознаки, заборонені зміни, approved version,
provenance.

## 7.4 Canon

`APPROVED` у Workspace не дорівнює `CANON`. Потрібна окрема дія
**«Додати до візуального канону»** і відповідний permission.

# 8. Локації

Локації --- спеціалізований розділ Visual Bible.

## 8.1 Картка

Назва, опис, master image, контекст, час доби, сезон, архітектура,
освітлення, матеріали, кольори, погода, ключові об'єкти, заборонені
елементи, пов'язані сцени.

## 8.2 Ракурси

Establishing shot, entrance, interior, close view, aerial, day, night,
seasonal variants.

## 8.3 Continuity

Затверджені референси мають бути доступні дозволеним людям та
AI-інструментам для візуальної послідовності.

Зв'язки:
`location ↔ scenes ↔ chapters ↔ characters ↔ assets ↔ visual_rules`

# 9. Style Bible

**Маршрут:** `/creative/style/[bookId]`

## 9.1 Мета

Єдині візуальні правила книги для людей та AI.

## 9.2 Поля

Жанр, mood, visual tone, emotional tone, primary/secondary/accent
palette, prohibited colors, lighting, contrast, composition, framing,
camera distance, title safe zones, фотографічна/ілюстративна мова,
заборонені стилі.

## 9.3 AI

Style Bible може перетворюватися на структурований style context.
Користувач повинен бачити активний стиль та, за наявності права,
змінювати його для конкретної задачі.

## 9.4 Версії

Style Bible версіонується. Зміна правил не змінює автоматично вже
затверджені assets.

# 10. Media Library

**Маршрут:** `/creative/library/[projectId]`

## 10.1 Мета

Єдине сховище створених та завантажених творчих матеріалів.

## 10.2 Типи

`IMAGE`, `VIDEO`, `COVER`, `REFERENCE`, `DOCUMENT`, `AUDIO`,
`SOURCE_FILE`, `OTHER`.

## 10.3 Статуси

`DRAFT`, `REVIEW`, `APPROVED`, `REJECTED`, `CANON`, `ARCHIVED`.

## 10.4 Метадані

`asset_id`, `project_id`, `book_id`, `creative_project_id`, `type`,
`title`, `created_by`, `created_at`, `source`, `status`, `version`,
`parent_asset_id`, `character_ids[]`, `location_ids[]`, `scene_ids[]`,
`tags[]`.

Для AI: provider, model, generation_id, prompt_reference,
generation_settings. Секретні credentials не зберігаються в metadata.

## 10.5 Фільтри

Тип, статус, персонаж, локація, сцена, автор, дата, Creative Project,
AI/manual, tags.

## 10.6 Provenance

Система повинна показати: хто створив asset, де, коли, на основі яких
сутностей, чи використовувався AI, яка версія затверджена та хто додав
її до Visual Bible.

# 11. Наскрізний сценарій

## Приклад: обкладинка книги

1.  Автор працює у Writer Studio.
2.  Story Core містить персонажів, сцени, локації та референси.
3.  Автор натискає **«Замовити творчу роботу»**.
4.  Створює бриф «Обкладинка містичного роману».
5.  Визначає scope: Софія --- WORK; Марк --- WORK; Італійський дворик
    --- WORK; сцена кафе --- VIEW; Style Bible --- VIEW; таємниця Софії
    --- NONE.
6.  Замовлення публікується на біржі після запуску цього модуля.
7.  Фахівці надсилають заявки.
8.  Автор обирає дизайнера.
9.  Створюються Creative Project і Workspace.
10. Дизайнер отримує лише дозволений контекст.
11. Дизайнер завантажує роботу або використовує дозволені AI tools.
12. Asset переходить `DRAFT → SUBMITTED_FOR_REVIEW`.
13. Автор ставить pin-коментарі.
14. Дизайнер створює Version 2.
15. Автор затверджує результат.
16. Файл потрапляє в Media Library.
17. Автор окремо натискає **«Додати до Visual Bible»**.
18. Asset стає канонічним референсом для дозволених наступних робіт.

# 12. Логічна модель даних

Перед реалізацією назви потрібно зіставити з чинною схемою репозиторію,
щоб не створювати дублікати.

### CreativeOrder

`id, owner_id, source_project_id, book_id, type, title, description, budget_type, budget_min, budget_max, deadline, status, ai_policy, created_at, updated_at`

### CreativeApplication

`id, order_id, specialist_id, message, proposed_deadline, terms, status, created_at`

### CreativeProject

`id, order_id, owner_id, specialist_id, source_project_id, book_id, status, started_at, completed_at`

### CreativeAccessGrant

`id, creative_project_id, user_id, resource_type, resource_id, permission, valid_from, valid_until, created_by, created_at, revoked_at`

### CreativeAsset

`id, creative_project_id, media_asset_id, parent_asset_id, version, status, created_by, created_at`

### CreativeAnnotation

`id, asset_id, author_id, x, y, timecode, text, status, created_at, resolved_at`

### VisualCanonEntry

`id, book_id, entity_type, entity_id, asset_id, canon_type, approved_by, approved_at, version`

### StyleBible

`id, book_id, version, status, rules_json, created_by, created_at, approved_at`

# 13. Безпека

1.  Права перевіряються server-side.
2.  AI не отримує контент поза дозволеним scope.
3.  Provider API keys не передаються клієнту.
4.  Приватні download URL авторизовані/тимчасові.
5.  Зміни доступу журналюються.
6.  Видалений учасник втрачає подальший доступ.
7.  Не обіцяти відкликання локальної копії, яку користувач уже законно
    завантажив.
8.  Приватні матеріали не індексуються публічним пошуком.
9.  Canon змінює лише уповноважений користувач.
10. Службовий доступ до приватних даних аудитований.

# 14. Рекомендовані маршрути

``` text
/creative
/creative/marketplace
/creative/marketplace/[orderId]
/creative/orders/new
/creative/access/[creativeProjectId]
/creative/workspace/[creativeProjectId]
/creative/library/[projectId]
/creative/bible/[bookId]
/creative/style/[bookId]
/creative/specialists/[specialistId]
/account/creative
/account/creative/orders
/account/creative/applications
/admin/creative
```

Фактичні URL необхідно узгодити з чинною i18n/routing-конвенцією Fusion
Lab.

# 15. Етапи реалізації

1.  **Foundation** --- feature statuses, ролі, профіль фахівця, Creative
    Project, server-side access.
2.  **Бриф і доступ** --- brief builder, scope, access grants, audit.
3.  **Біржа** --- orders, catalog, applications, specialist selection.
4.  **Workspace** --- upload, viewer, versions, review, annotations,
    chat, realtime.
5.  **Media Library** --- assets, metadata, filters, provenance, version
    chains.
6.  **Visual Bible** --- персонажі, локації, canon, Style Bible, Story
    Core links.
7.  **AI Tools** --- image/video generation, editing, limits, provider
    abstraction, allowed context.

# 16. Критерії приймання

-   Автор може створити бриф і прив'язати його до книги.
-   Автор може вибрати конкретні сутності книги для доступу.
-   Заборонена сутність недоступна через UI і прямий API.
-   Фахівець може подати заявку на замовлення.
-   Автор може обрати фахівця.
-   Створюється Creative Project.
-   Workspace показує лише дозволені матеріали.
-   Фахівець може створювати нові asset versions.
-   Автор може коментувати та вимагати зміни.
-   Попередні версії не втрачаються.
-   Автор може затвердити результат.
-   Результат зберігається в Media Library.
-   Додавання до Visual Bible є окремою контрольованою дією.
-   AI не отримує прихований контент.
-   Критичні зміни доступу й канону мають audit trail.
-   Публічний UI не обіцяє неіснуючий функціонал.

# 17. Ключовий принцип

Fusion Lab Creative Studio повинна знати не просто **де лежить файл**,
а:

**хто його створив → для якої книги → для якої сцени/персонажа/локації →
на основі яких дозволених даних → у якій версії → хто затвердив → чи
став матеріал частиною візуального канону.**

Це і є головний зв'язок між Writer Studio, реальними творчими фахівцями,
Media Library, Visual Bible та контрольованими AI-інструментами.
