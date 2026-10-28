# GrabFusion (частина B)

Живе в репозиторії Studio: `services/grabfusion/` (окремий Python-проєкт, зі Studio повʼязаний лише контрактом).

Python-сервіс для швидкого створення курсів, інструкцій і наборів книг із фото. Сервер Studio (частина A)
віддає API `/api/external/v1/photo-drafts*`; контракт — **1.3.0**
(`grabfusion/contract_data/photo-drafts-api.md`, `schema.json`, `fixtures/`).

Стан: **B0** — каркас, клієнти, мок-сервер на фікстурах, тести. Екрани й черга без звʼязку — наступні кроки.

## Правила

- Частина B пише лише у своєму репозиторії й нічого не змінює в Studio. Зміна контракту — запит до A.
- Токен Studio (`nst_…`) живе лише на сервері GrabFusion, у браузер не потрапляє.
- Клієнти ігнорують невідомі поля відповідей; розгалужуються лише за `kind` помилки.
- Маркетплейс — лише публічні маршрути для читання, без ключа мосту.

## Запуск

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest                                                # 72 тести
grabfusion-mock                                       # мок Studio на :8765 (/api/external/v1)
grabfusion                                            # сервіс на :8000 (/healthz, /api/config)
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
