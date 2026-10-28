# GrabFusion (частина B)

Живе в репозиторії Studio: `services/grabfusion/` (окремий Python-проєкт, зі Studio повʼязаний лише контрактом).

Python-сервіс для швидкого створення курсів, інструкцій і наборів книг із фото. Сервер Studio (частина A)
віддає API `/api/external/v1/photo-drafts*`; контракт — **1.3.0**
(`grabfusion/contract_data/photo-drafts-api.md`, `schema.json`, `fixtures/`).

Стан: **B0** (каркас, клієнти, мок на фікстурах) і **B1 = етап 2 «Застосунок, MVP»**: підключення кодом, зйомка,
стиснення й прибирання EXIF, черга без звʼязку, картки кадрів, поле опису до 500 символів, порядок кадрів.
**Етап 3** (структура й текст): «Розкласти на уроки», припущення ШІ, правка уроків, «Написати курс», блокери,
відправка в Studio — для курсу й інструкції. Далі — режими 5–6 (техрежим інструкції, «Набір книги»).

## Правила

- Частина B пише лише у своєму репозиторії й нічого не змінює в Studio. Зміна контракту — запит до A.
- Токен Studio (`nst_…`) живе лише на сервері GrabFusion, у браузер не потрапляє.
- Клієнти ігнорують невідомі поля відповідей; розгалужуються лише за `kind` помилки.
- Маркетплейс — лише публічні маршрути для читання, без ключа мосту.

## Запуск

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest                                                # 105 тестів (e2e в Chromium — якщо є Playwright)
grabfusion-mock                                       # мок Studio на :8765 (/api/external/v1)
GRABFUSION_STUDIO_URL=http://127.0.0.1:8765/api/external/v1 grabfusion   # сторінка на http://127.0.0.1:8000
```

Конфігурація — `.env.example` (змінні `GRABFUSION_*`).

## Мок-сервер

Віддає фікстури за таблицею маршрутів §4 контракту. Заголовок `X-Mock-Fixture: <назва>` віддає будь-яку
іншу фікстуру (зокрема `error-*`, код HTTP — за `kind`). Токени `nst_invalid` і `nst_wrongscope` дають
`invalid_token` / `scope_denied`; без `Authorization` — `unauthenticated`. Мок перевіряє `note_too_long`,
`bad_image`, `image_too_large`, `bad_input` та ідемпотентність додавання фото за `clientId`;
`submit` віддає фікстуру за видом чернетки, створеної через мок.

## Клієнти

```python
from grabfusion.studio_client import StudioClient
with StudioClient("http://127.0.0.1:8765/api/external/v1", "nst_test") as c:
    d = c.create_draft("course", title="Ложка")
    c.add_photo(d.draftId, "c-1", "data:image/jpeg;base64,…")   # повтор із тим самим clientId безпечний
    d = c.wait_until_idle(d.draftId)                           # опитування раз на pollIntervalMs
```

`add_photo` повторює спробу з тим самим `clientId` при обриві, 5xx і 429 — дубля не буде.
`MarketClient` читає публічний каталог; шаблон шляху курсу поки припущення (у Studio публічного
маршруту ще немає) — узгодити з A.

## Оновлення контракту

```bash
python scripts/sync_contract.py        # бере docs/photo-drafts-api* з кореня репозиторію Studio (../..)
pytest
```

Тест `test_all_non_error_fixtures_are_served_by_the_mock` покаже нову фікстуру, якої мок ще не віддає.

## Сторінка викладача (B1)

Одна сторінка без збірки (`grabfusion/static`): підключення → чернетки → кадри. Токен Studio сервіс отримує
обміном коду (`POST /pair`) і тримає в SQLite-сесії (`GRABFUSION_SESSION_DB`); у браузер іде лише cookie
`gf_session` (httpOnly, SameSite=Strict). Проксі `/api/*` пропускає відповіді Studio як є, помилки — у форматі `{error, kind}`.

- **Фото:** браузер стискає canvas-ом до `recommendedMaxSidePx`, сервер ще раз перекодовує Pillow — без EXIF/GPS,
  з поворотом за Orientation, JPEG ≤ `maxImageBytes`.
- **Черга без звʼязку:** кадри лежать в IndexedDB із постійним `clientId`; надсилаються самі, коли зʼявиться
  звʼязок (повтор безпечний — Studio ідемпотентна за `clientId`). Помилка 4xx лишає кадр у черзі зі статусом «не надіслано».
- **Порядок:** кнопки ↑/↓ і перетягування (`PATCH photoOrder` з `ifRevision`; при конфлікті сторінка оновлюється).
- **Етап 3:** «Розкласти на уроки» (`structure`, «заново» — `replace` з підтвердженням), «Написати курс» (модулі по черзі,
  опитування `job`), правка назви/мети/тексту уроку (`PATCH lessons`, поле, яке викладач змінив, втрачає позначку «ШІ»),
  підтвердження припущень, блокери `submit_blocked` списком, після відправки — посилання на Studio
  (експрес-чернетка живе 24 год). Робота ШІ триває на сервері: перезавантаження сторінки її не рве.
- **Поки не вміє:** сама сторінка без звʼязку не відкриється (немає service worker); режими «Книга/Рукопис»
  і техрежим інструкції — етапи 5, 6.

## Стаціонарний мок

`grabfusion-mock --stateful` (або `GRABFUSION_MOCK_STATEFUL=1`): чернетки живуть у памʼяті й проходять
collecting → structured → written → submitted; прохід ШІ «триває» кілька опитувань; `submit` перевіряє блокери.
Відповіді валідуються схемою контракту в `tests/test_mock_sim.py`.
