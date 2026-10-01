# Fusion Lab Graph Studio

## Розширене технічне завдання: Story Ontology, AI Workflow, Story Graph та AI Decision & Orchestration Layer

**Версія:** 3.0\
**Дата:** 2026-09-29\
**Проєкт:** Fusion Lab Studio / Writer Studio\
**Статус:** технічне завдання для розробки

------------------------------------------------------------------------

# 0. Мовне правило документа

У коді, API, базі даних та machine-readable схемах використовуються
стабільні англійські ідентифікатори.

У документації та UI кожна основна логічна дефініція повинна подаватися
у форматі:

``` text
English Definition (Український переклад)
```

Наприклад:

``` text
Ontology Graph (Граф онтології)
AI Workflow Graph (Граф робочого процесу ШІ)
Story Graph (Граф твору)
Human Review (Перевірка людиною)
Canon Write (Запис у канон)
```

Український переклад є UI/documentation label і не повинен змінювати
стабільний machine ID.

------------------------------------------------------------------------

# 1. Мета системи

Створити у Fusion Lab Studio керовану графову архітектуру, яка дозволяє:

1.  керувати структурою семантичного ядра;
2.  оркеструвати AI без обов'язкової залежності від DeepSeek Harness;
3.  використовувати LangGraph як execution runtime;
4.  використовувати Jev як спеціалізований Decision Engine (Механізм
    прийняття рішень);
5.  відображати фактичну семантичну модель конкретного твору;
6.  змінювати параметри AI-поведінки через Graph Studio без
    переписування orchestration-коду;
7.  розвивати початкові 118 типів сутностей як versioned ontology
    (версійовану онтологію);
8.  забезпечити Human Review (Перевірку людиною) перед критичними
    змінами Canon (Канону);
9.  зберігати provenance (походження даних), версії, confidence
    (впевненість), рішення та авторські виправлення.

------------------------------------------------------------------------

# 2. Базовий open-source код

## 2.1 LangGraph-GUI

**Repository (Репозиторій):** `LangGraph-GUI/LangGraph-GUI`\
**GitHub:** `https://github.com/LangGraph-GUI/LangGraph-GUI`

``` bash
git clone --recurse-submodules https://github.com/LangGraph-GUI/LangGraph-GUI.git
cd LangGraph-GUI
```

Рекомендоване розташування reference code (еталонного коду):

``` text
/tools/langgraph-gui-reference/
```

або:

``` text
/vendor/langgraph-gui/
```

Розробник повинен зафіксувати конкретний commit/tag upstream.

LangGraph-GUI використовувати як reference implementation (еталонну
реалізацію) / можливу основу node-edge editor (редактора вузлів і
зв'язків), але не змішувати upstream-код з доменною логікою Fusion Story
Core.

## 2.2 Jev

**Repository (Репозиторій API):** `jev-ai/jev-api`\
**GitHub:** `https://github.com/jev-ai/jev-api`

Jev інтегрувати як Decision Engine (Механізм прийняття рішень), а не як
заміну LangGraph або генеративної LLM.

Перед production integration (виробничою інтеграцією) розробник повинен
перевірити актуальний API, ліцензію, версію та зафіксувати dependency
version (версію залежності).

------------------------------------------------------------------------

# 3. Чотири рівні архітектури

``` text
                         FUSION LAB STUDIO
                                │
                                ▼
                         GRAPH STUDIO UI
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
 ONTOLOGY GRAPH          AI WORKFLOW GRAPH       STORY GRAPH
 (Граф онтології)        (Граф процесу ШІ)       (Граф твору)
          │                     │                     ▲
          ▼                     ▼                     │
 SCHEMA REGISTRY            LANGGRAPH                 │
 (Реєстр схем)          (Runtime оркестрації)         │
          │                     │                     │
          │          ┌──────────┼──────────┐          │
          │          ▼          ▼          ▼          │
          │         LLM        JEV       TOOLS        │
          │     (генерація) (рішення) (інструменти)  │
          │          └──────────┼──────────┘          │
          │                     ▼                     │
          │               VALIDATION                  │
          │                (Перевірка)                │
          │                     │                     │
          └──────────────┬──────┴─────────────────────┘
                         ▼
                    STORY CORE API
                         │
                         ▼
                     PostgreSQL
```

Ролі:

-   **Ontology Graph (Граф онтології)** --- визначає, що система здатна
    зберігати.
-   **AI Workflow Graph (Граф робочого процесу ШІ)** --- визначає, як
    система обробляє дані.
-   **Story Graph (Граф твору)** --- показує, що фактично існує у
    конкретному творі.
-   **Decision Layer (Шар прийняття рішень)** --- Jev та інші типізовані
    механізми приймають вузькі рішення всередині workflow.

------------------------------------------------------------------------

# 4. Ontology Graph (Граф онтології)

## 4.1 Призначення

Керує Fusion Story Ontology (Онтологією твору Fusion).

Початкова версія:

``` text
Fusion Story Ontology v1.0
118 Entity Types (118 типів сутностей)
Relation Types (типи зв'язків) — імпортувати з чинного реєстру
```

118 типів --- стартова версія, а не незмінна межа.

## 4.2 Node Types (Типи вузлів)

``` text
ENTITY_TYPE       (Тип сутності)
RELATION_TYPE     (Тип зв'язку)
PROPERTY          (Властивість)
ENUM              (Перелік значень)
VALIDATION_RULE   (Правило перевірки)
ENTITY_GROUP      (Група сутностей)
UI_SCHEMA         (Схема інтерфейсу)
AI_SCHEMA         (Схема ШІ)
```

## 4.3 Приклад

``` text
CHARACTER (Персонаж)
       │
       │ HAS_GOAL (Має ціль)
       ▼
GOAL (Ціль)
       │
       │ MOTIVATES (Мотивує)
       ▼
DECISION (Рішення)
       │
       │ CAUSES (Спричиняє)
       ▼
EVENT (Подія)
```

## 4.4 Schema Registry (Реєстр схем)

Registry зберігає:

-   Entity Definition (Визначення сутності);
-   Relation Definition (Визначення зв'язку);
-   Property Definition (Визначення властивості);
-   Validation Rule (Правило перевірки);
-   UI Metadata (Метадані інтерфейсу);
-   AI Metadata (Метадані ШІ);
-   Schema Version (Версію схеми).

## 4.5 Lifecycle (Життєвий цикл)

``` text
EDIT (Редагування)
  ↓
DRAFT (Чернетка)
  ↓
VALIDATE (Перевірити)
  ↓
PREVIEW (Попередній перегляд)
  ↓
MIGRATION IMPACT (Вплив зміни)
  ↓
PUBLISH (Опублікувати)
  ↓
ACTIVE (Активна)
```

Обов'язково:

``` text
ROLLBACK (Відкат)
DEPRECATED (Застаріла)
ARCHIVED (Архівна)
```

Destructive Delete (Руйнівне видалення) типів із наявними даними
заборонити.

------------------------------------------------------------------------

# 5. AI Workflow Graph (Граф робочого процесу ШІ)

## 5.1 Призначення

Центральний візуальний orchestration layer (шар оркестрації).

``` text
MANUSCRIPT (Рукопис)
      ↓
EXTRACT ENTITIES (Виділити сутності)
      ↓
CLASSIFY (Класифікувати)
      ↓
ANALYZE (Проаналізувати)
      ↓
DECISION (Прийняти рішення)
      ↓
VALIDATE (Перевірити)
      ↓
HUMAN REVIEW (Перевірка людиною)
      ↓
CANON WRITE (Запис у канон)
```

## 5.2 Основні Node Types (Типи вузлів)

``` text
START             (Початок)
LLM               (Велика мовна модель)
AGENT             (Агент)
PROMPT            (Інструкція для моделі)
CONTEXT           (Контекст)
QUERY             (Запит)
TOOL              (Інструмент)
CONDITION         (Умова)
MEMORY            (Пам'ять)
VALIDATOR         (Перевіряльник)
HUMAN_REVIEW      (Перевірка людиною)
PROPOSAL          (Пропозиція)
CANON_WRITE       (Запис у канон)
SUBGRAPH          (Підграф)
END               (Завершення)
```

## 5.3 Налаштовувані параметри

``` yaml
model_provider:
model:
temperature:
max_tokens:
timeout:
retry_count:
system_prompt:
context_policy:
output_schema:
entity_scope:
relation_scope:
confidence_policy:
cost_limit:
```

Зміна параметрів повинна бути можлива у Graph Studio без зміни
orchestration source code.

------------------------------------------------------------------------

# 6. Jev Decision Layer (Шар прийняття рішень Jev)

## 6.1 Роль

Jev використовується для типізованих суджень.

Основні primitives (примітиви):

``` text
CHOICE (Вибір)
SCORE  (Оцінка за шкалою)
NOUL   (Ймовірність істинності)
```

Концептуальний поділ:

``` text
LLM
= reasoning / extraction / generation
(міркування / виділення / генерація)

JEV
= typed decision
(типізоване рішення)

LANGGRAPH
= routing / state / execution
(маршрутизація / стан / виконання)

STORY CORE
= persistent semantic truth
(постійна семантична модель)
```

------------------------------------------------------------------------

# 7. JEV CHOICE (Jev-вибір)

## 7.1 Призначення

Вибрати один варіант із контрольованого набору.

Приклад:

``` text
What is the dominant narrative function?
(Яка домінантна наративна функція?)

EVENT               (Подія)
DECISION            (Рішення)
EMOTION             (Емоція)
RELATIONSHIP_CHANGE (Зміна стосунків)
REVELATION          (Розкриття)
DESCRIPTION         (Опис)
OTHER               (Інше)
```

Результат повинен містити:

``` text
selected_option (обраний варіант)
distribution    (розподіл імовірностей/оцінок)
confidence      (впевненість)
```

## 7.2 Router (Маршрутизатор)

``` text
JEV CHOICE (Jev-вибір)
        │
        ├── EVENT (Подія) → Event Subgraph (Підграф подій)
        ├── DECISION (Рішення) → Decision Subgraph (Підграф рішень)
        └── EMOTION (Емоція) → Emotion Subgraph (Підграф емоцій)
```

------------------------------------------------------------------------

# 8. JEV NOUL (Jev-оцінка істинності)

## 8.1 Призначення

Оцінювати твердження як імовірність істинності.

Приклади:

``` text
Is this a new character?
(Це новий персонаж?)

Is this contradicted by established canon?
(Це суперечить установленому канону?)

Does this change a relationship?
(Це змінює стосунки?)

Does this reveal a mystery?
(Це розкриває загадку?)

Does this require Human Review?
(Це потребує перевірки людиною?)
```

## 8.2 Threshold (Поріг)

Threshold є параметром workflow:

``` yaml
threshold: 0.85
```

Пороги не хардкодити глобально: різні рішення мають різну Cost of Error
(Ціну помилки).

------------------------------------------------------------------------

# 9. JEV SCORE (Jev-оцінка за шкалою)

## 9.1 Призначення

Оцінювати впорядковані характеристики.

Приклад:

``` text
Narrative Tension (Наративна напруга)

0 — Absent (Відсутня)
1 — Weak (Слабка)
2 — Moderate (Помірна)
3 — Strong (Сильна)
4 — Very strong (Дуже сильна)
5 — Climactic (Кульмінаційна)
```

Застосування:

-   Narrative Tension (Наративна напруга);
-   Conflict Intensity (Інтенсивність конфлікту);
-   Emotional Intensity (Емоційна інтенсивність);
-   Character Risk (Ризик для персонажа);
-   Mystery Exposure (Ступінь розкриття загадки);
-   Scene Importance (Важливість сцени);
-   Semantic Change Importance (Важливість семантичної зміни).

------------------------------------------------------------------------

# 10. JEV ROUTER (Jev-маршрутизатор)

Fusion-specific composite node (складений вузол Fusion).

``` text
INPUT (Вхід)
   ↓
JEV ROUTER (Jev-маршрутизатор)
   │
   ├── Character Agent (Агент персонажа)
   ├── Scene Agent (Агент сцени)
   ├── Mystery Agent (Агент загадки)
   ├── Causality Agent (Агент причинності)
   ├── Style Agent (Агент стилю)
   └── Literary Critic (Літературний критик)
```

Destination Registry (Реєстр напрямків) повинен дозволяти додавати новий
workflow/subgraph без переписування Router.

------------------------------------------------------------------------

# 11. Hierarchical Entity Routing (Ієрархічна маршрутизація сутностей)

Не класифікувати фрагмент безпосередньо серед усіх 118 типів одним
великим запитом.

Використовувати дерево:

``` text
118 ENTITY TYPES (118 типів сутностей)
             ↓
DOMAIN GROUP (Доменна група)
             ↓
JEV CHOICE (Jev-вибір)
             ↓
ENTITY FAMILY (Сімейство сутностей)
             ↓
JEV CHOICE (Jev-вибір)
             ↓
ENTITY TYPE (Тип сутності)
```

Приклад Domain Groups (Доменних груп):

``` text
CHARACTER  (Персонаж)
NARRATIVE  (Наратив)
WORLD      (Світ)
STYLE      (Стиль)
THEME      (Тема)
CRITIC     (Критика)
META       (Метадані)
OTHER      (Інше)
```

Фактичне групування всіх 118 типів виконати на основі чинного Entity
Registry, а не вигадувати під час реалізації.

------------------------------------------------------------------------

# 12. Character Decision Engine (Механізм рішень персонажа)

## 12.1 Character State (Стан персонажа)

Контекст:

``` text
GOALS          (Цілі)
NEEDS          (Потреби)
BELIEFS        (Переконання)
KNOWLEDGE      (Знання)
EMOTIONS       (Емоції)
RELATIONSHIPS  (Стосунки)
MEMORIES       (Спогади)
SECRETS        (Таємниці)
FEARS          (Страхи)
PROMISES       (Обіцянки)
```

## 12.2 Decision Pipeline (Конвеєр рішення)

``` text
CHARACTER STATE (Стан персонажа)
        │
        ▼
SCENE STATE (Стан сцени)
        │
        ▼
JEV DECISION BUNDLE (Пакет рішень Jev)
   ┌────┼────┐
   ▼    ▼    ▼
Choice Score Noul
Вибір Оцінка Істинність
   └────┼────┘
        ▼
ACTION SELECTED (Обрана дія)
        ▼
LLM REALIZATION (Реалізація мовною моделлю)
        ▼
NEW EXPERIENCE (Новий досвід)
        ▼
CHARACTER MEMORY (Пам'ять персонажа)
        ▼
NEW CHARACTER STATE (Новий стан персонажа)
```

LLM не повинна самостійно переписувати Character State без дозволеного
workflow.

------------------------------------------------------------------------

# 13. Mystery Director (Режисер загадки)

``` text
WORLD TRUTH (Істина світу)
      ↓
MYSTERY STATE (Стан загадки)
      ↓
READER KNOWLEDGE (Знання читача)
      ↓
CHARACTER KNOWLEDGE (Знання персонажа)
      ↓
JEV DECISION (Рішення Jev)
      │
      ├── REVEAL    (Розкрити)
      ├── HINT      (Дати підказку)
      ├── MISDIRECT (Спрямувати хибним слідом)
      ├── HIDE      (Приховати)
      └── DELAY     (Відкласти)
```

Додаткові перевірки:

``` text
JEV SCORE:
How much does the reader know?
(Наскільки багато вже знає читач?)

JEV NOUL:
Would this reveal solve the mystery too early?
(Чи розкриє це загадку надто рано?)
```

------------------------------------------------------------------------

# 14. Causality Engine (Механізм причинності)

При появі нового Event (Події) система шукає Candidate Causes
(Кандидатні причини).

``` text
PRIOR EVENTS (Попередні події)
DECISIONS    (Рішення)
GOALS        (Цілі)
STATES       (Стани)
       ↓
JEV CHOICE
(Яка попередня причина найкраще пояснює подію?)
       ↓
JEV NOUL
(Чи достатньо причинної підтримки?)
       ↓
PROPOSED RELATION
(Запропонований зв'язок)
       ↓
CAUSES (Спричиняє)
```

Автоматичне створення причинного Canon Relation (Канонічного причинного
зв'язку) без validation/review за замовчуванням заборонити.

------------------------------------------------------------------------

# 15. Continuity Gate (Шлюз безперервності)

Перед `CANON_WRITE` виконувати контроль:

``` text
AI PROPOSAL (Пропозиція ШІ)
        ↓
CONTINUITY GATE (Шлюз безперервності)
        │
        ├── contradiction? (суперечність?) → NOUL
        ├── duplicate? (дублікат?) → NOUL
        ├── plausible? (правдоподібність?) → SCORE
        ├── entity type? (тип сутності?) → CHOICE
        ├── relation type? (тип зв'язку?) → CHOICE
        └── needs human? (потрібна людина?) → NOUL
        ↓
DECISION GATE (Шлюз рішення)
```

При високому ризику:

``` text
CANON WRITE (Запис у канон) — BLOCKED (Заблоковано)
↓
HUMAN REVIEW (Перевірка людиною)
```

------------------------------------------------------------------------

# 16. Confidence Routing (Маршрутизація за впевненістю)

Параметри редагуються в Graph Studio.

Приклад:

``` yaml
confidence_routing:
  high: 0.90
  medium: 0.60

  on_high: AUTO_ROUTE
  on_medium: SECOND_OPINION
  on_low: HUMAN_REVIEW
```

UI labels:

``` text
AUTO_ROUTE       (Автоматична маршрутизація)
SECOND_OPINION   (Друга перевірка)
HUMAN_REVIEW     (Перевірка людиною)
```

Пороги задаються окремо для конкретного decision node.

------------------------------------------------------------------------

# 17. Multi-Model Consensus (Узгодження кількох моделей)

Для критичних рішень:

``` text
INPUT (Вхід)
   │
   ├── JEV DECISION (Рішення Jev)
   ├── LLM A (Модель A)
   └── LLM B (Модель B)
             ↓
CONSENSUS NODE (Вузол узгодження)
       ┌─────┴─────┐
       ▼           ▼
AGREE           DISAGREE
(Згода)        (Розбіжність)
       │           │
       ▼           ▼
CONTINUE      HUMAN REVIEW
(Продовжити)  (Перевірка людиною)
```

Не запускати Multi-Model Consensus для всіх операцій. Він повинен мати
policy (політику) використання за важливістю, ризиком та бюджетом.

------------------------------------------------------------------------

# 18. Semantic Change Detector (Детектор семантичних змін)

При редагуванні тексту не запускати повний аналіз книги.

``` text
TEXT CHANGE (Зміна тексту)
       ↓
SEMANTIC CHANGE DETECTOR
(Детектор семантичних змін)
       ↓
JEV CHOICE
       │
       ├── STYLE_ONLY          (Лише стиль)
       ├── CHARACTER_STATE     (Стан персонажа)
       ├── EVENT               (Подія)
       ├── RELATIONSHIP        (Стосунки)
       ├── LOCATION            (Локація)
       ├── TIMELINE            (Хронологія)
       ├── FACT                (Факт)
       └── NO_SEMANTIC_CHANGE  (Без семантичної зміни)
```

Запускати тільки affected subgraphs (підграфи, яких торкнулася зміна).

------------------------------------------------------------------------

# 19. Adaptive Workflow (Адаптивний робочий процес)

Глибина аналізу залежить від Semantic Importance (Семантичної
важливості).

``` text
NEW/CHANGED TEXT (Новий/змінений текст)
        ↓
JEV SCORE
Semantic Importance (Семантична важливість)
        │
        ├── LOW       → SKIP / MINIMAL
        ├── MEDIUM    → LIGHT ANALYSIS
        ├── HIGH      → NORMAL ANALYSIS
        └── CRITICAL  → DEEP ANALYSIS
```

Конкретні шкали і пороги конфігуруються у workflow, а не зашиваються в
код.

------------------------------------------------------------------------

# 20. JEV GATE (Jev-шлюз)

Composite Node (Складений вузол), який поєднує decision + threshold +
routing.

Приклад:

``` text
JEV GATE
Question:
"Does this contradict canon?"
("Чи суперечить це канону?")

threshold = 0.85

TRUE  → Human Review
FALSE → Continue
```

------------------------------------------------------------------------

# 21. JEV EVALUATOR (Jev-оцінювач)

Вузол для типізованої оцінки AI-output.

Приклади:

``` text
Consistency       (Узгодженість)
Narrative Value   (Наративна цінність)
Character Fit     (Відповідність персонажу)
Style Fit         (Відповідність стилю)
Evidence Strength (Сила доказів)
```

Evaluator не повинен автоматично перетворювати суб'єктивну оцінку на
факт Story Canon.

------------------------------------------------------------------------

# 22. JEV DECISION BUNDLE (Пакет рішень Jev)

Fusion-specific node для кількох незалежних типізованих суджень над
одним state.

``` text
┌──────────────────────────────────┐
│ JEV DECISION BUNDLE              │
│ (Пакет рішень Jev)               │
│                                  │
│ CHOICE: What will Mark do?       │
│ (Що зробить Марк?)               │
│                                  │
│ SCORE: Perceived danger          │
│ (Сприйнята небезпека)            │
│                                  │
│ NOUL: Is Sofia in danger?        │
│ (Чи в небезпеці Софія?)          │
└──────────────────────────────────┘
```

Якщо друге рішення залежить від результату першого, використовувати
послідовні nodes, а не незалежний bundle.

------------------------------------------------------------------------

# 23. Story Graph (Граф твору)

Story Graph показує фактичні instances (екземпляри).

``` text
Ontology:
CHARACTER (Персонаж)
 ── LOVES (Кохає) ──>
CHARACTER (Персонаж)

Story:
MARK (Марк)
 ── LOVES (Кохає) ──>
SOFIA (Софія)
```

Джерело істини:

``` text
entities
entity_relations
entity_mentions
entity_versions
documents
paragraphs
analysis_runs
```

Story Graph не зберігати як незалежну копію канону.

------------------------------------------------------------------------

# 24. Proposal vs Canon (Пропозиція проти канону)

Стани:

``` text
DETECTED    (Виявлено)
PROPOSED    (Запропоновано)
VALIDATED   (Перевірено)
APPROVED    (Схвалено)
CANON       (Канон)
REJECTED    (Відхилено)
SUPERSEDED  (Замінено новішим)
```

AI output за замовчуванням:

``` text
AI → PROPOSAL
```

а не:

``` text
AI → CANON
```

------------------------------------------------------------------------

# 25. Provenance (Походження даних)

Кожна AI-пропозиція повинна дозволяти відповісти:

-   який текст був джерелом;
-   яка Entity/Relation була запропонована;
-   який workflow;
-   яка workflow version;
-   яка ontology version;
-   яка модель;
-   який prompt version;
-   які Jev decisions;
-   confidence;
-   хто підтвердив;
-   що виправив автор.

------------------------------------------------------------------------

# 26. Feedback Learning Loop (Цикл навчання на зворотному зв'язку)

``` text
AI PROPOSAL
(Пропозиція ШІ)
      ↓
AUTHOR REVIEW
(Перевірка автором)
      ↓
AUTHOR CORRECTION
(Виправлення автора)
      ↓
FINAL CANON
(Фінальний канон)
      ↓
FEEDBACK DATASET
(Набір зворотного зв'язку)
```

Зберігати:

``` text
input context
AI proposal
AI confidence
Jev decisions
author action
author correction
final canon
```

Використання:

-   Evaluation (Оцінювання);
-   Prompt Optimization (Оптимізація інструкцій);
-   Threshold Calibration (Калібрування порогів);
-   Regression Testing (Регресійне тестування);
-   Decision Calibration (Калібрування рішень);
-   потенційне майбутнє Fine-Tuning (Донавчання).

Не виконувати автоматичне self-training (самонавчання) production-моделі
без окремого контрольованого процесу.

------------------------------------------------------------------------

# 27. Workflow Observability (Спостережуваність процесів)

Для кожного run зберігати:

``` text
workflow_id
workflow_version
node_id
node_type
start_time
end_time
latency
model
tokens_in
tokens_out
estimated_cost
decision
confidence
validation_result
human_result
error
retry_count
```

Graph Studio повинен мати:

``` text
RUN LOG       (Журнал запуску)
TRACE         (Трасування)
TOKENS        (Токени)
COST          (Вартість)
LATENCY       (Затримка)
ENTITIES      (Сутності)
RELATIONS     (Зв'язки)
WARNINGS      (Попередження)
ERRORS        (Помилки)
```

------------------------------------------------------------------------

# 28. Graph Optimizer (Оптимізатор графа)

На основі історії runs система може показувати аналітику:

``` text
Acceptance Rate     (Частка прийняття)
Rejection Rate      (Частка відхилення)
Average Confidence  (Середня впевненість)
Average Cost        (Середня вартість)
Average Latency     (Середня затримка)
Correction Rate     (Частота виправлень)
```

Graph Optimizer може **пропонувати**, але не повинен самостійно
змінювати production workflow.

Наприклад:

``` text
SUGGESTION (Пропозиція):
Mystery Analyzer має високий Correction Rate.
Переглянути prompt / context / threshold.
```

------------------------------------------------------------------------

# 29. Cost-Aware Routing (Маршрутизація з урахуванням вартості)

Додати policy:

``` text
TASK COMPLEXITY (Складність задачі)
RISK LEVEL      (Рівень ризику)
BUDGET          (Бюджет)
LATENCY TARGET  (Цільова затримка)
```

Router може вибирати:

``` text
CHEAP MODEL    (Дешева модель)
STANDARD MODEL (Стандартна модель)
STRONG MODEL   (Потужна модель)
HUMAN REVIEW   (Перевірка людиною)
```

Вибір моделі повинен бути audit-able (аудитованим).

------------------------------------------------------------------------

# 30. Retry & Recovery (Повтор і відновлення)

Node-level policy:

``` yaml
retry:
  max_attempts: 2
  backoff: exponential

on_timeout: fallback
on_schema_error: repair_or_review
on_provider_error: alternate_provider
on_low_confidence: review
```

UI:

``` text
RETRY             (Повторити)
FALLBACK          (Резервний маршрут)
ALTERNATE_MODEL   (Альтернативна модель)
HUMAN_REVIEW      (Перевірка людиною)
FAIL              (Завершити з помилкою)
```

------------------------------------------------------------------------

# 31. Checkpoint (Контрольна точка) та Resume (Продовження)

Для довгих workflow:

``` text
CHECKPOINT (Контрольна точка)
```

зберігає state, після чого run можна:

``` text
PAUSE   (Призупинити)
RESUME  (Продовжити)
REPLAY  (Повторно виконати)
FORK    (Створити відгалуження)
```

Replay повинен мати можливість використовувати зафіксовані
input/schema/workflow versions.

------------------------------------------------------------------------

# 32. Simulation Mode (Режим симуляції)

Для Character Decision, Mystery Director та альтернативних сюжетних
сценаріїв потрібен:

``` text
SIMULATION
(Симуляція)
```

Він працює з ізольованим state:

``` text
CANON STATE
    ↓ clone
SIMULATION STATE
    ↓
AI/JEV decisions
    ↓
SIMULATION RESULT
```

Simulation Result не змінює Canon без окремої дії:

``` text
PROPOSE TO CANON
(Запропонувати до канону)
```

------------------------------------------------------------------------

# 33. Story Core API

Графи не отримують довільний SQL access.

Мінімальні operations:

``` text
get_schema()                  (Отримати схему)
get_schema_version()          (Отримати версію схеми)
get_entity()                  (Отримати сутність)
search_entities()             (Знайти сутності)
get_relations()               (Отримати зв'язки)
get_mentions()                (Отримати згадки)
get_sources()                 (Отримати джерела)

create_entity_proposal()      (Створити пропозицію сутності)
create_relation_proposal()    (Створити пропозицію зв'язку)
validate_entity()             (Перевірити сутність)
validate_relation()           (Перевірити зв'язок)
approve_proposal()            (Схвалити пропозицію)
reject_proposal()             (Відхилити пропозицію)
write_canon()                 (Записати в канон)

publish_schema()              (Опублікувати схему)
rollback_schema()             (Відкотити схему)
```

------------------------------------------------------------------------

# 34. Versioning (Версійність)

Три основні рівні:

``` text
ontology_version  (Версія онтології)
workflow_version  (Версія workflow)
entity_revision   (Ревізія сутності)
relation_revision (Ревізія зв'язку)
```

Analysis Run (Запуск аналізу) повинен фіксувати:

``` yaml
ontology_version:
workflow_id:
workflow_version:
model_provider:
model:
prompt_version:
jev_version:
started_at:
completed_at:
```

------------------------------------------------------------------------

# 35. Graph Studio UI (Інтерфейс студії графів)

Рекомендований route (маршрут):

``` text
/admin/graph-studio
```

або:

``` text
/studio/graphs
```

Основні tabs (вкладки):

``` text
ONTOLOGY       (Онтологія)
AI WORKFLOWS   (Процеси ШІ)
STORY GRAPH    (Граф твору)
RUNS           (Запуски)
VERSIONS       (Версії)
EVALUATIONS    (Оцінювання)
```

Node palette (Палітра вузлів) повинна мати групи:

``` text
CORE           (Основні)
STORY CORE     (Семантичне ядро)
AI             (ШІ)
JEV            (Jev)
CONTROL        (Керування)
VALIDATION     (Перевірка)
HUMAN          (Людина)
OUTPUT         (Вихід)
```

------------------------------------------------------------------------

# 36. Jev Node Palette (Палітра вузлів Jev)

``` text
JEV CHOICE
(Jev-вибір)

JEV SCORE
(Jev-оцінка за шкалою)

JEV NOUL
(Jev-оцінка істинності)

JEV ROUTER
(Jev-маршрутизатор)

JEV GATE
(Jev-шлюз)

JEV EVALUATOR
(Jev-оцінювач)

JEV DECISION BUNDLE
(Пакет рішень Jev)
```

Кожен node повинен мати:

``` text
Question/Definition (Питання/визначення)
Input State (Вхідний стан)
Options/Scale (Варіанти/шкала)
Threshold (Поріг)
Output Mapping (Відображення виходу)
Fallback (Резервний маршрут)
Logging (Журналювання)
```

------------------------------------------------------------------------

# 37. Security (Безпека)

Обов'язково:

-   Server-Side Authorization (Серверна авторизація);
-   Role-Based Access Control / RBAC (Рольове керування доступом);
-   окремий permission для `CANON_WRITE`;
-   окремий permission для `PUBLISH_SCHEMA`;
-   Audit Log (Журнал аудиту);
-   secrets тільки server-side;
-   LLM/Jev не мають довільного SQL-доступу;
-   Context Scope (Область контексту) обмежується workflow;
-   schema/workflow validation перед production;
-   rate/token/cost limits;
-   timeout/retry limits.

------------------------------------------------------------------------

# 38. Environment States (Стани середовища)

``` text
DRAFT       (Чернетка)
TEST        (Тест)
PRODUCTION  (Робоче середовище)
ARCHIVED    (Архів)
```

Редагування Draft не змінює Production.

Потрібна явна дія:

``` text
PUBLISH TO PRODUCTION
(Опублікувати у робоче середовище)
```

------------------------------------------------------------------------

# 39. Acceptance Criteria (Критерії приймання)

1.  Ontology Graph (Граф онтології) імпортує чинний Entity Registry.
2.  Новий Entity Type (Тип сутності) створюється як Draft.
3.  Schema проходить Validate/Preview перед Publish.
4.  Schema підтримує Version/Rollback.
5.  UI metadata читається зі Schema Registry.
6.  AI Workflow Graph дозволяє візуально створювати pipeline.
7.  Workflow зберігається як versioned definition.
8.  LangGraph виконує published workflow.
9.  Jev Choice/Score/Noul доступні як nodes.
10. Jev Router може направляти execution у subgraph.
11. Threshold редагується без зміни коду.
12. Confidence Routing працює за конфігурацією.
13. Query читає Story Core через API.
14. AI output за замовчуванням створює Proposal.
15. Human Review підтримує Accept/Edit/Reject.
16. Canon Write створює revision + provenance + audit.
17. Continuity Gate може блокувати Canon Write.
18. Story Graph будується з реальних entities/relations.
19. Semantic Change Detector запускає лише affected workflows.
20. Adaptive Workflow змінює глибину аналізу за конфігурацією.
21. Character Decision Engine працює в Simulation Mode без зміни Canon.
22. Mystery Director розрізняє World Truth, Reader Knowledge та
    Character Knowledge.
23. Causality Engine створює Proposed Relation, а не мовчки змінює
    Canon.
24. Run Trace показує node decisions, confidence, latency, tokens і
    errors.
25. Feedback Loop зберігає авторські виправлення.
26. Graph Optimizer лише пропонує зміни.
27. Production workflow можна rollback.
28. Layout зміни вузлів не змінюють семантику.
29. Усі критичні рішення мають provenance.
30. Machine IDs залишаються стабільними незалежно від українського UI
    label.

------------------------------------------------------------------------

# 40. Етапи реалізації

## Phase 1 --- Graph Foundation (Основа графів)

-   node-edge canvas;
-   save/load;
-   graph schema;
-   versioning;
-   validation;
-   node registry;
-   execution trace.

## Phase 2 --- Ontology Graph (Граф онтології)

-   імпорт 118 Entity Types;
-   relation registry;
-   Schema Registry;
-   Draft/Validate/Preview/Publish/Rollback.

## Phase 3 --- Story Graph (Граф твору)

-   Story Core API;
-   entity/relation visualization;
-   filters;
-   provenance;
-   manual proposals/editing.

## Phase 4 --- AI Workflow Graph (Граф процесу ШІ)

-   LangGraph runtime;
-   LLM/Prompt/Context/Query/Tool/Condition;
-   subgraphs;
-   checkpoints;
-   retry/fallback.

## Phase 5 --- Jev Decision Layer (Шар рішень Jev)

-   Choice;
-   Score;
-   Noul;
-   Router;
-   Gate;
-   Evaluator;
-   Decision Bundle;
-   confidence routing.

## Phase 6 --- Story Intelligence (Інтелект твору)

-   Character Decision Engine;
-   Mystery Director;
-   Causality Engine;
-   Continuity Gate;
-   Semantic Change Detector;
-   Adaptive Workflow.

## Phase 7 --- Human & Canon Control (Людський контроль і канон)

-   Proposal;
-   Human Review;
-   Canon Write;
-   audit;
-   revisions;
-   simulation-to-canon proposal.

## Phase 8 --- Optimization (Оптимізація)

-   observability;
-   cost-aware routing;
-   feedback dataset;
-   evaluations;
-   Graph Optimizer;
-   regression tests.

------------------------------------------------------------------------

# 41. Головне архітектурне правило

``` text
ONTOLOGY GRAPH (Граф онтології)
= що може існувати у семантичному ядрі

AI WORKFLOW GRAPH (Граф робочого процесу ШІ)
= як система думає, перевіряє, маршрутизує та виконує

JEV DECISION LAYER (Шар рішень Jev)
= як система приймає типізовані рішення

STORY GRAPH (Граф твору)
= що фактично існує у конкретному творі

STORY CORE (Семантичне ядро)
= контрольоване джерело постійного стану та канону
```

------------------------------------------------------------------------

# 42. Цільова схема

``` text
                     ONTOLOGY GRAPH
                     (Граф онтології)
                            ↓
                     SCHEMA REGISTRY
                      (Реєстр схем)
                            ↓
                        STORY CORE
                            ↑
                            │
                    AI WORKFLOW GRAPH
                (Граф робочого процесу ШІ)
                            ↓
                        LANGGRAPH
                            ↓
             ┌──────────────┼──────────────┐
             ↓              ↓              ↓
            LLM            JEV           TOOLS
        (Генерація)     (Рішення)     (Інструменти)
             └──────────────┼──────────────┘
                            ↓
                    CONTINUITY GATE
                (Шлюз безперервності)
                            ↓
                     HUMAN REVIEW
                 (Перевірка людиною)
                            ↓
                      CANON WRITE
                    (Запис у канон)
                            ↓
                       STORY CORE
                            ↓
                       STORY GRAPH
                      (Граф твору)
```

Fusion Lab повинен використовувати граф не просто як візуалізацію, а як
**версійовану, контрольовану та спостережувану мову конфігурації
семантичного ядра й AI-оркестрації**.

---

# 43. Collaboration Graph (Граф співпраці)

## 43.1 Призначення

Додати четверту категорію графів, яка описує не внутрішній світ твору, а **людей, ролі, завдання, внески, доступи та результати роботи**, пов'язані зі створенням, оформленням, підготовкою, публікацією та продажем книги.

```text
Ontology Graph (Граф онтології)
= ЩО система розуміє

AI Workflow Graph (Граф робочого процесу ШІ)
= ЯК ШІ працює

Story Graph (Граф твору)
= ЩО існує та відбувається у творі

Collaboration Graph (Граф співпраці)
= ХТО створює книгу, У ЯКІЙ ролі та ЩО саме робить
```

Collaboration Graph (Граф співпраці) не повинен змішувати реальних учасників проєкту з Character (Персонажами) та іншими сутностями Story Ontology (Онтології твору).

---

# 44. Collaboration Ontology (Онтологія співпраці)

Story Ontology (Онтологія твору) та Collaboration Ontology (Онтологія співпраці) повинні бути окремими доменами одного Fusion Semantic Core (Семантичного ядра Fusion).

```text
                 FUSION SEMANTIC CORE
                (Семантичне ядро Fusion)
                         │
             ┌───────────┴───────────┐
             ▼                       ▼

      STORY ONTOLOGY          COLLABORATION ONTOLOGY
      (Онтологія твору)       (Онтологія співпраці)

          118+ типів              новий реєстр
             │                       │
             └───────────┬───────────┘
                         ▼
                 CROSS-DOMAIN LINKS
                 (Міждоменні зв'язки)
```

Поточні 118 Story Entity Types (Типів сутностей твору) не слід автоматично розширювати бізнесовими ролями на кшталт Designer (Дизайнер) або Seller (Продавець). Для них створюється окремий Collaboration Registry (Реєстр співпраці).

---

# 45. Базові сутності Collaboration Ontology (Онтології співпраці)

Мінімальний набір:

```text
PERSON               (Людина)
PARTICIPANT          (Учасник проєкту)
ROLE                 (Роль)
BOOK_PROJECT         (Проєкт книги)
TASK                 (Завдання)
DELIVERABLE          (Результат роботи)
CONTRIBUTION         (Внесок)
ACCESS_GRANT         (Наданий доступ)
APPLICATION          (Заявка)
ORDER                (Замовлення)
CREATIVE_PROJECT     (Творчий проєкт)
SPECIALIST_PROFILE   (Профіль спеціаліста)
ASSET                (Ресурс / файл / медіаоб'єкт)
REVIEW               (Перевірка / рецензія роботи)
APPROVAL             (Схвалення)
CONTRACT             (Домовленість / контракт)
PUBLICATION_TASK     (Завдання публікації)
LISTING              (Картка продажу / лістинг)
```

Не всі сутності мають бути реалізовані в першій фазі. Фактична модель повинна узгоджуватися з уже наявними моделями Marketplace, Creative Studio, Teams та Writer Studio.

---

# 46. Role Model (Модель ролей)

Роль повинна належати участі людини у конкретному Book Project (Проєкті книги), а не бути незмінною глобальною властивістю User (Користувача).

Не використовувати як основну модель:

```text
User.role = AUTHOR
```

Використовувати:

```text
PERSON (Людина)
    ↓
PARTICIPANT (Учасник)
    ↓
HAS_ROLE (Має роль)
    ↓
ROLE (Роль)
```

Одна людина може мати різні ролі в різних книгах.

```text
Book A (Книга A)
Denis → AUTHOR (Автор) + OWNER (Власник проєкту)

Book B (Книга B)
Denis → CO_AUTHOR (Співавтор)

Book C (Книга C)
Denis → DESIGNER (Дизайнер)
```

Базовий Role Registry (Реєстр ролей):

```text
OWNER               (Власник проєкту)
AUTHOR              (Автор)
CO_AUTHOR           (Співавтор)
EDITOR              (Редактор)
LITERARY_EDITOR     (Літературний редактор)
PROOFREADER         (Коректор)
DESIGNER            (Дизайнер)
ILLUSTRATOR         (Ілюстратор)
TRANSLATOR          (Перекладач)
BOOK_MANAGER        (Менеджер книги)
MARKETING_MANAGER   (Маркетинговий менеджер)
SELLER              (Продавець)
PUBLISHER           (Видавець)
FREELANCER          (Фрілансер)
REVIEWER            (Рецензент / перевіряльник)
```

Role Registry повинен бути розширюваним і версійованим.

---

# 47. Contribution Graph View (Представлення графа внесків)

Система повинна зберігати не лише членство, а й фактичний Contribution (Внесок).

```text
PERSON (Людина)
   │
   ├── WROTE (Написав) ───────────→ CHAPTER (Розділ)
   ├── EDITED (Редагував) ─────────→ SCENE (Сцена)
   ├── DESIGNED (Спроєктував) ─────→ COVER (Обкладинка)
   ├── CREATED (Створив) ──────────→ ASSET (Ресурс)
   └── TRANSLATED (Переклав) ──────→ DOCUMENT (Документ)
```

Contribution (Внесок) повинен мати provenance (походження), timestamp (час), project scope (область проєкту) та за можливості revision reference (посилання на ревізію).

Contribution History (Історія внесків) використовується для історії проєкту, attribution (атрибуції), workflow та аудиту. Вона не повинна автоматично трактуватися як юридичне визначення авторського права.

---

# 48. Cross-Domain Links (Міждоменні зв'язки)

Collaboration Ontology (Онтологія співпраці) повинна мати контрольовані зв'язки зі Story Ontology (Онтологією твору).

Приклади:

```text
PERSON ──WROTE──────────→ CHAPTER
PERSON ──CREATED────────→ CHARACTER
PERSON ──EDITED─────────→ SCENE
PERSON ──ILLUSTRATED────→ SCENE

ASSET ──DEPICTS─────────→ CHARACTER
ASSET ──DEPICTS─────────→ LOCATION
ASSET ──BASED_ON────────→ SCENE

TASK ──BASED_ON─────────→ SCENE
TASK ──TARGETS──────────→ CHARACTER
TASK ──FOLLOWS──────────→ STYLE_BIBLE
```

Приклад ілюстрації:

```text
Maria (Марія)
   │
HAS_ROLE (Має роль)
   ▼
ILLUSTRATOR (Ілюстратор)
   │
ASSIGNED_TO (Призначена на)
   ▼
TASK #187 (Завдання #187)
   │
CREATES (Створює)
   ▼
ILLUSTRATION #42 (Ілюстрація #42)
   │
   ├── DEPICTS (Зображує) → CHARACTER:Sofia
   ├── DEPICTS (Зображує) → LOCATION:Cafe
   ├── BASED_ON (Базується на) → SCENE:17
   └── FOLLOWS (Дотримується) → STYLE_BIBLE:2.1
```

---

# 49. Access Graph View (Представлення графа доступу)

Доступ не повинен визначатися лише Role (Роллю). Потрібен Project-Scoped Access (Доступ у межах проєкту) та Resource-Scoped Access (Доступ до конкретних ресурсів).

```text
PERSON (Людина)
     ↓
PARTICIPANT (Учасник)
     ↓
ROLE (Роль)
     ↓
ACCESS_GRANT (Наданий доступ)
     │
     ├── VIEW     (Перегляд)
     ├── COMMENT  (Коментування)
     ├── EDIT     (Редагування)
     ├── CREATE   (Створення)
     ├── REVIEW   (Перевірка)
     ├── APPROVE  (Схвалення)
     └── MANAGE   (Керування)
```

Access Grant повинен мати scope (область дії):

```text
BOOK
CHAPTER
SCENE
CHARACTER
LOCATION
STYLE_BIBLE
MEDIA_LIBRARY
TASK
DELIVERABLE
```

Приклад:

```text
Maria / Illustrator (Марія / Ілюстратор)

Chapter 1             NONE (Немає доступу)
Chapter 2             NONE (Немає доступу)
Scene 17              VIEW (Перегляд)
Character:Sofia       VIEW (Перегляд)
Character:Mark        VIEW (Перегляд)
Location:Cafe         VIEW (Перегляд)
Style Bible           VIEW (Перегляд)
Media Library         WORK (Робочий доступ)
```

Book Manager (Менеджер книги), наприклад, може мати доступ до metadata (метаданих), cover (обкладинки), publication status (статусу публікації), listings (лістингів) та marketing assets (маркетингових матеріалів), але не автоматично до unpublished chapters (неопублікованих розділів), character secrets (таємниць персонажів), Story Canon editing (редагування канону) чи Ontology publishing (публікації онтології).

---

# 50. Freelance Marketplace Flow (Процес біржі фрілансу)

Collaboration Graph повинен зв'язувати Marketplace (Біржу), Creative Studio (Творчу студію), Writer Studio (Студію письменника) та Story Core (Семантичне ядро).

```text
PERSON (Людина)
   ↓
SPECIALIST PROFILE (Профіль спеціаліста)
   ↓
APPLICATION (Заявка)
   ↓
ORDER (Замовлення)
   ↓
CREATIVE PROJECT (Творчий проєкт)
   ↓
ROLE (Роль)
   ↓
ACCESS GRANT (Наданий доступ)
   ↓
TASK (Завдання)
   ↓
DELIVERABLE (Результат роботи)
   ↓
REVIEW (Перевірка)
   ↓
APPROVED ASSET (Схвалений ресурс)
```

Після схвалення:

```text
APPROVED ASSET
      │
      ├── DEPICTS (Зображує) → CHARACTER
      ├── DEPICTS (Зображує) → LOCATION
      ├── BASED_ON (Базується на) → SCENE
      └── CANON_REFERENCE (Канонічне посилання) → VISUAL_BIBLE
```

Не додавати фінансові/escrow/dispute механізми як активні, якщо вони фактично не реалізовані у Marketplace.

---

# 51. Co-Author Workflow (Робочий процес співавторства)

Co-Author (Співавтор) повинен підтримувати granular scope (детальну область відповідальності).

Приклади:

```text
Anna (Анна)
   ├── WROTE (Написала) → Chapter 3
   ├── WROTE (Написала) → Chapter 7
   ├── CREATED (Створила) → Character:Sofia
   └── EDITED (Редагувала) → Scene 21
```

Для співавторства потрібні:

```text
EDIT SCOPE            (Область редагування)
REVIEW SCOPE          (Область перевірки)
APPROVAL SCOPE        (Область схвалення)
CONTRIBUTION HISTORY  (Історія внесків)
VERSION HISTORY       (Історія версій)
COMMENT THREAD        (Гілка коментарів)
CHANGE PROPOSAL       (Пропозиція зміни)
```

Конфліктні зміни до Canon повинні підтримувати Proposal/Review/Merge workflow (Пропозиція/Перевірка/Злиття), а не silent overwrite (тихе перезаписування).

---

# 52. Collaboration Graph Views (Представлення графа співпраці)

Не створювати окремі незалежні бази для кожного виду. Це різні views (представлення) одного Collaboration Graph.

```text
COLLABORATION GRAPH (Граф співпраці)
        │
        ├── PARTICIPANT VIEW  (Представлення учасників)
        ├── ROLE VIEW         (Представлення ролей)
        ├── CONTRIBUTION VIEW (Представлення внесків)
        ├── ACCESS VIEW       (Представлення доступу)
        └── PRODUCTION VIEW   (Представлення виробничого процесу)
```

---

# 53. AI + Collaboration Graph (ШІ + Граф співпраці)

AI Workflow Graph повинен мати можливість читати Collaboration Graph через контрольований API.

Приклад: автор запускає `CREATE COVER (Створити обкладинку)`.

```text
BOOK (Книга)
  ↓
COVER REQUIRED (Потрібна обкладинка)
  ↓
CREATIVE PROJECT EXISTS?
(Чи існує творчий проєкт?)
  ↓ NO
SEARCH COLLABORATION GRAPH
(Пошук у графі співпраці)
  ↓
DESIGNER / ILLUSTRATOR AVAILABLE?
(Дизайнер / ілюстратор доступний?)
  ↓ YES
CREATE TASK PROPOSAL
(Створити пропозицію завдання)
```

AI не повинен автоматично призначати людину, відкривати приватні ресурси або створювати зобов'язання без відповідних permissions та підтвердження.

---

# 54. Collaboration Query Nodes (Вузли запитів співпраці)

До AI Workflow Graph додати контрольовані операції:

```text
FIND_PARTICIPANT       (Знайти учасника)
FIND_SPECIALIST        (Знайти спеціаліста)
GET_PROJECT_ROLES      (Отримати ролі проєкту)
GET_ACCESS_SCOPE       (Отримати область доступу)
GET_CONTRIBUTIONS      (Отримати внески)
GET_OPEN_TASKS         (Отримати відкриті завдання)
GET_DELIVERABLES       (Отримати результати роботи)
GET_AVAILABLE_CONTEXT  (Отримати дозволений контекст)
```

Усі операції повинні проходити через server-side authorization (серверну авторизацію).

---

# 55. Collaboration Events (Події співпраці)

Для orchestration та audit потрібні domain events (доменні події):

```text
PARTICIPANT_INVITED        (Учасника запрошено)
PARTICIPANT_JOINED         (Учасник приєднався)
ROLE_ASSIGNED              (Роль призначено)
ROLE_REVOKED               (Роль відкликано)
ACCESS_GRANTED             (Доступ надано)
ACCESS_REVOKED             (Доступ відкликано)
TASK_ASSIGNED              (Завдання призначено)
TASK_COMPLETED             (Завдання виконано)
DELIVERABLE_SUBMITTED      (Результат подано)
DELIVERABLE_APPROVED       (Результат схвалено)
DELIVERABLE_REJECTED       (Результат відхилено)
CONTRIBUTION_RECORDED      (Внесок зафіксовано)
CANON_CHANGE_PROPOSED      (Зміну канону запропоновано)
CANON_CHANGE_APPROVED      (Зміну канону схвалено)
```

Ці events можуть запускати дозволені Workflow Graphs.

---

# 56. Collaboration Provenance (Походження внеску)

Для кожного значущого внеску зберігати:

```text
project_id
participant_id
role_id
action_type
resource_type
resource_id
source_revision
result_revision
task_id
deliverable_id
timestamp
approval_status
approved_by
```

Для AI-assisted contribution (внеску з допомогою ШІ) додатково, де доречно:

```text
workflow_id
workflow_version
model
AI proposal reference
human editor / approver
```

---

# 57. Оновлена Fusion Graph Architecture (Архітектура графів Fusion)

```text
                         FUSION GRAPH SYSTEM
                                │
        ┌───────────────────────┼────────────────────────┐
        │                       │                        │
        ▼                       ▼                        ▼
ONTOLOGY GRAPH           AI WORKFLOW GRAPH          STORY GRAPH
(Граф онтології)         (Граф процесу ШІ)          (Граф твору)
        │                       │                        │
        │                       │                        │
        └───────────────┐       │       ┌────────────────┘
                        ▼       ▼       ▼
                    STORY CORE API
                         ▲     ▲
                         │     │
                         │     ▼
                         │  JEV DECISION LAYER
                         │  (Шар рішень Jev)
                         │
                         ▼
                COLLABORATION GRAPH
                  (Граф співпраці)
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      MARKETPLACE   CREATIVE STUDIO   PROJECT TEAM
       (Біржа)      (Творча студія)   (Команда)
```

---

# 58. Оновлене правило Semantic Core (Семантичного ядра)

```text
FUSION SEMANTIC CORE (Семантичне ядро Fusion)

1. STORY ONTOLOGY (Онтологія твору)
   = семантика змісту книги

2. COLLABORATION ONTOLOGY (Онтологія співпраці)
   = семантика людей, ролей, завдань, внесків і доступу

3. CROSS-DOMAIN RELATIONS (Міждоменні зв'язки)
   = контрольований міст між створенням книги та її змістом
```

Не змішувати реального `PERSON (Людина)` з `CHARACTER (Персонажем)` навіть якщо вони мають однакове ім'я.

---

# 59. Додаткові Acceptance Criteria (Критерії приймання) v3

31. Collaboration Ontology існує окремо від Story Ontology.
32. PERSON та CHARACTER мають різні domain IDs і не можуть бути випадково об'єднані.
33. Role є project-scoped, а не лише глобальною властивістю User.
34. Один Participant може мати кілька Roles в одному проєкті, якщо це дозволено policy.
35. Contribution пов'язується з конкретним ресурсом/ревізією, де це можливо.
36. Access Grant підтримує project/resource scope.
37. Illustrator може отримати доступ до потрібної Scene/Character/Style Bible без доступу до всієї книги.
38. Book Manager не отримує Story Canon permissions автоматично.
39. Marketplace → Creative Project → Task → Deliverable → Approved Asset простежується через IDs.
40. Approved Asset може мати Cross-Domain Links до Story entities.
41. Co-Author changes мають revision/proposal history.
42. Collaboration Graph підтримує Participant/Role/Contribution/Access/Production views.
43. AI Workflow може читати Collaboration Graph лише через контрольований API.
44. AI не може самостійно розширити Access Grant без permission і підтвердження.
45. Collaboration domain events можуть запускати дозволені workflows.
46. Внески мають provenance та audit trail.
47. Історія внесків не маркується автоматично як юридичне визначення авторського права.
48. Нові collaboration roles можна додавати без зміни Story Ontology.
49. Cross-Domain Relation Types проходять schema validation.
50. Collaboration Graph не дублює Story Core як друге джерело істини для сутностей твору.

---

# 60. Оновлені етапи реалізації v3

До попередніх фаз додати:

## Phase 9 — Collaboration Ontology (Онтологія співпраці)

- Collaboration Registry;
- Person/Participant/Role;
- Book Project membership;
- Cross-Domain Relation Registry;
- versioning.

## Phase 10 — Access & Contribution (Доступ і внески)

- Access Grant;
- resource scopes;
- Contribution History;
- audit;
- co-author change proposals.

## Phase 11 — Marketplace / Creative Studio Bridge (Міст біржі та творчої студії)

- Specialist Profile;
- Application/Order mapping;
- Creative Project;
- Task;
- Deliverable;
- Approved Asset;
- links to Scene/Character/Location/Style Bible.

## Phase 12 — Collaboration-Aware AI (ШІ з урахуванням співпраці)

- Collaboration Query Nodes;
- collaboration events as workflow triggers;
- role/access-aware context assembly;
- specialist/task suggestions;
- Human Approval gates for assignments/access changes.

---

# 61. Кінцева модель v3

```text
                         FUSION LAB
                             │
                             ▼
                    FUSION SEMANTIC CORE
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
       STORY ONTOLOGY                COLLABORATION ONTOLOGY
      (Онтологія твору)              (Онтологія співпраці)
              │                             │
              └──────────────┬──────────────┘
                             ▼
                    CROSS-DOMAIN LINKS
                   (Міждоменні зв'язки)
                             │
                             ▼
                       STORY CORE API
                             ▲
                             │
                 AI WORKFLOW GRAPH
               (Граф робочого процесу ШІ)
                             │
                             ▼
                         LANGGRAPH
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
             LLM            JEV           TOOLS
        (Генерація)     (Рішення)     (Інструменти)
              └──────────────┼──────────────┘
                             ▼
                    VALIDATION / REVIEW
                  (Перевірка / схвалення)
                             │
                             ▼
                         STORY CORE
                         │         │
                         ▼         ▼
                   STORY GRAPH  COLLABORATION GRAPH
                   (Граф твору) (Граф співпраці)
```

**Архітектурний результат:** Fusion Lab отримує чотири взаємопов'язані категорії графів, два семантичні домени та контрольовані міждоменні зв'язки. Це дозволяє одночасно моделювати зміст книги, AI-оркестрацію та реальний виробничий процес створення книги командою, не змішуючи ці поняття в одну модель даних.
