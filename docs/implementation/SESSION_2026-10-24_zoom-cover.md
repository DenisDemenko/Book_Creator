# Сесія 2026-10-24 — масштаб і обкладинка (гілка fix/book-studio-integrity-2026-10-16)

Агент: Claude Sonnet 5.5. Змінені файли записано в робочу копію; **нічого не закомічено й не запушено** (за AGENTS.md комітить власник).

## Зроблено
- Пункт 1 плану: перемикач масштабу 10–150 % з кроком 10 % + «Підігнати» у конструкторі шаблону верстки (`src/utils/zoomPresets.ts`, `DesignerThemeStudio.tsx`).
- Пункт 3 плану: спільний розрахунок розгортки (`src/utils/coverPhysical.ts`), у `CoverPhysicalSpec.tsx` — розмір книги, корінець, bleed, розгортка; вибір зображень передньої/задньої/корінця/повної розгортки з медіатеки; матеріал і ламінація; «формат не вказано», якщо розміру немає.
- Тести: `scripts/test-zoomPresets.mts` (8), `scripts/test-coverPhysical.mts` (6); скрипти `test:zoom-presets`, `test:cover-physical` додано в `package.json` і в ланцюжок `test`.
- Звірено без змін коду: повзунок розворотів уже має клікабельні мітки глав і підпис про орієнтовну пагінацію; у хмарі пройшли `test-canonicalPageMap`, `test-heroArcAnalysis`, `test-expressHeroArcSession`, `test-previewImageSources`, `test-novaSemanticPagination`, `test-designcraftSemanticPagination`.

## Що не запушено
Усе вище лежить у робочій копії незакоміченим. Перед комітом: `npx tsc --noEmit`, `npm run test:zoom-presets`, `npm run test:cover-physical`, повний `npm test`.

## Не зроблено і чому
- Редактор DesignCraft у Студії — власник свідомо виключив; розбіжність з гілкою `claude/designcraft-book-studio-integration-e2fafd` не вирішували.
- `tsc` і повний `npm test` не запускали: у хмарі немає повного дерева, а оболонка на комп'ютері була недоступна.
- `test-expressHeroArcJev`, `test-expressDraftSession`, `test-previewMedia`, `test-expressWizardIntegrity` не запускали (потрібні `express` і весь `server/`).
- Розрідження міток глав на повзунку при дуже великій кількості глав не робили.
- Прод-приймання фото (0/12 станом на 15.10) не перевіряли.
- Ручні сценарії на тестовій книзі для масштабу й обкладинки не проходили.
