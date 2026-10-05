# Звіт: живі прогони Jev — маршрут ключа → цикл → вузол → браузер

Дата: 05.10.2026 · Журнал: #359 · Код: `server/ai/adapters/jev/index.ts`,
`server/apiKeysRoutes.ts`, `src/components/ApiKeysView.tsx`, `server.ts`,
`server/core/quality/realDeps.ts`, `server/core/workflows/engine/jev.ts`.

Постановка (власник): в адмінпанелі «Провайдери ШІ» зробити поле для ключа Jev,
узяти цей ключ у продукті, протестувати провайдера й дати звіт; далі — прогнати
Jev наживо в браузері.

Мета: перевірити, що ключ, уведений **адміністратором у панелі**, справді
доходить до TypeSafe (System One, модель `jev-1.13.0`) — наскрізь, у тому
самому шляху, яким ходить продукт, і на справжній книзі зі Студії.

## 1. Маршрут ключа

| Крок | Що відбувається |
|---|---|
| Ввід | `PUT /api/account/api-keys/typesafe` (панель «Ключі API» → секція «Рішення Jev (TypeSafe)») |
| Сховище | `user_api_keys` (SQLite), ключ зашифровано (`USER_API_KEY_SECRET`), назад не віддається — лише `fingerprint` |
| Читання в продукті | `platformKeyFor('typesafe')` (`server/platformKeys.ts`) — ключ **першого адміністратора**, який розшифровується |
| Запасний шлях | `jevKeyFromEnv()` — `JEV_API_KEY`, потім `TYPESAFE_API_KEY` |
| Транспорт | `HttpJevAdapter` → `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer` |
| Споживачі | `server.ts` (`flc.jev`, `interview.workflows`), `realDeps.ts` (прогони якості), `character_voice` (вузол `JEV_DECISION_BUNDLE`) |

**Що знайдено на вході.** У `.env` власника ключ лежав як `JEV_API_KEY`, а код
читав лише `TYPESAFE_API_KEY` — тобто ключ у оточенні був, а продукт його не
бачив. Виправлено в #359: спільні `JEV_ENV_KEYS` / `jevKeyFromEnv()` /
`jevModelFromEnv()`.

## 2. Прогін A — маршрут ключа (без книги)

Тимчасовий скрипт підняв ті самі Express-маршрути панелі; ключ узято з `.env`.

1. `GET /api/account/api-keys` → рядок `{ engine: 'typesafe', label: 'Jev (TypeSafe System One)', kind: 'decision', configured: false }`.
2. `PUT /api/account/api-keys/typesafe` з ключем → **200**, `configured: true`, відбиток `31f97133`.
3. `POST /api/account/api-keys/typesafe/test` → `{"ok":true,"source":"платформний ключ із цієї панелі","last4":"0ebd","modelId":"jev-1.13.0"}`;
   у лог сервера пішло `[key-test] typesafe: ключ — платформний («Ключі API»), відбиток 31f97133`.
4. `DELETE` ключа → повторна перевірка `{"ok":false, "error":"Ключа немає ніде: ні в цій панелі, ні у змінній оточення JEV_API_KEY або TYPESAFE_API_KEY."}`.
5. Окремий сирий запит до `api.typesafe.ai/v1/systemone` тим самим ключем →
   `{"model":"jev-1.13.0","answers":{"next_action":{"choice":"silent","probabilities":{"talk":0.35,"silent":0.65},"confidence":0.3}},"usage":{"input_tokens":326,"output_tokens":32}}`.

**Висновок A:** ключ із панелі справді стає платформним і справді ходить у TypeSafe.

## 3. Прогін B — цикл рішень FLC на реальній книзі

Книга — справжня, зі Студії: **«Тіні Нео-Києва 2084»** (`BK-2084-CYBER`,
2 розділи, 4 персонажі), героїня — **Олена Ковальчук**. Ключ покладено
**лише в БД як платформний**, змінні оточення Jev **очищені**. Прогнано
`runFlcCycle` (режим `levels`: стратегічний → сценічний → тактичний).

| Показник | Значення |
|---|---|
| Звернень до TypeSafe | **4, усі 200** (280–442 мс) |
| Питання | стратегічний `trajectory`, `motive_conflict`; сценічний `scene_motive`, `fear`, `trust`, `risk`; тактичний `next_action`, `style_fit` |
| Рішення | `source: "jev"`, `model: "jev-1.13.0"`, `confidence 0.69`, дія **`deflect`** |
| Рівні | `hold_course` → `avoid_conflict` → `deflect` (усі `source: jev`) |
| Запасний LLM | не задіяно (`fallbackReason: null`) |
| Витрата | 708 вхідних токенів ≈ **$0.00003** |
| Стан | 1613 символів; у ньому — уривки 1-ї глави книги («Скляні куполи Верхнього Печерська… неоновий горизонт Нео-Києва…») і картка Олени з `biography` |

## 4. Прогін C — вузол `JEV_DECISION_BUNDLE` у процесі ШІ

Той самий ключ «з панелі»; на книзі засіяно й опубліковано системні процеси,
Олену зроблено AI-персонажем, і **хід пішов через опублікований процес
`character_voice` (LangGraph v1)**.

| Показник | Значення |
|---|---|
| Запуск | `character_voice` v1, тригер `interview`, **`succeeded`** |
| Вузол `decide` (`JEV_DECISION_BUNDLE`) | `source: "jev"`, `confidence 0.73`, гілка **`out`** (не `fallback`, не `review`) |
| Рішення | «дія: **`deflect`** · мотив сцени: `avoid_conflict`» |
| Розподіл `next_action` | `deflect` 0.78 · `lie` 0.12 · `answer` 0.06 · `silence` 0.03 · `ask` 0.01 |
| Звернень до TypeSafe | **3, усі 200** (254–459 мс) |
| Решта конвеєра | `memory → context → prompt → llm → validate(valid) → answer → end` — пройдено |

## 5. Прогін D — наживо в браузері (справжній сервер + ядро)

`npm run dev` із локальним ядром (`CORE_DATABASE_URL` → контейнер
`nova-core-test`, pgvector): сервер накотив схему v27 і опублікував системні
процеси. Вхід — справжня сесія **адміністратора** (cookie `nova_session`).
Далі — в інтерфейсі: Олену позначено AI-персонажем (рівень «Допит»), відкрито
«Допит», поставлено питання «Олено, де ти була тієї ночі?».

Трасування в «Запусках» Graph Studio:

| Крок | Вузол | Статус | Деталі |
|---:|---|---|---|
| 1 | `Question` (`START`) | `succeeded` | — |
| **2** | **`Hero decision (Рішення героя, Jev)` (`JEV_DECISION_BUNDLE`)** | **`succeeded`** | модель **`jev-1.13.0`**, **83 мс**, «дія: `deflect` · мотив сцени: `avoid_conflict` → out», впевненість **0.76**, токени 772 → 79; розподіл `deflect` 0.80, `lie` 0.10, `answer` 0.05, `silence` 0.03, `ask` 0.01, `confess` 0.00 |
| 3 | `Hero snapshot` (`MEMORY`) | `succeeded` | 25 мс |
| 4 | `History & decision` (`CONTEXT`) | `succeeded` | `deflect` |
| 5 | `Voice template` (`PROMPT`) | `succeeded` | модуль `coreCharacterVoice` |
| 6 | `Voice model` (`LLM`) | `failed` | `This model is currently experiencing high demand…`, далі — ліміт запитів Gemini |

Голос — це **інший провайдер і інший модуль** («Ядро AI» → `coreCharacterVoice`),
не Jev. Щоб довести хід до кінця, модуль **тимчасово** переведено на робочого
провайдера:

- `deepseek-flash` → упав одразу: `Authentication Fails, Your api key: ****3986 is invalid`
  (**ключ `DEEPSEEK_API_KEY` у `.env` невалідний** — знахідка, не правка #359);
- **`gpt-4o` → хід став `answered`**:

  > **Олено, де ти була тієї ночі?**
  > **Олена Ковальчук:** «О, тієї ночі я була вдома, просто намагалася відпочити після важкого дня.»
  > чип рішення: **«дія: ухилитися, змінити тему» з бейджем «Jev»** («намір: Уникнути конфлікту, надавши нейтральну відповідь»).

Тобто Jev обрав `deflect` (0.80), і герой зіграв саме ухиляння — узгоджено.
Пропозиції в канон («Спогад», «Факт (гіпотеза)») показано з «Прийняти /
Виправити / Відхилити», як і належить за ТЗ-H №3 (нічого не змінює канон сам).

Налаштування модуля **повернуто до серверного дефолту** (`PUT modelId: ""` →
мапа перевизначень знову `{}`).

## 6. Підсумок

| Прогін | Що доведено |
|---|---|
| A | ключ із панелі → платформний ключ → TypeSafe (200) |
| B | цикл рішень FLC на реальній книзі — 4/4 звернення 200, рішення `source: jev` |
| C | вузол `JEV_DECISION_BUNDLE` у процесі `character_voice` — `succeeded`, `source: jev` |
| D | те саме в браузері на справжньому сервері; рішення Jev видно в інтерфейсі з бейджем «Jev» |

Разом ≈ **12 звернень до TypeSafe, усі 200**; найдовше — 459 мс, найшвидше —
83 мс; сумарна витрата — десятки копійок за 1 млн токенів, тобто **менше
$0.0002**.

## 7. Знахідки

- **`JEV_API_KEY` не читався кодом** (читався лише `TYPESAFE_API_KEY`) — виправлено в #359.
- **`DEEPSEEK_API_KEY` у `.env` невалідний**: провайдер відповідає
  `Authentication Fails, Your api key: ****3986 is invalid` (той самий клас
  вади, що баг #146). Не виправляли — ключ власника.
- **Профіль героя в прогонах B і C був порожній** (`canon: []`,
  `confirmed_facts: []`): ядро синхронізували в памʼять (`MemoryCoreRepository`)
  без Postgres-схеми `fusion_core`, де живуть знахідки Т1.5 і звʼязки. Jev
  спирався на `recent_appearances` з тексту книги й ситуацію. У прогоні D
  (справжнє ядро) профіль теж лишався бідним, бо книгу не наповнювали
  затвердженими фактами.

## 8. Чого звіт НЕ покриває

- **Прод.** Усе перевірено локально; на Railway ключ у панель вводить власник,
  і саме там перевіриться прод-шлях (після деплою #359).
- **Повний хід зі «штатною» моделлю голосу** не відбувся: Gemini віддавав
  `503`/`429`. Тому хід доведено на тимчасово зміненій моделі (`gpt-4o`), і це
  **не** доводить, що дефолтна модель голосу працює.
- **Канва «Графу твору»** очима не дивилися — трасування відкривали в
  «Запусках».
- **Інші вузли шару рішень** (`JEV_CHOICE`, `JEV_SCORE`, `JEV_NOUL`,
  `JEV_ROUTER`, `JEV_GATE`, `JEV_EVALUATOR`, `SUBGRAPH`) наживо не прогнано —
  перевірено саме `JEV_DECISION_BUNDLE` (той, що стоїть у допиті) і FLC-цикл.
- **Другорядні моделі** Jev (`jev-latest`, інші версії) не перевірялися —
  закріплено `jev-1.13.0`.

## 9. Як відтворити

```powershell
# 1. Ключ: адмінпанель → «Провайдери ШІ» → «Ключі API» → «Рішення Jev (TypeSafe)»
#    (або JEV_API_KEY / TYPESAFE_API_KEY у .env)

# 2. Сервер із ядром (локальний тестовий Postgres)
$env:CORE_DATABASE_URL='postgres://postgres:nova@localhost:5433/nova_core'
npm run dev

# 3. У браузері: «Профіль персонажа» → герой → «Допит» → питання.
#    Трасування кроків — адмінка → Graph Studio → «Запуски» → character_voice.

# 4. Автоматичні перевірки
npm run test:api-keys        # маршрути ключів, разом із Jev
npm run test:platform-keys   # платформний ключ → резолвер
npm run test:jev-nodes       # шар рішень Jev у процесах (з підставним Jev)
```
