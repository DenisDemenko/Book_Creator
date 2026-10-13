# Т9.8 — підтвердження пуша та деплою

Дата: **13.10.2026**. Запит власника: «пуш та деплой давай». Журнал #431.

## Опубліковані зміни

- 6a0b0e6 — попередні Т8.2, Т9.5–Т9.7 та планові доповнення, збережені окремо.
- 7ab7a2f12f881a39ae45e03c014ee194688f7e03 — Т9.8: завершений маршрут → приватна збірка → літературна редакція → нова приватна книга.
- Автор: Денис Деменко, tropazemli@gmail.com. Fast-forward origin/master, без force; remote SHA звірено.

Код перед пушем пройшов npm test, перевірку типів і production build. Т9.8: модель12/0, API+SQLite29/0, API+JSON29/0, Chromium8/0; регресії Т9.7 API27/Chromium16 і Т9.6 API31/Chromium19.

## Railway і доступність сайту

GitHub status comfortable-caring - Book_Creator для 7ab7a2f — **success**, оновлений о **10:12:24 UTC**. [Deployment f1ed7e13](https://railway.com/project/df8b8f8e-85cc-4ef9-8bec-da0154c055cc/service/66de1161-965e-4c26-bfb9-23d514a63251?id=f1ed7e13-8266-4ef8-a823-8dc13f0d577d&environmentId=661a57f5-0a74-4e2a-9401-11f3388a598c).

| Перевірка після запуску | Результат |
|---|---|
| /studio/ | HTTP200 |
| /studio/api/health | HTTP200, status:ok, core:ready |
| index-kbiuMmMJ.js | HTTP200; читацький маршрут присутній |
| LabyrinthBuilder-LNnhEyYy.js | HTTP200; data-story-create, story-drafts, «Проходження → нова книга» присутні |
| /studio/projects/BK-2084-CYBER/labyrinth-reader | HTTP200 |
| GET story-drafts без авторизації, із тестовим порожнім map ID | HTTP401, Cache-Control:no-store, приватного тексту немає |

SHA-256 конструктора: 831bda4dc07eb04e4585ede0a4f2e8db2091a4ddaf5bbb8b0116f6a3e42c45c7.
Під час зміни контейнера був HTTP502; після Railway success повторний прогін усіх наведених перевірок завершився PASS.

## Як відкрити

[Конструктор вашої книги](https://www.fusionlab.in.ua/studio/projects/BK-2084-CYBER/structure) → **Книга-лабіринт** → збережена карта → **Проходження → нова книга**. Потрібен Firebase-вхід власником або адміністратором і завершене читацьке проходження.

## Що ще перевірити

Цей звіт підтверджує публікацію коду, запуск сервісу та доступність захищених маршрутів. Авторизовані production-сценарії з реальними акаунтами, справжнім DeepSeek, перевіркою літературної якості, Safari/екранним читачем і відновленням даних **не виконані**: немає доступних тестових сесій цих акаунтів. [12 окремих сценаріїв](../acceptance/T9.8.md) залишаються відкритими. Т9.9–Т9.10 ще не реалізовані.
