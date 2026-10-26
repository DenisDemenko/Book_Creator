# Слеби та столи: production-розгортання

Власник доручив розгорнути окремі сторінки маркетплейсу та розділ адмінки Студії. Перевірка оплати прямо виключена.

## Опубліковані версії

- Marketplace PR #3: https://github.com/DenisDemenko/Fusion-Lab-Marketplaes/pull/3
- Marketplace production SHA: `c1aceb506fe03a5acce1b47405ca1d57877dcbae`.
- Vercel `dpl_DqkrvK9Zk62FTK4DayuZmhCDNUbU` — READY, production-домени призначені.
- API Railway `7d73c740-6d09-4535-9f49-47bc8a31211e` — SUCCESS; SHA підтверджено CLI deployment list.
- Studio PR #21: https://github.com/DenisDemenko/Book_Creator/pull/21
- Studio production SHA: `90f92f6df778d8e75109a723f76e816550d457be`.
- Studio Railway `c947cdfb-5bed-4e4b-9a0b-e4a4c2c086b5` — success за GitHub deployment status; нові HTML/JS модуля відповідають 200.

## Адреси

- https://www.fusionlab.in.ua/table-builder — конструктор покупця.
- https://www.fusionlab.in.ua/admin/slabs — адміністрування з маркетплейсу, потрібен admin-вхід.
- https://app.fusionlab.in.ua/studio/ — у Студії: «Адмін панель» → «Слеби та столи».

## Живі перевірки

- `/tables/state` API відповідає 200 з потрібними полями: таблиці нової міграції доступні.
- `/health` API: 200, database up.
- Сторінки конструктора й адмінки маркетплейсу: HTTP 200.
- `/studio/slab-studio/index.html` та `app.js`: 200, містять новий модуль.
- `/studio/api/admin/slab-tables/state` без входу: 403; адмінські дані закриті.
- Бібліотека: 0 слебів. `costsConfigured: false`. Потрібні власні фото і явна публікація тарифів із меблевого калькулятора; тестові числа не записувалися у production.
- GitHub CI marketplace production SHA: https://github.com/DenisDemenko/Fusion-Lab-Marketplaes/actions/runs/40313119935 — success.

## Межі

Перевірка оплати, checkout, callback, demo-confirm та списання коштів під час цього релізу не запускалися. Автоматична CI репозиторію працювала за його вже наявними правилами; її успіх не є перевіркою живої оплати. Авторизований production-потік адміністратора Студії й завантаження власних фото не перевірені. Браузерний прогін production не завершено; живе приймання обмежене HTTP/API та підтвердженнями платформ. Попередні локальні браузерні тести описані окремо в SLAB_TABLES.md.

Railway-конектор зациклювався на авторизації. Автодеплой виконано через налаштовані GitHub-інтеграції; CLI після одноразового входу підтвердив SUCCESS API. Секрети й дані входу у репозиторій не додавалися.

Остання звірка: 2026-10-26 11:56 UTC.
