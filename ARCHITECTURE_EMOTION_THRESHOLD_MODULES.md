# Архітектура: AI-модулі «Емоційна майстерність письменника» та «Поріг» у Fusion Lab Studio

**Статус:** план на затвердження, за вашим ТЗ (два документи) і п'ятьма
рішеннями з уточнювальних питань: (1) писати обидва модулі паралельно; (2)
дані — повні реляційні таблиці одразу, не JSON-заглушка; (3) точка входу —
нові підрозділи в розділі «Тренажери письменника», не CoachModal і не
адмінка; (4) обидва модулі формують навик автора через ШІ; (5) саме через
ДВІ ІСНУЮЧІ компетенції WDI (`emotion_reader_impact`, `character_craft`), без
нового дерева навичок — розділ 8.

Джерела фактів: `server/wdi.ts`, `server/wdiStore.ts`, `server/db.ts`,
`server/coreAiRegistry.ts`, `server/readerResponsePrompt.ts`,
`server/behaviorDriftPrompt.ts`, `server/characterCodexPrompt.ts`, ділянка
AI-коуча в `server.ts` (`/api/ai/coach-*`), `src/components/TrainersView.tsx`,
`src/components/StyleTrainer.tsx`, `src/components/TrainerView.tsx`,
`src/context/WriterBookContext.tsx`, `src/types.ts`, журнал `log/119-151.md`
запис №156.

---

## 1. Ключове рішення: не будуємо паралельну систему оцінювання — вмикаємось у WDI

У продукті вже є фундамент саме для цього — WDI (Writer Development Index,
запис №156): журнал доказів `writer_evidence` (append-only, бал завжди
згортається з журналу, а не зберігається як змінне поле), десять вимірюваних
компетенцій (`server/wdi.ts::WDI_SKILLS`), і серед них уже існує
**`emotion_reader_impact`** («Емоційний вплив», категорія «Емоції») —
компетенція, для якої в проєкті ще НЕМАЄ жодного постачальника доказів.
Запис №156 прямо називає це наступним кроком: *«Докази ще нізвідки не
записуються: маршрути коуча не змінені. Це наступний крок — саме з того, що
коуч уже вміє»*.

**Рішення:** «Емоційна майстерність письменника» — це і є той наступний крок.
Кожен аналіз фрагмента не лише повертає детальний результат (як того вимагає
ваше ТЗ), а й дописує ОДИН запис у `writer_evidence` зі `skill:
'emotion_reader_impact'`, `type: 'TEXT_ANALYSIS'`. «Поріг» так само дописує
докази під компетенцію `character_craft` (обґрунтування — розділ 6.4).

Це не заміна вашої деталізованої моделі (10 критеріїв майстерності, таксономія
емоцій, доказовість цитатами) — вона лишається повністю, у власних таблицях
(розділ 3). WDI — це ЩЕ один, вужчий зріз того самого результату: один
підсумковий сигнал «за/проти» компетенції, у ту саму загальну шкалу, де вже
живуть інші дев'ять навичок письменника. Без цього кроку в продукті існували б
дві незалежні системи прогресу автора, що показують різні числа про одне й те
саме — цього свідомо уникали в записі №156.

**Наслідок для «Профілю емоцій автора» (п. 18 вашого ТЗ):** не зберігаємо
`author_emotion_profile` як окрему таблицю з мутабельним станом. Це порушило б
головний принцип WDI («бал — проєкція журналу, а не збережене поле» — записано
в коді `wdi.ts` як явний архітектурний вибір, а не недогляд). Профіль
рахується на льоту з `emotion_analysis`/`emotion_mastery_scores` (розділ 3.6) —
той самий підхід, що й `projectSkill()`/`projectAll()` у `wdi.ts`. Це відхилення
від буквального переліку таблиць у вашому ТЗ — прошу підтвердити в розділі 8.

---

## 2. Точка входу: два нові підрозділи в «Тренажерах письменника»

### 2.1 Чому не CoachModal і не TrainerView «з коробки»

`TrainersView.tsx` зараз має три вкладки (`style` / `character` / `dialogue`).
`CharacterTrainer.tsx` і `DialogueTrainer.tsx` — тонкі конфігурації (14 рядків
кожна) над спільним рушієм `TrainerView.tsx`: він задає ОДНЕ цільове питання
й оцінює ВІДПОВІДЬ автора на нього. Наші два модулі аналізують не відповідь на
питання, а **реальний фрагмент тексту сцени** — це інша задача, так само, як
`StyleTrainer.tsx` (618 рядків) є не конфігурацією `TrainerView`, а повністю
власним компонентом. `CoachModal`, у свою чергу, прив'язаний до виділення в
самому редакторі («Книга і текст») — ви явно обрали НЕ цю точку входу.

**Рішення:** два нові самостійні компоненти за зразком `StyleTrainer.tsx`:
`src/components/EmotionMasteryTrainer.tsx` і `src/components/ThresholdTrainer.tsx`,
підключені як 4-та і 5-та вкладки `TrainersView.tsx` (`TrainerKind` →
`'style' | 'character' | 'dialogue' | 'emotion' | 'threshold'`). П'ять вкладок
в один ряд на вузькому екрані не влізуть без переробки — це UI-деталь, не
архітектурне рішення, вирішується на етапі верстки (перенос у два ряди або
горизонтальний скрол, як варіанти).

### 2.2 Звідки береться текст для аналізу

`StyleTrainer.tsx` уже показує зразок: `useWriterBook()` дає `bookExcerpts` —
готовий список реальних уривків (глава → розділ) з живої книги автора,
побудований у `WriterBookContext.tsx::buildExcerpts()` (очищення розмітки,
обрізання до 6000 символів на розділ). Обидва нові тренажери отримують той
самий пікер «оберіть уривок» + текстове поле «або вставте свій фрагмент» —
ваше ТЗ явно каже «виділений текст», не обов'язково цілий розділ, тож ручне
вставлення/редагування залишається поряд з пікером, а не замість нього.

Контекст (`previousParagraph`/`nextParagraph`/`sceneSummary` з п. 16 вашого
ТЗ) береться автоматично з сусідніх абзаців/розділу того самого уривка —
додаткового UI для цього не треба.

---

## 3. Дані: нові таблиці SQLite (`server/db.ts`)

Слідую наявній конвенції: `TEXT PRIMARY KEY` з префіксом (`ev_${randomUUID()}`
у WDI), `snake_case`, `created_at`/`updated_at` як ISO-рядки, `UNIQUE(user_id,
…)` для ідемпотентності на рівні бази (не коду) — та сама причина, що й у
`writer_evidence`: повторний аналіз того самого фрагмента не повинен
множити записи чи докази.

**Важлива адаптація термінів ТЗ під реальну модель Nova:** у вашому ТЗ —
`project_id`. У Nova немає сутності «проєкт» — є `user_id` (автор) і опційний
`book_id`, саме так уже скопована вся аналітична БД (WDI, чат-сесії). Приймаю
цю заміну без окремого підтвердження — вона механічна.

**Ще одна адаптація:** `Scene` у Nova не є SQL-рядком — це вкладений об'єкт
усередині JSON-документа книги (`Section.scene`, `src/types.ts`). Тому
`scene_id` у нових таблицях — це м'яке посилання (значення `Scene.id` на
момент аналізу), без `FOREIGN KEY`: той самий тип зв'язку, що й `book_id` у
`chat_sessions` сьогодні (немає `FOREIGN KEY … REFERENCES books`).

### 3.1 `emotion_dictionary`

Розширюваний словник емоцій (п. 3 ТЗ). Насіння — 9 категорій × ~6 емоцій із
вашої таксономії, завантажене one-time сідом при міграції; `is_custom`
дозволяє власнику додавати нові пізніше через адмінку (окремий екран —
поза межами цього етапу, розділ 7).

```sql
CREATE TABLE IF NOT EXISTS emotion_dictionary (
  id          TEXT PRIMARY KEY,      -- машинний код, напр. 'fear', 'guilt'
  category    TEXT NOT NULL,         -- 'fear'|'anger'|'loss'|'joy'|'attachment'
                                      -- |'self_evaluative'|'future'|'social'|'orientation'
  label_uk    TEXT NOT NULL,
  is_custom   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
```

### 3.2 `emotion_analysis` — один аналізований фрагмент

```sql
CREATE TABLE IF NOT EXISTS emotion_analysis (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  book_id               TEXT,
  scene_id              TEXT,                 -- м'яке посилання, без FK (див. вище)
  character_id          TEXT,                 -- м'яке посилання на Character.id
  character_name        TEXT NOT NULL,        -- фолбек, якщо AI не зіставив із карткою
  selected_text          TEXT NOT NULL,        -- сам фрагмент (для показу доказів/цитат)
  selected_text_hash     TEXT NOT NULL,
  primary_emotion_id     TEXT NOT NULL,
  primary_probability    REAL NOT NULL,
  primary_intensity      REAL NOT NULL,        -- 0..10
  mastery_score          REAL NOT NULL,        -- 0..100, рахує СЕРВЕР (розділ 5.1), не AI
  threshold_impact       REAL NOT NULL,        -- 0..10
  confidence              REAL NOT NULL,        -- 0..1
  model_version           TEXT NOT NULL,
  prompt_version           TEXT NOT NULL,
  rubric_version            TEXT NOT NULL,
  taxonomy_version           TEXT NOT NULL,
  created_at                  TEXT NOT NULL,
  UNIQUE(user_id, selected_text_hash)
);
CREATE INDEX IF NOT EXISTS idx_emotion_analysis_user ON emotion_analysis(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emotion_analysis_book ON emotion_analysis(book_id);
```

`mastery_level` («дуже слабко» … «майстерно») НЕ зберігається — виводиться з
`mastery_score` функцією на кшталт `masteryFor()` у `wdi.ts` (той самий
принцип: стан завжди похідний, ніколи окреме поле, що може розсинхронізуватись).

### 3.3 `emotion_candidates` — вторинні та приховані емоції

```sql
CREATE TABLE IF NOT EXISTS emotion_candidates (
  id           TEXT PRIMARY KEY,
  analysis_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,   -- 'secondary' | 'hidden'
  emotion_id   TEXT NOT NULL,
  probability  REAL NOT NULL,
  intensity    REAL NOT NULL,
  FOREIGN KEY (analysis_id) REFERENCES emotion_analysis(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_emotion_candidates_analysis ON emotion_candidates(analysis_id);
```

### 3.4 `emotion_mastery_scores` — 10 критеріїв, по одному рядку кожен

```sql
CREATE TABLE IF NOT EXISTS emotion_mastery_scores (
  id           TEXT PRIMARY KEY,
  analysis_id  TEXT NOT NULL,
  criterion    TEXT NOT NULL,   -- trigger|stakes|body|thoughts|behavior|
                                 -- specificity|subtext|dynamics|individuality|reader_effect
  score        REAL NOT NULL,   -- 0..10, сервер валідує/затискає (розділ 5.1)
  FOREIGN KEY (analysis_id) REFERENCES emotion_analysis(id) ON DELETE CASCADE
);
```

### 3.5 `emotion_evidence` — докази під кожен критерій (п. 10 ТЗ)

```sql
CREATE TABLE IF NOT EXISTS emotion_evidence (
  id           TEXT PRIMARY KEY,
  analysis_id  TEXT NOT NULL,
  criterion    TEXT NOT NULL,
  quote        TEXT NOT NULL,
  explanation  TEXT NOT NULL,
  FOREIGN KEY (analysis_id) REFERENCES emotion_analysis(id) ON DELETE CASCADE
);
```

### 3.6 `emotion_timeline` — емоційна крива для довгих виділень (п. 13 ТЗ)

```sql
CREATE TABLE IF NOT EXISTS emotion_timeline (
  id           TEXT PRIMARY KEY,
  analysis_id  TEXT NOT NULL,
  order_index  INTEGER NOT NULL,
  emotion_id   TEXT NOT NULL,
  intensity    REAL NOT NULL,
  FOREIGN KEY (analysis_id) REFERENCES emotion_analysis(id) ON DELETE CASCADE
);
```

Порожня для коротких фрагментів (де немає розвитку емоції) — це нормально, не
помилка.

**«Профіль автора» (п. 18 ТЗ)** — НЕ таблиця (розділ 1), а функція
`projectAuthorEmotionProfile(userId)` у новому `server/emotionMasteryProjection.ts`:
групує `emotion_analysis` за `primary_emotion_id`, рахує середній
`mastery_score`, кількість фрагментів і `reliability` (частка фрагментів із
`confidence ≥ 0.75`) — так само, як `wdiStatus()` визначає довіру до
загального балу з кількості й якості доказів, а не окремим полем.

### 3.7 Таблиці «Порога»

```sql
CREATE TABLE IF NOT EXISTS thresholds (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  book_id           TEXT,
  character_id      TEXT,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  types             TEXT NOT NULL,        -- JSON-масив ThresholdType, напр. '["moral","relationship"]'
  before_state      TEXT NOT NULL,
  choice            TEXT NOT NULL,
  crossing_action   TEXT NOT NULL,
  after_state       TEXT NOT NULL,
  risk_physical     INTEGER NOT NULL,     -- 1..10, див. розділ 8 щодо risk_* vs окремої таблиці
  risk_emotional    INTEGER NOT NULL,
  risk_social       INTEGER NOT NULL,
  risk_material     INTEGER NOT NULL,
  risk_existential  INTEGER NOT NULL,
  cost              INTEGER NOT NULL,
  irreversibility   INTEGER NOT NULL,
  transformation    INTEGER NOT NULL,
  awareness         INTEGER NOT NULL DEFAULT 5,
  agency            INTEGER NOT NULL DEFAULT 5,
  score             REAL NOT NULL,        -- рахує сервер при кожному save (розділ 5.2), зберігаємо для сортування/фільтра
  status            TEXT NOT NULL DEFAULT 'planned',
  consequences      TEXT NOT NULL DEFAULT '[]',  -- JSON-масив рядків
  confidence        REAL,                 -- AI-впевненість кандидата, до підтвердження автором
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thresholds_user ON thresholds(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_thresholds_book ON thresholds(book_id);

CREATE TABLE IF NOT EXISTS threshold_scene_links (
  id            TEXT PRIMARY KEY,
  threshold_id  TEXT NOT NULL,
  scene_id      TEXT NOT NULL,    -- м'яке посилання, без FK
  role          TEXT NOT NULL,    -- preparation | crossing | consequence
  order_index   INTEGER NOT NULL,
  FOREIGN KEY (threshold_id) REFERENCES thresholds(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_threshold_scene_links_threshold ON threshold_scene_links(threshold_id);

CREATE TABLE IF NOT EXISTS avoided_thresholds (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL,
  book_id                TEXT,
  character_id           TEXT,
  development_area       TEXT NOT NULL,   -- autonomy|identity|... (п. 10 ТЗ «Поріг»)
  threshold_description  TEXT NOT NULL,
  fear                   TEXT NOT NULL,
  avoidance_behavior     TEXT NOT NULL,
  short_term_reward      TEXT NOT NULL,
  long_term_cost         TEXT NOT NULL,
  repetitions            INTEGER NOT NULL DEFAULT 1,
  severity               INTEGER NOT NULL DEFAULT 5,
  next_opportunity       TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_avoided_thresholds_user ON avoided_thresholds(user_id, updated_at DESC);
```

`threshold_risks`/`threshold_types`/`threshold_consequences` із п. 14 вашого
ТЗ як окремі таблиці — свідомо НЕ зробив (замінив на колонки/JSON-поле вище).
Обґрунтування й альтернатива — розділ 8, п. 1: це прошу підтвердити окремо,
бо це відхилення від буквального переліку таблиць.

---

## 4. Головний архітектурний принцип, спільний для обох модулів

**AI пропонує структуровані, підкріплені цитатами сигнали. Фінальне число
завжди рахує детермінований TS-код сервера, а не AI.**

Це не новий принцип для Nova — саме так уже влаштований AI-коуч
(`resolveCoachEngine`/`generateAiText` повертає JSON, сервер його парсить і
віддає як є для коуча, БЕЗ подальшого рахунку — але коуч і не виставляє
підсумкову оцінку 0–100). У вашому ТЗ цей принцип прописаний прямо: Python-код
розділу 8 має `validate()`/`mastery_score()`/`mastery_level()` як окремі,
чисті, тестовані функції над структурою, яку могла заповнити хоч AI, хоч
людина вручну. Переношу МАТЕМАТИКУ (ваги, формули, пороги рівнів) 1:1 з
Python у TypeScript — AI ніколи не повертає вже порахований `mastery_score`
чи `threshold.score()`, лише сирі 0–10 бали по критеріях/полях.

**Наслідок:** якщо AI поверне зіпсований чи виходить-за-межі JSON —
`validate()`-еквівалент на сервері затискає значення (`clamp`, як
у `wdiStore.ts::clamp()`) і НЕ падає всю відповідь через одне погане поле —
той самий підхід, що й `recordMany()` у WDI не валиться через один поганий
доказ.

---

## 5. Нові чисті TS-модулі (порт формул із ТЗ, без AI, без БД — юніт-тестовані)

### 5.1 `server/emotionMasteryScoring.ts`

Порт `MASTERY_WEIGHTS` (п. 7 ТЗ) і методів `validate()`/`mastery_score()`/
`mastery_level()` з `CharacterEmotionAnalysis` (п. 8 ТЗ). Сигнатура:

```ts
export const MASTERY_WEIGHTS: Record<MasteryCriterion, number> = { /* ті самі 10 ваг */ };
export function validateMasteryScores(raw: Partial<Record<MasteryCriterion, number>>):
  Record<MasteryCriterion, number>;  // затискає кожне 0..10, замінює відсутні на 0 (а не кидає)
export function computeMasteryScore(scores: Record<MasteryCriterion, number>): number; // 0..100
export function masteryLevelUk(score: number): string; // «дуже слабко» … «майстерно», ваші пороги 20/40/60/75/90
```

### 5.2 `server/thresholdScoring.ts`

Порт `RiskProfile`/`Threshold` з п. 7 ТЗ «Поріг»: `score()` (формула п. 8:
30% найсильніший ризик + 15% середній + 15% ціна + 20% незворотність + 15%
трансформація + 5% агентність), `strength()`, `is_real_threshold()`,
`feedback()` — усі як чисті функції над валідованим об'єктом, 1:1 логіка з
Python.

### 5.3 Тести — без AI, без БД, за зразком `scripts/test-wdi.mts`

`scripts/test-emotionMasteryScoring.mts`, `scripts/test-thresholdScoring.mts`:
перевіряють саме ОБІЦЯНКИ моделі, як тест WDI перевіряє монотонність ваг
доказів — тут, наприклад: сума ваг `MASTERY_WEIGHTS` дорівнює 1.0 (тест
одразу зловить будь-яку майбутню правку ваги, що розбалансує формулу);
`mastery_score` при всіх критеріях=10 дає рівно 100, при всіх=0 — рівно 0;
`is_real_threshold()` відхиляє кандидата без зміни стану чи без вибору,
навіть якщо ризики високі (точна відповідність прикладам із п. 8 «зворотний
приклад» вашого ТЗ); `feedback()` повертає єдине повідомлення «поріг має
чіткий вибір…», коли всі показники добрі.

---

## 6. AI-шар: промпти, реєстрація в «Ядрі», маршрути

### 6.1 Нові файли промптів (за зразком `readerResponsePrompt.ts`)

`server/emotionMasteryPrompt.ts` і `server/thresholdPrompt.ts` — кожен:
`*SystemInstruction()` (жорсткий JSON-контракт з маркером
`⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ`, як у решти модулів ядра), `factory*Template()`
(user-шаблон із плейсхолдерами), `render*SystemTemplate()`/`render*UserTemplate()`,
і `normalize*()`/`parse*()` — де `normalize*` викликає `validateMasteryScores`/
відповідник `RiskProfile.validate()` з розділу 5, а не дублює клемпінг.

JSON-контракт system-інструкції — практично дослівно п. 9 і п. 11 вашого ТЗ
(вони вже написані як готова схема відповіді AI).

Плейсхолдери `emotionMastery`: `{ФРАГМЕНТ}`, `{КОНТЕКСТ_ДО}`, `{КОНТЕКСТ_ПІСЛЯ}`,
`{ПЕРЕЗЕРВ_СЦЕНИ}`→`{ОПИС_СЦЕНИ}`, `{ПЕРСОНАЖ}`, `{ПРОФІЛЬ_ПЕРСОНАЖА}`,
`{СТОСУНКИ}`, `{ПОТОЧНИЙ_ПОРІГ}`, `{ЖАНР}`, `{НАЗВА_КНИГИ}`, `{МОВА}` — точно
список «Контексту» з п. 16 вашого ТЗ.

Плейсхолдери `threshold`: `{ФРАГМЕНТ}`, `{ПЕРСОНАЖ}`, `{ПРОФІЛЬ_ПЕРСОНАЖА}`,
`{ОПИС_СЦЕНИ}`, `{ЖАНР}`, `{НАЗВА_КНИГИ}`, `{МОВА}`.

### 6.2 Реєстрація в `server/coreAiRegistry.ts`

Додати `'emotionMastery'` і `'threshold'` у `CORE_MODULE_KEYS`, заповнити
`CORE_MODULE_PLACEHOLDERS`, `CORE_MODULE_HAS_JSON_SCHEMA: true` для обох,
`case` у `factoryCoreTemplate()` і в рендер-switch (значення з `fields` —
той самий об'єкт live-прев'ю, що вже живить `characterConsistency`/
`behaviorDrift`/`readerResponse`). Це вмикає обидва модулі в адмінський
конструктор промтів («Ядро AI») БЕЗ жодної додаткової адмінської UI-роботи —
конструктор ітерує `CORE_MODULE_KEYS`, а не хардкодить список.

### 6.3 Маршрути `server.ts`

**`POST /api/ai/emotion-analyze`** — `requirePermission('canUseAi')`, за
зразком `coach-analyze`: перевірка мінімальної довжини фрагмента, `413`
при перевищенні нового `MAX_EMOTION_FRAGMENT_CHARS` (пропоную 20 000 — той
самий принцип явної відмови, що й у `/diagn`/reader-response, число менше за
`MAX_REACTION_INPUT_CHARS=60000`, бо тут аналізується виділення, не ціла
глава) → `resolveModuleModelId('emotionMastery', modelId)` →
`resolveCoreTemplate`/`renderCoreTemplate` → `generateAiText({json:true})` →
`parseEmotionAnalysis` → `validateMasteryScores`/`computeMasteryScore` →
ОДНА транзакція SQLite: вставка в `emotion_analysis` +
`emotion_candidates` + `emotion_mastery_scores` + `emotion_evidence` (+
`emotion_timeline`, якщо AI повернув кілька точок) → `recordEvidence({skill:
'emotion_reader_impact', type: 'TEXT_ANALYSIS', outcome: clamp((mastery_score
- 50) / 50, -1, 1), confidence: aiConfidence, independence: 50, sourceId:
'emo_' + selectedTextHash})` → відповідь клієнту з повним записом.

`independence: 50` — нейтральне тимчасове значення (розділ 8, п. 3): у WDI
воно означає «наскільки це зробив автор сам», а тут перший прохід — це AI, що
аналізує вже написаний автором текст, не підказує рішення. Точнішу модель
(підвищення незалежності при REVISION_LOOP — повторний аналіз ТІЄЇ Ж сцени
після редагування з покращенням) не будую зараз: за аналогією з тим, чому
`wdi.ts` свідомо не вводить згасання доказів за часом — «спершу треба
побачити реальні дані».

**`POST /api/ai/threshold-analyze`** — та сама структура, але результат НЕ
зберігається автоматично: AI лише ПРОПОНУЄ кандидата (як каже п. 12 вашого
ТЗ: «пояснити… не переписувати»). Повертає `{candidate, feedback}` (порахований
`server/thresholdScoring.ts`), нічого не пише в БД.

**`POST /api/thresholds`**, **`PUT /api/thresholds/:id`**, **`GET
/api/thresholds?bookId=`**, аналогічно **`/api/avoided-thresholds`** —
звичайні CRUD-маршрути (не `canUseAi` — це вже підтверджені автором дані,
той самий поділ, що й «AI пропонує медіа → автор зберігає в медіатеку»
деінде в продукті). Саме тут, при збереженні, `server/thresholdScoring.ts`
рахує `score()`, і якщо `is_real_threshold()` — `recordEvidence({skill:
'character_craft', …})`.

### 6.4 Чому доказ «Порога» йде в `character_craft`, а НЕ прямо в `score()`

Це найважливіше рішення, яке прошу звірити окремо (розділ 8, п. 2).

`Threshold.score()` вимірює **силу/значущість самої сюжетної події** (високі
ставки, незворотність) — це судження про СЮЖЕТ, не про майстерність
ПИСЬМА. Слабкий поріг (низький `score()`) не означає, що автор погано
написав сцену — можливо, це свідомо тихий, побутовий поріг. Тому пряме
відображення `score()` у WDI-доказ (як спочатку напрошується за аналогією з
Emotion Mastery) було б хибним.

**Натомість** доказ вимірює ПОВНОТУ розкладки, яку зробив автор: чи
розпізнав AI справжній поріг (`is_real_threshold() === true`) і чи короткий
список `feedback()` (мало зауважень = автор сам уже продумав вибір/ставки/
незворотність/трансформацію до того, як інструмент це показав). `outcome =
is_real_threshold ? clamp(1 - feedback.length / 6, -1, 1) : -0.3` (шаблонний
`feedback()` завжди повертає 1–6 пунктів, розділ 7 ТЗ). Це ближче до духу
WDI: докази вимірюють РОБОТУ автора, а не «оцінку» сюжетної події.

---

## 7. Свідомо поза межами цього етапу

- Розширюваний словник емоцій через адмінський UI (додавання нових emotion_id
  без релізу коду) — таблиця готова (`emotion_dictionary.is_custom`), екран
  керування — ні.
- `ThresholdGuardian`/`FalseThreshold`/`ForcedThreshold`/`FailedThreshold`/
  `ReversedThreshold`/`RepeatedThreshold`/`FinalThreshold` (п. 15 ТЗ «Поріг») —
  явно названі у вас як майбутні розширення, не цей етап.
- Повноцінні сутності `Conflict`/`Decision`/`Consequence` як окремі таблиці
  чи записи книги (п. 21 ТЗ «Поріг» згадує інтеграцію з ними) — у Nova їх
  СЬОГОДНІ немає навіть як полів `Book`/`Scene` (є лише `Scene.conflict:
  string` і `Scene.resolution: string`, вільний текст). Будувати для них
  повноцінну модель — окремий, набагато більший проєкт. У цьому етапі
  «вибір/причина/наслідок» лишаються текстовими полями всередині самого
  `Threshold`, як у вашому Python-коді (`before_state`/`choice`/
  `crossing_action`/`after_state`/`consequences: List[str]`) — це НЕ втрата
  функціоналу відносно ТЗ, буквальні окремі сутності Conflict/Decision там
  теж не прописані як таблиці.
- Згасання WDI-доказів за часом — уже задокументована відкрита межа
  `wdi.ts`, обидва нові модулі успадковують це рішення, не переглядають його.
- Інтеграція з «Шляхом героя» (`heroArc`, п. 13/17 ТЗ «Поріг») — `HeroArcState`
  сьогодні це 13 текстових відповідей + крива інтенсивності всередині JSON
  книги, без структурного зв'язку з конкретними сценами/порогами. Пов'язати
  `thresholds` із конкретним кроком `heroArc` — окремий крок, коли буде
  зрозуміло, як саме (за id кроку? за timelineOrder сцени?).
- Адмінський екран перегляду/експорту нових таблиць — поза межами; дані
  доступні через звичайні REST-маршрути.

---

## 8. Відкриті питання

**Підтверджено власником (окреме повідомлення після першої версії плану):**
обидва модулі формують навик автора через ШІ саме за рахунок ДВОХ ІСНУЮЧИХ
компетенцій WDI — `emotion_reader_impact` і `character_craft`, а не через дві
нові окремі компетенції в дереві. Це закриває пункти 3 і 4 нижче (лишені для
протоколу, з позначкою) і остаточно фіксує рішення розділу 1: WDI 1000 і
структура `WDI_SKILLS`/`wdi.ts` лишаються БЕЗ ЗМІН, нові модулі лише
дописують у журнал `writer_evidence` під наявні id.

Лишається підтвердити перед кодом:

1. **Розділ 3.7:** `threshold_risks`/`threshold_types`/`threshold_consequences`
   як окремі таблиці (буквально за ТЗ, розділ 14) — чи як колонки/JSON-поле
   на `thresholds` (мій варіант вище, простіше, без зайвих JOIN на
   фіксовану, завжди-читану-разом структуру)? Обидва варіанти лишаються
   «повністю реляційними» в сенсі БД — різниця лише в нормалізації одного
   фіксованого 5-елементного профілю ризику.
2. **Розділ 6.4:** доказ «Порога» в WDI рахується від ПОВНОТИ розкладки
   (`is_real_threshold` + короткий `feedback`), а не напряму від `score()`.
   Погоджуєтесь із цим розведенням «сила сюжетної події» ≠ «майстерність
   письма», чи хочете простіше пряме відображення `score()` → `outcome`?
5. **UI, розділ 2.1:** п'ять вкладок тренажерів на вузькому екрані — окрема,
   дрібніша розмова під час верстки, не блокує старт бекенду/AI-шару.

Закрито (власник підтвердив):

3. ~~`author_emotion_profile` рахується на льоту, не зберігається окремою
   таблицею~~ — підтверджено: наявна WDI-модель («бал — проєкція журналу»)
   лишається єдиним джерелом правди, нова таблиця з мутабельним станом не
   заводиться.
4. ~~Компетенція `character_craft` для «Порога» проти `story_architecture`~~ —
   підтверджено `character_craft`, без нової окремої компетенції.

---

## 9. Тести — повний список нових файлів

- `scripts/test-emotionMasteryScoring.mts` — чисті формули (розділ 5.1).
- `scripts/test-thresholdScoring.mts` — чисті формули (розділ 5.2).
- `scripts/test-emotionMasteryPrompt.mts` — `normalize*`/`parse*`, захист від
  зіпсованого/неповного JSON від AI (за зразком `test-readerResponse.mts`).
- `scripts/test-thresholdPrompt.mts` — те саме для «Порога».
- Розширення `scripts/test-wdi.mts` НЕ потрібне: нові виклики `recordEvidence`
  проходять крізь уже протестовану функцію без змін її контракту.
