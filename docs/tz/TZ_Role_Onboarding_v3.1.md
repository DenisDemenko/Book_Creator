# Fusion Lab Studio --- Role Onboarding & Studio Entry

## ТЗ на опитувальник ролі перед входом у Studio з Marketplace

**Версія:** 3.1\
**Дата:** 2026-09-30\
**Проєкт:** Fusion Lab Studio / Marketplace / Writer Studio / Course
Studio\
**Зв'язок:** доповнення до архітектури Graph Studio + Collaboration
Graph v3

------------------------------------------------------------------------

# 1. Мета

Перед першим переходом користувача з Marketplace (Маркетплейсу) до
Studio (Студії), перед створенням/імпортом проєкту або після долучення
через біржу система повинна визначити:

-   хто користувач у межах конкретного проєкту;
-   з якою метою він входить;
-   яку роль або ролі виконує;
-   до якого типу проєкту долучається;
-   чи створює власний проєкт, чи входить до чужого;
-   який початковий workspace (робочий простір) йому показати;
-   який доступ він має або повинен запросити;
-   який AI Workflow Profile (Профіль робочого процесу ШІ)
    запропонувати.

Процес: **Role Onboarding (Визначення ролі під час входу).**

------------------------------------------------------------------------

# 2. Архітектурний принцип

Не використовувати одну глобальну професійну роль:

``` text
User.role = WRITER
```

Роль контекстна:

``` text
User (Користувач)
  ↓
Project Participation (Участь у проєкті)
  ↓
Role Assignment (Призначення ролі)
```

Одна людина може бути:

``` text
Book A → AUTHOR (Автор) + OWNER (Власник)
Book B → CO_AUTHOR (Співавтор)
Course C → COURSE_AUTHOR (Автор курсу)
Project D → DESIGNER (Дизайнер)
```

В одному проєкті дозволяється кілька ролей.

------------------------------------------------------------------------

# 3. Точки запуску

Role Onboarding запускається:

1.  перший `Marketplace → Studio`;
2.  `Create Project (Створити проєкт)`;
3.  `Import Project (Імпортувати проєкт)`;
4.  `Open in Studio (Відкрити у Студії)`, якщо project role ще не
    визначена;
5.  прийняття запрошення, якщо остаточна роль не задана;
6.  прийняття Freelance Order (Фріланс-замовлення);
7.  перший вхід у новий тип Studio, якщо потрібні додаткові параметри.

Повний wizard (майстер налаштування) не показувати при кожному вході.

------------------------------------------------------------------------

# 4. Entry Gate (Шлюз входу)

``` text
Marketplace (Маркетплейс)
        ↓
Open / Create / Import in Studio
(Відкрити / створити / імпортувати)
        ↓
ROLE KNOWN FOR PROJECT?
(Роль у проєкті відома?)
       / \
     YES  NO
      │    ↓
      │  ROLE ONBOARDING
      │  (Визначення ролі)
      │    ↓
      │  ACCESS RESOLUTION
      │  (Визначення доступу)
      └────┤
           ▼
      STUDIO ENTRY
      (Вхід у Студію)
```

------------------------------------------------------------------------

# 5. Step 1 --- Project Type (Тип проєкту)

Питання: **What are you going to work on? (Над чим ви будете
працювати?)**

``` text
BOOK (Книга)
COURSE (Курс)
EDUCATIONAL_PROGRAM (Освітня програма)
ILLUSTRATION_PROJECT (Проєкт ілюстрацій)
DESIGN_PROJECT (Дизайн-проєкт)
OTHER (Інше)
```

Список має бути registry-driven (керованим реєстром).

------------------------------------------------------------------------

# 6. Step 2 --- Entry Intent (Мета входу)

**How are you joining this project? (Як ви долучаєтесь до цього
проєкту?)**

``` text
CREATE_OWN_PROJECT (Створюю власний проєкт)
JOIN_EXISTING_PROJECT (Долучаюсь до наявного проєкту)
ACCEPT_INVITATION (Приймаю запрошення)
FULFILL_FREELANCE_ORDER (Виконую фріланс-замовлення)
MANAGE_OR_SELL (Керую або займаюся продажем)
REVIEW_OR_EDIT (Перевіряю або редагую)
OTHER (Інше)
```

------------------------------------------------------------------------

# 7. Step 3 --- Role Selection (Вибір ролі)

**What is your role in this project? (Яка ваша роль у цьому проєкті?)**

Підтримати `Multi-select (Множинний вибір)`.

## Writing Roles (Письменницькі ролі)

``` text
AUTHOR (Автор / письменник)
CO_AUTHOR (Співавтор)
GHOSTWRITER (Літературний автор на замовлення)
SCREENWRITER (Сценарист)
COURSE_AUTHOR (Автор курсу)
CONTENT_AUTHOR (Автор контенту)
```

## Editorial Roles (Редакторські ролі)

``` text
EDITOR (Редактор)
LITERARY_EDITOR (Літературний редактор)
PROOFREADER (Коректор)
LITERARY_CRITIC (Літературний критик)
FACT_CHECKER (Фактчекер)
REVIEWER (Рецензент)
```

## Visual & Creative Roles (Візуальні та творчі ролі)

``` text
DESIGNER (Дизайнер)
BOOK_DESIGNER (Дизайнер книги)
ILLUSTRATOR (Ілюстратор)
COVER_DESIGNER (Дизайнер обкладинки)
LAYOUT_DESIGNER (Верстальник)
PHOTOGRAPHER (Фотограф)
VIDEO_CREATOR (Автор відео)
ANIMATOR (Аніматор)
```

## Language Roles (Мовні ролі)

``` text
TRANSLATOR (Перекладач)
LOCALIZATION_SPECIALIST (Спеціаліст з локалізації)
```

## Management & Commercial Roles (Управлінські та комерційні ролі)

``` text
PROJECT_OWNER (Власник проєкту)
PROJECT_MANAGER (Менеджер проєкту)
BOOK_MANAGER (Менеджер книги)
COURSE_MANAGER (Менеджер курсу)
SALES_MANAGER (Менеджер з продажу)
MARKETING_MANAGER (Маркетинговий менеджер)
PUBLISHER (Видавець)
```

## Technical Roles (Технічні ролі)

``` text
DEVELOPER (Програміст / розробник)
WEB_DEVELOPER (Веброзробник)
AI_SPECIALIST (Спеціаліст із ШІ)
TECHNICAL_SPECIALIST (Технічний спеціаліст)
```

## Marketplace Role (Роль на біржі)

``` text
FREELANCER (Фрілансер)
```

`FREELANCER` є типом участі, а не достатнім описом професії. Після нього
обов'язково уточнити спеціалізацію, наприклад
`FREELANCER + ILLUSTRATOR`, `DESIGNER`, `EDITOR`, `TRANSLATOR`,
`DEVELOPER`.

------------------------------------------------------------------------

# 8. Step 4 --- Role Details (Параметри ролі)

Показувати лише релевантні питання.

**AUTHOR / CO_AUTHOR:** Whole Book (Уся книга), Chapters (Розділи),
Scenes (Сцени), Characters (Персонажі), Story Structure (Структура
історії).

**ILLUSTRATOR:** Character Illustrations (Ілюстрації персонажів), Scene
Illustrations (Ілюстрації сцен), Maps (Карти), Diagrams (Схеми), Cover
Art (Зображення для обкладинки).

**DESIGNER:** Cover (Обкладинка), Book Layout (Дизайн/верстка), Visual
Identity (Візуальна айдентика), Promotional Materials (Рекламні
матеріали), Course Design (Дизайн курсу).

**MANAGER:** Publication (Публікація), Sales (Продажі), Marketing
(Маркетинг), Marketplace Listings (Картки товарів), Team Coordination
(Координація команди).

**DEVELOPER:** Web (Веб), Integration (Інтеграції), AI (ШІ), Automation
(Автоматизація), Interactive Content (Інтерактивний контент).

------------------------------------------------------------------------

# 9. Step 5 --- Project Scope (Область роботи)

Роль не дає автоматичного доступу до всього проєкту.

``` text
WHOLE_PROJECT (Увесь проєкт)
SELECTED_BOOK (Обрана книга)
SELECTED_COURSE (Обраний курс)
SELECTED_CHAPTERS (Обрані розділи)
SELECTED_SCENES (Обрані сцени)
SELECTED_CHARACTERS (Обрані персонажі)
MEDIA_LIBRARY (Медіатека)
VISUAL_BIBLE (Візуальна біблія)
MARKETING_DATA (Маркетингові дані)
ASSIGNED_TASKS_ONLY (Лише призначені завдання)
```

------------------------------------------------------------------------

# 10. Step 6 --- Requested Capabilities (Запитувані можливості)

``` text
VIEW (Перегляд)
COMMENT (Коментування)
CREATE (Створення)
EDIT (Редагування)
UPLOAD (Завантаження файлів)
REVIEW (Перевірка)
PROPOSE (Пропонування змін)
APPROVE (Схвалення)
PUBLISH (Публікація)
MANAGE (Керування)
```

Для чужого проєкту формується `Access Request (Запит доступу)`. Власник
або уповноважений менеджер підтверджує, змінює або відхиляє його.

------------------------------------------------------------------------

# 11. Step 7 --- AI Assistance Preferences (Налаштування допомоги ШІ)

Опційно.

**Author (Автор):** Story Analysis (Аналіз історії), Character Analysis
(Аналіз персонажів), Continuity Check (Перевірка безперервності),
Editing Suggestions (Пропозиції редагування), Idea Generation (Генерація
ідей).

**Illustrator (Ілюстратор):** Scene Context (Контекст сцени), Character
References (Референси персонажів), Visual Bible (Візуальна біблія),
Prompt Assistance (Допомога з промптами).

**Manager (Менеджер):** Book Metadata (Метадані книги), Product
Description (Опис товару), Marketing Copy (Маркетинговий текст),
Publication Checklist (Чекліст публікації).

Це налаштовує `AI Workflow Profile (Профіль процесу ШІ)`, але ніколи не
розширює Access Grant (Наданий доступ).

------------------------------------------------------------------------

# 12. Confirmation Screen (Екран підтвердження)

Показати:

``` text
PROJECT (Проєкт)
PROJECT TYPE (Тип проєкту)
YOUR ROLES (Ваші ролі)
WORK SCOPE (Область роботи)
ACCESS (Доступ)
AI ASSISTANCE (Допомога ШІ)
```

Кнопки:

``` text
BACK (Назад)
EDIT (Змінити)
CONTINUE TO STUDIO (Перейти до Студії)
REQUEST ACCESS (Запросити доступ)
```

------------------------------------------------------------------------

# 13. Collaboration Graph (Граф співпраці)

Результат onboarding:

``` text
PERSON (Людина)
  ↓
PARTICIPANT (Учасник)
  ↓ HAS_ROLE (Має роль)
ROLE (Роль)
```

``` text
PARTICIPANT
  ↓ PARTICIPATES_IN (Бере участь у)
PROJECT (Проєкт)
```

Після схвалення:

``` text
PARTICIPANT
  ↓ HAS_ACCESS (Має доступ)
RESOURCE / SCOPE (Ресурс / область)
```

------------------------------------------------------------------------

# 14. Marketplace → Studio (Маркетплейс → Студія)

``` text
MARKETPLACE ITEM / ORDER
(Товар / замовлення)
        ↓
OPEN IN STUDIO
(Відкрити у Студії)
        ↓
IDENTIFY PROJECT
(Визначити проєкт)
        ↓
IDENTIFY PARTICIPANT
(Визначити учасника)
        ↓
ROLE ONBOARDING
(Визначення ролі)
        ↓
ACCESS CHECK
(Перевірка доступу)
        ↓
ROLE-AWARE STUDIO
(Студія з урахуванням ролі)
```

Для Freelance Order передавати `order_id` у onboarding context.

------------------------------------------------------------------------

# 15. Role-Aware Studio (Студія з урахуванням ролі)

**AUTHOR:** Text Editor (Редактор тексту), Story Board (Дошка історії),
Characters (Персонажі), Story Graph (Граф твору), AI Analysis (Аналіз
ШІ).

**ILLUSTRATOR:** Assigned Tasks (Призначені завдання), Scene References
(Референси сцен), Character References (Референси персонажів), Visual
Bible (Візуальна біблія), Creative Workspace (Творчий простір),
Deliverables (Результати).

**DESIGNER:** Design Tasks (Дизайнерські завдання), Book Layout (Макет
книги), Cover (Обкладинка), Assets (Матеріали), Visual Bible.

**MANAGER:** Project Status (Стан проєкту), Publication (Публікація),
Marketplace Listings (Картки Marketplace), Marketing (Маркетинг), Tasks
(Завдання).

**DEVELOPER:** Technical Tasks (Технічні завдання), Assigned Resources
(Призначені ресурси), Integrations (Інтеграції), Files/Specifications
(Файли/специфікації).

UI adaptation не є механізмом безпеки. Permissions перевіряти
server-side.

------------------------------------------------------------------------

# 16. Course Studio (Студія курсів)

Для `COURSE` підтримати:

``` text
COURSE_AUTHOR (Автор курсу)
CO_AUTHOR (Співавтор)
INSTRUCTIONAL_DESIGNER (Методист / проєктувальник навчання)
DESIGNER (Дизайнер)
VIDEO_CREATOR (Автор відео)
EDITOR (Редактор)
TRANSLATOR (Перекладач)
COURSE_MANAGER (Менеджер курсу)
MARKETING_MANAGER (Маркетинговий менеджер)
DEVELOPER (Розробник)
```

Role Registry повинен зв'язувати роль з одним або кількома Project Types
(Типами проєктів).

------------------------------------------------------------------------

# 17. Data Model (Модель даних)

``` text
RoleDefinition (Визначення ролі)
ProjectParticipant (Учасник проєкту)
ParticipantRole (Роль учасника)
OnboardingSession (Сесія опитувальника)
AccessRequest (Запит доступу)
AccessGrant (Наданий доступ)
ParticipantPreference (Налаштування учасника)
```

``` yaml
ProjectParticipant:
  id:
  project_id:
  user_id:
  status:
  source:
  created_at:
  updated_at:
```

``` yaml
ParticipantRole:
  participant_id:
  role_id:
  specialization:
  status:
  assigned_by:
  created_at:
```

``` yaml
OnboardingSession:
  id:
  user_id:
  project_id:
  project_type:
  entry_intent:
  source:
  source_order_id:
  current_step:
  status:
  answers:
  completed_at:
```

------------------------------------------------------------------------

# 18. Role Registry (Реєстр ролей)

Не хардкодити ролі у багатьох frontend-компонентах.

``` yaml
id: illustrator
label:
  uk: Ілюстратор
  en: Illustrator
project_types:
  - book
  - course
category: visual_creative
default_workspace: creative
suggested_capabilities:
  - view
  - comment
  - create
  - upload
  - propose
ai_profile: illustrator_default
active: true
```

------------------------------------------------------------------------

# 19. Role ≠ Permission (Роль не дорівнює дозволу)

``` text
ROLE (Роль)
   ↓ suggests (пропонує)
CAPABILITY TEMPLATE (Шаблон можливостей)
```

Фактичний доступ:

``` text
PARTICIPANT + PROJECT + ROLE + RESOURCE SCOPE + ACCESS GRANT
=
EFFECTIVE PERMISSIONS (Фактичні дозволи)
```

Ілюстратор не отримує автоматично доступ до всього неопублікованого
рукопису.

------------------------------------------------------------------------

# 20. Owner Approval (Підтвердження власником)

``` text
ROLE ONBOARDING
      ↓
ACCESS REQUEST
      ↓
PROJECT OWNER / MANAGER
      ↓
APPROVE / MODIFY / REJECT
(Схвалити / Змінити / Відхилити)
      ↓
ACCESS GRANT
(Наданий доступ)
```

Якщо валідне Invitation або Freelance Order уже містить роль і scope, не
вимагати зайвого повторного схвалення.

------------------------------------------------------------------------

# 21. AI Workflow Graph (Граф робочого процесу ШІ)

``` text
Participant Role (Роль)
       +
Project Type (Тип проєкту)
       +
Task (Завдання)
       +
Access Scope (Область доступу)
       ↓
AI WORKFLOW ROUTER
(Маршрутизатор процесів ШІ)
```

Приклади:

``` text
AUTHOR → Writer Workflow (Письменницький процес)
ILLUSTRATOR → Illustration Workflow (Процес ілюстратора)
EDITOR → Editorial Workflow (Редакторський процес)
MANAGER → Publishing Workflow (Процес публікації)
DEVELOPER → Technical Workflow (Технічний процес)
```

Router не може розширювати Effective Permissions.

------------------------------------------------------------------------

# 22. Jev Decision Layer (Шар рішень Jev)

Jev/Rule Router може допомагати визначити релевантний workspace,
наприклад для `DESIGNER + BOOK + FREELANCE_ORDER`:

``` text
COVER DESIGN (Дизайн обкладинки)
BOOK LAYOUT (Верстка книги)
ILLUSTRATION (Ілюстрація)
MARKETING DESIGN (Маркетинговий дизайн)
```

Jev не має права самостійно створювати Access Grant.

------------------------------------------------------------------------

# 23. Change Role (Зміна ролі)

Сторінка/блок:

**My Role in Project (Моя роль у проєкті)**

``` text
ADD ROLE (Додати роль)
REMOVE ROLE (Відмовитися від ролі)
REQUEST NEW ROLE (Запросити нову роль)
CHANGE SPECIALIZATION (Змінити спеціалізацію)
```

У чужому проєкті зміна ролі не розширює права автоматично.

------------------------------------------------------------------------

# 24. Skip Logic (Логіка пропуску)

Не питати те, що вже достовірно відомо.

``` text
Invitation:
role = ILLUSTRATOR
scope = Scene 17
```

Показати коротке підтвердження замість повного wizard.

------------------------------------------------------------------------

# 25. Save & Resume (Зберегти та продовжити)

OnboardingSession зберігати після кожного кроку.

``` text
SAVE DRAFT (Зберегти чернетку)
RESUME (Продовжити)
CANCEL (Скасувати)
```

Незавершений onboarding не створює production Access Grant.

------------------------------------------------------------------------

# 26. UX-вимоги

-   Desktop + Mobile.
-   Компактний wizard.
-   Progress Indicator (Індикатор прогресу).
-   Короткий опис кожної ролі.
-   Пошук ролі.
-   `Other (Інше)` + текстове поле.
-   Multi-select.
-   Back без втрати даних.
-   українська --- базова;
-   англійська --- повна локалізація;
-   не показувати технічні permission IDs;
-   перед завершенням показувати Summary (Підсумок).

------------------------------------------------------------------------

# 27. UI першого екрану

``` text
┌──────────────────────────────────────────────┐
│ Fusion Lab Studio                            │
│                                              │
│ Як ви будете працювати над цим проєктом?     │
│                                              │
│  [✍] Автор / письменник                      │
│  [👥] Співавтор                              │
│  [🎨] Дизайнер                               │
│  [🖼] Ілюстратор                             │
│  [✎] Редактор                               │
│  [🌐] Перекладач                             │
│  [📈] Менеджер / продажі                     │
│  [💻] Програміст / розробник                 │
│  [🧰] Фрілансер                              │
│  [＋] Інша роль                              │
│                                              │
│                [Продовжити →]                │
└──────────────────────────────────────────────┘
```

------------------------------------------------------------------------

# 28. Analytics (Аналітика)

``` text
onboarding_started
onboarding_step_completed
role_selected
role_changed
onboarding_completed
onboarding_abandoned
access_requested
access_approved
access_rejected
studio_entered
```

------------------------------------------------------------------------

# 29. Acceptance Criteria (Критерії приймання)

1.  Marketplace → Studio запускає onboarding, якщо project role
    невідома.
2.  Можна вибрати одну або кілька ролей.
3.  Мінімум Book + Course.
4.  Role Registry конфігурований, не дублюється по frontend.
5.  Freelancer вимагає спеціалізації.
6.  Ролі контекстні для проєкту.
7.  Кілька ролей в одному проєкті підтримуються.
8.  Role не дорівнює Permission.
9.  Для чужого проєкту підтримується Access Request.
10. Owner/Manager: Approve/Modify/Reject.
11. Illustrator не отримує весь manuscript автоматично.
12. Invitation підтримує Skip Logic.
13. Freelance Order передає order context.
14. Onboarding підтримує Save/Resume.
15. Незавершений onboarding не створює production access.
16. Створюється/оновлюється ProjectParticipant.
17. Ролі потрапляють у Collaboration Graph.
18. Access Grants зберігаються окремо.
19. Studio Dashboard адаптується до ролі.
20. Backend незалежно перевіряє permissions.
21. AI Router враховує роль.
22. AI/Jev не розширюють Access Grant.
23. Додаткову роль можна запросити пізніше.
24. Зміна ролі не дає автоматично нових прав.
25. Registry має UA/EN labels.
26. Mobile підтримується.
27. Role/access changes мають audit events.
28. Onboarding analytics не змішується зі Story Canon.
29. Story Ontology не забруднюється ролями реальних людей.
30. Collaboration Ontology пов'язується зі Story Core через Cross-Domain
    Links.

------------------------------------------------------------------------

# 30. Місце в архітектурі

``` text
                    MARKETPLACE
                    (Маркетплейс)
                         │
                         ▼
                  ROLE ONBOARDING
               (Визначення ролі)
                         │
             ┌───────────┼───────────┐
             ▼           ▼           ▼
          ROLE        PROJECT      INTENT
         (Роль)      (Проєкт)    (Мета входу)
             └───────────┼───────────┘
                         ▼
                COLLABORATION GRAPH
                  (Граф співпраці)
                         │
                         ▼
                  ACCESS RESOLUTION
                 (Визначення доступу)
                         │
                         ▼
                  ROLE-AWARE STUDIO
             (Студія з урахуванням ролі)
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
           WRITER     CREATIVE    COURSE
           STUDIO      STUDIO      STUDIO
              │          │          │
              └──────────┼──────────┘
                         ▼
                  AI WORKFLOW GRAPH
              (Граф робочого процесу ШІ)
                         │
                         ▼
                     STORY CORE
                (Семантичне ядро)
```

------------------------------------------------------------------------

# 31. Висновок

`Role Onboarding (Визначення ролі під час входу)` є мостом:

``` text
Marketplace
→ Collaboration Ontology
→ Access Control
→ Role-Aware Studio
→ AI Orchestration
```

Він не додає реального дизайнера, менеджера, програміста чи фрілансера
до Story Ontology (Онтології твору).

Ролі реальних людей належать до Collaboration Ontology (Онтології
співпраці), а їхня робота пов'язується зі Story Graph через Tasks
(Завдання), Contributions (Внески), Deliverables (Результати роботи),
Assets (Матеріали) та Cross-Domain Links (Міждоменні зв'язки).
