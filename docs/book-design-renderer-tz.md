# ТЗ: Book Design Studio — семантичний renderer contract

Статус: backend/renderer етап перед UI.

## 1. Мета

Дати дизайнеру книги можливість створювати блоки, що беруть дані з реальних сутностей книги (`character`, `scene`, `conflict`) і керовано розміщуються у DesignCraft preview/PDF, не змінюючи авторський текст у моделі `Book`.

Рішення має бути адитивним: існуючі PDF engines, legacy preview, звичайний текст книги та built-in теми не повинні змінювати поведінку, якщо custom blocks не використовуються.

## 2. Джерела даних

Підтримувані на цьому етапі семантичні джерела:

- `character` — персонажі книги;
- `scene` — сцена, прив'язана до section;
- `conflict` — конфлікт сцени або індивідуальний конфлікт персонажа у сцені.

Renderer-neutral adapter повинен повертати стабільні semantic scope ids, а не вимагати парсингу composite `sourceId`:

- `characterId`;
- `sceneId`;
- `conflictKey`.

`sourceId` зберігається для backward compatibility і діагностики, але не є контрактом для визначення semantic scope.

## 3. Placement contract

Допустимі значення `placement`:

- `inline` — блок у потоці секції; до появи editor anchor IDs додається після тексту секції;
- `scene-opening` — перед текстом відповідної секції/сцени;
- `chapter-opening` — перед текстом першої секції відповідного розділу;
- `full-width` — у поточному single-column DesignCraft story еквівалент ширини текстової колонки;
- `full-page` — блок із реальними page break markers до і після;
- `appendix` — окремий автоматично створений розділ `Додаток` наприкінці renderer-копії книги.

Якщо placement потребує section/chapter locality, але target відсутній, блок не втрачається: він переходить у appendix.

## 4. Repeat contract

Допустимі значення `repeat`:

- `once` — максимум один результат для одного custom block `blockId`;
- `per-character` — максимум один результат на унікальний `characterId` в межах `blockId`;
- `per-scene` — максимум один результат на унікальний `sceneId` в межах `blockId`;
- `per-conflict` — максимум один результат на унікальний `conflictKey` в межах `blockId`;
- `matched` — показати всі результати, що пройшли selector.

Якщо для scoped repeat немає потрібного semantic id, renderer НЕ повинен випадково схлопувати різні дані: використовується унікальний fallback block id.

## 5. Conflict scope

Якщо у персонажа в сцені є власний `participation.conflict`, це окремий semantic conflict.

Якщо індивідуального конфлікту немає, але є `scene.conflict`, одна й та сама сцена не повинна створювати копію scene-level conflict для кожного учасника. Renderer materialization має звести його до одного scene-level block із:

- `sceneId` сцени;
- `characterId = undefined`;
- стабільним `conflictKey` для scene-level conflict.

## 6. Безпечне materialization

Custom blocks застосовуються тільки до renderer-копії `PdfBookInput`; вихідний `Book` не мутується.

Перед передачею тексту блоку в DesignCraft:

- службові page-break/style markers із полів очищуються;
- довжина одного materialized block обмежується;
- загальна кількість materialized blocks має верхню межу;
- для semantic paragraph styling використовуються вже підтримані styles (`KeyIdea`, `LocationTime`, `Evidence`).

## 7. Preview sampling

Theme preview sampler повинен зберігати metadata секції, включно з `section.scene`. Допускається копіювання section через object spread за умови, що semantic metadata не видаляються.

Preview sampler може скорочувати кількість chapters/sections за budget, але не повинен обрізати section content посередині semantic markers.

## 8. Backward compatibility

Старі custom themes schema v2, у яких відсутні `placement`/`repeat`, читаються без migration failure. Значення визначаються через source-derived defaults.

Built-in тема або legacy PDF flow без custom blocks не отримують custom block materialization.

## 9. Межі цього етапу

Не входить у backend contract цього етапу:

- pixel-perfect UI конструктора;
- drag-and-drop placement у макеті;
- точний inline cursor anchor усередині абзацу;
- довільне server-side завантаження font/image URL;
- multi-column/full-bleed engine API, якщо воно не підтверджене DesignCraft v0.7.1.

Ці функції не симулюються вигаданими API.

## 10. Acceptance criteria

Етап вважається готовим до UI, якщо:

1. `characterId`, `sceneId`, `conflictKey` проходять від entity adapter до renderer-facing block.
2. Scene-level conflict не дублюється через список учасників.
3. Усі п'ять repeat modes мають детерміновану реалізацію.
4. Усі шість placement modes мають визначену renderer поведінку або documented safe fallback.
5. `full-page` створює page breaks; `appendix` створює окремий appendix chapter.
6. Theme preview sample зберігає `section.scene`.
7. Tests перевіряють scene semantics, placement, repeat і custom theme materialization.
8. Gate B workflow проходить TypeScript, semantic tests і live DesignCraft test на HEAD PR.

Після виконання цих критеріїв наступний етап — UI Book Design Studio, який керує цим контрактом, не дублюючи renderer logic у компонентах.
