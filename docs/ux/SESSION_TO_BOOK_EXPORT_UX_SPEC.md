# UX/UE ТЗ — Session Engine → «Книга & Текст» / «Герої» / «Медіатека»

## 1. Мета

Додати до Story & Experience Engine інтеграційний UX, який дозволяє письменнику перетворювати завершені сесії **Mafia / Constellation / Leela** на матеріал книги, не копіюючи дані вручну.

Ключова продуктова ідея: прожитий або зіграний досвід стає структурованим джерелом для художнього тексту, персонажів і візуальних образів, при цьому конфіденційність учасників зберігається через явний контроль анонімізації.

UX-шар не реалізує backend-анонімізацію, генерацію тексту, створення записів у БД, permissions або image pipeline. Він задає екрани, стани, interaction contract і очікувані результати для технічного шару.

---

## 2. Основний user flow

`Completed Session → Export to Book → Privacy / Anonymization → Participant Mapping → Story Format → Character Creation → Image Generation → Review → Save to Book & Text / Characters / Media Library`

Початкова точка: `SessionCompletionView` після завершення сесії.

Нова primary action:

**«Перетворити сесію на матеріал книги»**

Додаткові швидкі дії:

- «Експортувати в Книга & Текст»;
- «Створити героїв книги»;
- «Створити анонімізовану історію»;
- «Створити художню адаптацію»;
- «Згенерувати образи героїв».

---

## 3. Інтеграція з «Книга & Текст»

### 3.1. Що можна створити із сесії

Користувач обирає один або кілька форматів:

- чернетка глави;
- сцена;
- серія сцен;
- коротка розповідь;
- автобіографічна / документальна нотатка;
- художня адаптація;
- outline / план глави;
- timeline подій;
- авторські нотатки;
- карта конфлікту;
- список тем і мотивів.

### 3.2. Експорт не повинен створювати лише «один великий текст»

У review-екрані окремо показуються результати:

- текстові блоки;
- сцени;
- герої;
- зв’язки героїв;
- timeline;
- медіа-запити;
- джерело походження.

### 3.3. Provenance у «Книга & Текст»

Для матеріалу, створеного із сесії, UX показує source badge:

- тип джерела: Mafia / Constellation / Leela;
- дата сесії;
- session title;
- режим анонімізації;
- linked snapshot;
- linked characters;
- linked media.

Автор повинен мати можливість відкрити source info без показу приватних participant-only / moderator-only полів.

---

## 4. Новий wizard `SessionExportToBookView`

Wizard складається з 6 обов’язкових кроків.

### Step 1 — Джерело

Заголовок: **«Що використати із сесії?»**

Опції:

- уся сесія;
- лише summary;
- вибрані події;
- вибрані сцени / ходи;
- вибрані репліки;
- вибрані snapshots;
- лише обрані учасники / герої.

Для Mafia можна вибирати game events / votes / reveals / role interactions.

Для Constellation — snapshots, figure movements, neutral session events, facilitator-approved notes.

Для Leela — ходи, клітини, journal entries, маршрут, approved reflections.

UX не повинен автоматично включати hidden/moderator-only дані.

### Step 2 — Формат результату

Заголовок: **«У що перетворити матеріал?»**

Картки:

- Глава;
- Сцена;
- Серія сцен;
- Розповідь;
- Художня адаптація;
- Outline;
- Нотатки автора.

Користувач може вибрати кілька форматів.

### Step 3 — Конфіденційність і анонімізація

Заголовок: **«Як захистити учасників?»**

Режими:

#### A. Без анонімізації

Показати warning: підходить лише для матеріалу, де автор має право використовувати справжні дані.

#### B. Заміна імен

- справжні імена не потрапляють у book export payload;
- кожному учаснику призначається вигадане ім’я;
- автор може прийняти AI-варіант або ввести ім’я вручну.

#### C. Помірна анонімізація

Крім імен можна змінити / узагальнити:

- вік;
- професію;
- місце;
- зовнішні прикмети;
- другорядні біографічні деталі.

#### D. Fiction Mode

Реальна сесія використовується лише як структурне джерело.

UX показує, що AI може змінювати:

- імена;
- вік;
- стать / гендерне представлення, якщо автор обирає;
- професії;
- локації;
- послідовність частини подій;
- другорядні обставини;
- образи персонажів.

При цьому ключовий драматургічний досвід може бути збережений як основа історії.

### Step 4 — Mapping учасників у героїв

Компонент: `ParticipantToCharacterMapper`.

Для кожного учасника рядок / card:

- source participant label;
- реальне ім’я показується лише у приватній source-зоні;
- proposed fictional name;
- роль у сесії;
- роль у книзі;
- action:
  - створити нового героя;
  - зв’язати з існуючим героєм;
  - пропустити;
  - об’єднати з іншим учасником;
  - розділити на кілька художніх образів.

AI action:

**«Запропонувати вигадане ім’я»**

Допускається пакетна дія:

**«Анонімізувати всі імена»**

Правило UX: після заміни справжнє ім’я не повинно повторно з’являтися у preview generated story.

### Step 5 — Герої та образи

Для кожного mapped hero показати mini character card:

- fictional name;
- story role;
- archetype;
- goal;
- conflict;
- fear / tension;
- relationships;
- source session badge;
- anonymity level.

Дії:

- «Створити картку героя»;
- «Відкрити існуючу картку»;
- «Згенерувати образ»;
- «Вибрати з Медіатеки».

### Step 6 — Review & Save

Екран перед збереженням показує:

- що буде створено у «Книга & Текст»;
- скільки нових героїв;
- скільки existing characters буде linked;
- скільки images planned;
- режим анонімізації;
- source session;
- список excluded sensitive data.

Primary action:

**«Створити матеріал книги»**

Secondary:

- «Назад до редагування»;
- «Зберегти як чернетку експорту»;
- «Скасувати».

---

## 5. `SessionAnonymizationPanel`

Компонент має бути повторно використаний як у wizard, так і в Session History / Archive.

### Поля

- mode;
- fictional naming strategy;
- preserve role yes/no;
- preserve age yes/no;
- preserve gender yes/no;
- preserve occupation yes/no;
- preserve location yes/no;
- remove direct quotes yes/no;
- remove facilitator/GM notes — locked ON by default;
- remove private reflections unless explicitly allowed — locked ON by default.

### UX правило

`moderator-only`, `facilitator-only`, `private`, `secret`, `sensitive` поля не включаються автоматично.

Вони можуть потрапити у export flow лише якщо product/permission layer повернув explicit export permission.

UI не робить security filtering постфактум.

---

## 6. Перетворення учасників у повноцінні карти «Героїв»

### 6.1. Джерела character fields

Із сесії можна запропонувати для героя:

- fictional name;
- role in story;
- archetype;
- goal;
- motivation;
- conflict;
- fear / tension;
- behavior traits;
- key phrases;
- relationships;
- linked scenes;
- important events;
- author notes.

AI proposals завжди мають бути editable до створення character record.

### 6.2. Source metadata у картці героя

Додати UX-блок **«Походження героя»**:

- `Created from Session`;
- session type;
- session date;
- source participant mapping status;
- anonymity level;
- linked session snapshot;
- author note: «fictionalized from real experience».

Реальна identity participant не показується в загальній character card, якщо ввімкнено анонімізацію.

### 6.3. Merge / split

Обов’язкові сценарії:

- кілька учасників → один composite character;
- один participant → кілька fictional characters;
- participant → existing hero;
- participant → ignored/source-only.

---

## 7. Генерація зображень героя

Компонент: `CharacterImageGenerationPanel`.

### Entry points

- Session Export Wizard;
- character card;
- Media Library.

### Стилі

- реалістичний портрет;
- кінематографічний;
- книжкова ілюстрація;
- графічний роман;
- silhouette / anonymized portrait;
- fantasy / sci-fi adaptation;
- custom style from book theme.

### Privacy UX

За замовчуванням для героя, створеного з реального participant, не використовувати реальну зовнішність.

Показати mode:

**«Створити новий художній образ, не копіюючи зовнішність учасника»** — default ON.

Якщо колись технічний шар дозволятиме reference image реального participant, це повинна бути окрема explicit consent flow і не є частиною базового UX цього ТЗ.

### Після генерації

Зображення можна:

- зберегти в Медіатеку;
- призначити primary portrait героя;
- додати alternate portrait;
- використати в scene illustration;
- regenerate / choose variant.

---

## 8. Інтеграція з Медіатекою

У Media Library додати source/filter metadata:

- `Generated for Character`;
- linked hero;
- linked book;
- linked source session;
- generated style;
- privacy mode;
- primary / alternative portrait.

Фільтр:

**«Образи героїв із сесій»**.

---

## 9. Інтеграція з Session Completion

У `SessionCompletionView` додати section:

### «Перетворити досвід на книгу»

Primary CTA:

**«Відкрити майстер експорту»**

Quick actions:

- «Створити героїв»;
- «Анонімізувати імена»;
- «Створити главу»;
- «Створити художню адаптацію»;
- «Згенерувати образи».

Цей блок показується після summary/archive, але до переходу в next session.

---

## 10. Інтеграція з Session History / Archive

Для завершеної archived session додати action:

**«Використати у книзі»**.

Повторний export дозволений.

Кожен export має показувати статус:

- not exported;
- draft export;
- exported to book;
- linked to chapter;
- characters created;
- updated after source changes.

UX повинен попереджати, якщо вже існує export з тієї ж сесії, щоб автор не створював дублікати випадково.

---

## 11. AI use cases у цьому flow

AI може:

- запропонувати fictional names;
- запропонувати fictionalized character profile;
- перетворити chronology у драматургічну структуру;
- запропонувати scenes;
- створити outline;
- створити first draft;
- запропонувати narrative POV;
- запропонувати image prompt для героя.

AI не має:

- автоматично публікувати результат;
- автоматично записувати generated story у canonical text без підтвердження автора;
- вважати психологічну інтерпретацію учасника фактом;
- знімати privacy restrictions;
- самостійно визначати право на використання реальних персональних даних.

---

## 12. Специфіка по модулях

### 12.1. Mafia → Book

Доступні story primitives:

- ролі;
- союзи;
- конфлікти;
- події;
- голосування;
- reveal;
- секрети, якщо дозволені export policy;
- ключові рішення.

Типові результати:

- детективна сцена;
- thriller chapter;
- ensemble cast;
- relationship graph.

### 12.2. Constellation → Book

Доступні лише нейтральні session primitives:

- figure positions;
- changes of position;
- snapshots;
- participant-approved statements;
- facilitator-approved neutral process notes.

Не переносити як фактичні твердження:

- психологічні діагнози;
- медичні висновки;
- «об’єктивні» трактування внутрішнього стану людини.

Для художньої адаптації AI може перетворювати нейтральну структуру сесії на fictional scene після підтвердження автора.

### 12.3. Leela → Book

Доступні:

- маршрут;
- ходи;
- клітини;
- питання;
- participant-owned journal entries, якщо дозволені;
- авторські рефлексії.

Не представляти духовні чи психологічні трактування як об’єктивну істину.

---

## 13. Основні компоненти

### `SessionExportToBookView`

Wizard container.

### `SessionSourcePicker`

Вибір частини session snapshot.

### `SessionAnonymizationPanel`

Privacy / anonymization settings.

### `ParticipantToCharacterMapper`

Mapping participant → fictional hero / existing hero / skip / merge / split.

### `FictionalNameGeneratorControl`

AI-name proposal + manual override.

### `SessionStoryFormatPicker`

Chapter / scene / story / outline / notes.

### `CharacterDraftCard`

Preview майбутньої картки героя.

### `CharacterImageGenerationPanel`

Image prompt / style / generate / library selection.

### `SessionToBookReview`

Final review перед створенням.

### `SessionSourceBadge`

Reusable provenance UI у Book & Text / Character / Media Library.

---

## 14. Стани UX

Для export wizard:

- idle;
- selecting-source;
- configuring-privacy;
- mapping-characters;
- generating-names;
- preparing-draft;
- reviewing;
- saving;
- success;
- partial-success;
- error.

### Partial success приклад

Текст книги створено, але 2 image-generation tasks не завершилися.

UX не повинен rollback-ити вже створений текст автоматично. Показати, що саме успішно створено, і дозволити повторити тільки незавершені кроки.

---

## 15. Empty / error / retry states

### No eligible content

«У цій сесії немає матеріалу, дозволеного для експорту».

### No participants selected

Export тексту можливий, але character creation section показує empty state.

### AI unavailable

Дозволити manual flow:

- ввести fictional names вручну;
- створити character cards вручну;
- експортувати source summary без AI rewrite.

### Image generation unavailable

Не блокувати book export. Показати «Створити образи пізніше».

---

## 16. Accessibility / responsive

- wizard usable на desktop/tablet/mobile;
- step navigation keyboard-accessible;
- status не передається лише кольором;
- consent/privacy warnings мають `role="alert"` або `aria-live` відповідно до контексту;
- participant mapper на mobile переходить із table у stacked cards;
- hero image variants доступні з клавіатури;
- progress stepper має `aria-current="step"`.

---

## 17. Acceptance Criteria

### AC-01

У завершеній Mafia / Constellation / Leela сесії є action «Перетворити сесію на матеріал книги».

### AC-02

Автор може вибрати всю сесію або частину доступного source material.

### AC-03

Є 4 privacy modes: No anonymization / Names only / Moderate / Fiction Mode.

### AC-04

При Names-only і вище кожному selected participant можна призначити fictional name.

### AC-05

AI-proposed ім’я можна відредагувати вручну до save.

### AC-06

Participant можна map у нового героя, existing hero, skip, merge або split.

### AC-07

Створений герой містить source-session metadata і anonymity level.

### AC-08

У character flow є action «Згенерувати образ» та «Вибрати з Медіатеки».

### AC-09

За замовчуванням image generation не копіює зовнішність реального participant.

### AC-10

Generated image можна зберегти в Media Library і призначити primary character portrait.

### AC-11

Автор може створити Chapter / Scene / Scene series / Story / Fiction adaptation / Outline / Notes.

### AC-12

Перед save є review screen із source, privacy mode, characters, media і excluded sensitive data.

### AC-13

Moderator-only / facilitator-only / private / secret / sensitive data не включаються автоматично.

### AC-14

AI unavailable не блокує manual export flow.

### AC-15

Image generation failure не блокує текстовий export.

### AC-16

Після успішного export material з’являється у «Книга & Текст» із source badge.

### AC-17

Створені герої доступні в загальному розділі «Герої» і можуть використовуватися в інших сценах книги.

### AC-18

Generated portraits доступні в Media Library.

### AC-19

Archived session має action «Використати у книзі».

### AC-20

Повторний export тієї самої session показує warning про можливий дубль.

---

## 18. Межа відповідальності технічного агента

Технічний шар реалізує:

- отримання session snapshot;
- permissions / export eligibility;
- source-field filtering;
- anonymization transform;
- fictional-name generation transport;
- story generation transport;
- character create/link/update;
- media generation task;
- persistence;
- provenance ids;
- duplicate detection;
- idempotency;
- retry;
- audit log;
- secure handling of real participant identity.

UX-шар не повинен зберігати real identity у generated book-facing state без explicit technical permission.

---

## 19. Product principle

Сесія не є готовою книгою. Вона є **джерелом досвіду**.

Письменник контролює:

1. що використати;
2. що приховати;
3. кого перетворити на героя;
4. наскільки сильно fictionalize матеріал;
5. який AI-result прийняти;
6. що реально потрапить у канон книги.

Фінальна модель UX:

`Прожитий досвід → контроль конфіденційності → художня трансформація → герої → образи → текст книги`.
