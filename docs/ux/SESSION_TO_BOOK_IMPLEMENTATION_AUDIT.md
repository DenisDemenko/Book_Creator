# Аудит виконання SESSION_TO_BOOK_EXPORT_UX_SPEC.md
Дата: 2026-10-18. Гілка: ux/story-experience-engine-v1. Стани визначено за реалізованим кодом, а не лише за наявністю кнопки.

## Виконано або є робочий базовий маршрут
- AC-01: entry point після завершення Mafia/Constellation/Leela.
- AC-03: усі чотири режими приватності в UX (реально підтриманий імпорт — лише не-«none»).
- AC-08 (частково): кнопка генерації підключена до існуючого image API; кнопка вибору з Медіатеки ще не підключена.
- AC-09: без reference-фото учасника у запиті генерації.
- AC-14/15: AI-неймінг — лише локальні приклади, ручне введення доступне; збій image API не блокує текст.
- AC-17: нові герої потрапляють до book.characters та cast глави при підтвердженому імпорті.
- AC-19: історія збережених сесій має «Використати у книзі».
- Серверна база: авторизований архів, перевірка власника книги, дозволені події, евристична перевірка прямих ідентифікаторів.
- 2026-10-18: editable review із необов'язковим sourceEvents; тільки явно approved visibility події передаються в редактор, зміна тексту скидає підтвердження.

## Частково зроблено
- AC-02: вибір summary/events/snapshots є; вибір окремих реальних подій, голосувань, ходів і fragments не підключено до snapshot.
- AC-04/05: вручну змінюються fictional names, але справжньої AI-пропозиції та перевірки відповідності різним учасникам немає.
- AC-06: UI new/existing/skip/merge/split є, commit підтримує лише new/existing; merge/split заблоковано.
- AC-07/16: у персонажа є загальний tag, але бракує typed provenance/session badge, source snapshot і privacy metadata в канонічних схемах.
- AC-10/18: зображення прив’язується до avatarUrl і book.illustrations після імпорту; перевірити end-to-end у серверній Медіатеці та ліцензію/паспорт медіафайлу.
- AC-11: можна позначити кілька форматів, але commit створює лише одну главу з текстом; окремі scene/outline/story generators відсутні.
- AC-12: є review з кількістю героїв та приватністю; немає granular excluded fields, повного переліку медіа та diff.
- AC-13: приватні поля не проходять через preview allowlist, але реальний policy-backed відбір з канонічного session store не реалізовано.
- Адаптивність/ARIA: базова реалізація, потрібні keyboard/screen-reader E2E тести.

## Не зроблено / блокери до production
1. **Події з реального Session Engine**: integrated views досі мають локальні demo lobby/status і не передають canonical events. Новий `approvedSessionEvents` — тільки типізована точка інтеграції для реального провайдера.
2. **Повна серверна приватність**: евристична перевірка email/phone/URL не замінює редагування PII (імена, точні місця, цитати, контекст), consent management та permission/retention.
3. **Повноцінний механізм session snapshot/archive**: capture подій, versioning, audit trail, approved/unapproved segregation, durable sync, idempotency.
4. **AC-20**: duplicate-warning і серверна ідемпотентність повторного export не реалізовані.
5. **AC-08/10**: picker існуючого медіафайлу, вибір primary/alternate портрета, сцена-ілюстрація, provenance й media passport.
6. **AI narrative pipeline**: proposed fictional dossiers, outline/scenes/story, review/accept/reject і літературні стилі.
7. **Session History**: статуси draft/exported/linked/updated; retry, partial-success і повернення в конкретну главу.
8. **Доступи**: source-only real-name map, явна згода учасників, revocation, admin audit, participant vs facilitator policy.
9. **Конфлікти запису в книгу**: версіювання, серверна транзакція/ревізія, persist result guarantee, recover/retry.
10. **Тести**: unit privacy, API ownership, end-to-end session→book→hero→media, mobile, accessibility, role restrictions.

## Пріоритет реалізації
P0 — canonical event capture + identity/permission/consent pipeline + idempotency + tests.
P1 — source provenance, linked media picker, multi-format export і chapter/hero linking.
P2 — AI адаптація, advanced merge/split, інтелектуальні портрети, review diff та polish.

Примітка: успішний TypeScript CI — це перевірка збірки, а не підтвердження безпечного production workflow.

## Оновлення 2026-10-18 — канонічна подієва схема (ітерація)
- Додано `server/storyExperienceEvents.ts`: типізована структура подій, видимість, часові мітки, порядковий номер, перевірка дублювання й міжсесійного змішування.
- `safeCompletedSessionSummary` використовує server-side projection подій із `visibility=approved` та `approvedForBook=true`, якщо є canonicalEvents.
- Нові погоджені архівні записи зберігають `canonicalEvents` поруч із legacy `events` для сумісності.
- Додано unit-тести фільтрації приватного вмісту, порядку і власника сесії.
- **Не виконано:** автоматичний ingest подій із живих Mafia/Constellation/Leela, окрема захищена база для всіх категорій подій, per-participant consent, retention, ревізії та гарантії PII-очищення. Інтерфейс архівації наразі зберігає лише вручну підтверджені події; функціональність не можна вважати повним production event sourcing.
