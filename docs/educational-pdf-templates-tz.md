# Educational PDF Templates — технічне ТЗ

## Мета

Розширити спільний DesignCraft/PDF engine навчальними представленнями без дублювання контенту або окремого PDF-рушія.

Принцип:

> Course content → semantic educational document → template → PDF.

Один курс має бути джерелом для студентського представлення, методички, інструкції та робочого аркуша. Дизайн не зберігає копію змісту.

## Вбудовані шаблони

### Методички

1. `methodic-classic` — академічна, стримана, орієнтована на читабельність.
2. `methodic-modern` — карткова сучасна подача для STEAM та онлайн-курсів.
3. `methodic-visual-pro` — візуально насичена методичка для технічних і практичних занять.

### Інструкції

1. `instruction-clear-steps` — чітка покрокова інструкція.
2. `instruction-visual-flow` — step-cards, схеми та великі ілюстрації.
3. `instruction-compact-manual` — щільний технічний мануал для друку.

### Вправи / домашні завдання

1. `worksheet-clean` — чистий робочий лист з місцем для відповідей.
2. `worksheet-interactive` — картковий формат із підказками та рефлексією.
3. `worksheet-project-sheet` — проєктний STEAM/DIY аркуш.

Разом: **9 immutable built-in educational templates**.

## Архітектура

Educational templates не додаються до 15 built-in book themes. Вони мають власні public IDs і semantic vocabulary, а поточний DesignCraft renderer використовує перевірену книжкову тему як низькорівневу typography/rendering base.

Поточне відображення:

| Educational template | DesignCraft base |
| --- | --- |
| Methodic Classic | `academic-research` |
| Methodic Modern | `non-fiction` |
| Methodic Visual Pro | `business-premium` |
| Instruction Clear Steps | `non-fiction` |
| Instruction Visual Flow | `graphic-story` |
| Instruction Compact Manual | `academic-research` |
| Homework Clean Worksheet | `academic-research` |
| Homework Interactive Blocks | `children` |
| Homework Project Sheet | `business-premium` |

Це additive mapping: існуючі книжкові теми не змінюються.

## Semantic entities

Базовий educational catalog:

- `course-title`
- `module-title`
- `lesson-title`
- `learning-goal`
- `learning-result`
- `theory`
- `example`
- `step`
- `practice`
- `project`
- `homework`
- `question`
- `test`
- `reflection`
- `materials`
- `equipment`
- `warning`
- `safety`
- `checklist`
- `teacher-note`
- `common-mistake`
- `assessment`
- `additional-resource`

Кожен semantic block має стабільний ID, audience (`student | teacher | both`), optional media та metadata. Renderer commands у content model не зберігаються.

## CourseV2 adapter

`CourseV2` залишається source of truth. Adapter проєктує його у `EducationalDocument` без мутації курсу:

- `course.outcomes` → `learning-result`;
- lesson `goal` → `learning-goal`;
- `description` / `topics` → theory або instruction steps;
- lesson assignment → `practice` / `homework` + `assessment` + `checklist`;
- module final assignment → `project`;
- photos / video → media/resource blocks;
- existing course/module/lesson IDs зберігаються.

## UI

Reusable gallery має:

- по 3 cards у кожній категорії;
- mini preview;
- staged selection;
- explicit `Застосувати`;
- `Налаштувати` для майбутнього спільного Designer Mode;
- активний template marker.

Course educational design panel перемикає:

- Методичка;
- Інструкція;
- Вправи / домашнє.

PDF preview відкривається вручну, не генерується на кожен click.

## DesignCraft preview contract

`POST /api/pdf/designcraft/theme-preview` приймає optional:

```json
{
  "book": { "...compatibility preview payload...": true },
  "educationalTemplateId": "instruction-clear-steps"
}
```

Для educational template response додатково повертає headers:

- `X-Pdf-Theme` — public educational template ID;
- `X-Pdf-Renderer-Base-Theme` — фактична DesignCraft book theme;
- `X-Pdf-Educational-Template`;
- `X-Pdf-Educational-Style-Family`.

Невідомий educational template ID → `400 bad_input`.

## Важливе обмеження поточної фази

Поточний authoritative DesignCraft renderer уже підтримує typography/theme base. Educational semantic style families створені як стабільний контракт, але повний block-level PDF styling для кожного типу (`warning`, `safety`, `worksheet answer area` тощо) має нарощуватися окремими adapters/style commands.

Не декларувати повну fidelity educational block styling, доки відповідні PDF tests не підтверджують її.

## Сумісність

Не видаляти й не замінювати:

- 15 book themes;
- Book Design Studio;
- custom book themes;
- legacy `/api/admin/pdf/preview`;
- Media Library;
- current course content/editor;
- Marketplace publishing workflow.

## Regression contract

Gate B повинен перевіряти:

1. рівно 9 educational templates;
2. рівно 3 templates у кожній категорії;
3. unique IDs;
4. 15 book themes залишаються без змін;
5. усі renderer base themes існують;
6. client/server template registries узгоджені;
7. CourseV2 adapter зберігає stable IDs;
8. assignment semantics коректно відрізняються для instruction/worksheet/project;
9. live DesignCraft engine test не регресує.
