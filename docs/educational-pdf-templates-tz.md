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
- активний template marker;
- `Налаштувати`, що відкриває реальний educational Designer Mode для створення власного presentation layer поверх immutable built-in template.

Course educational design panel перемикає:

- Методичка;
- Інструкція;
- Вправи / домашнє.

Designer Mode дозволяє змінювати presentation layer без мутації `CourseV2`: назву власної теми, accent/text/paper colors, body/heading fonts, header/footer spacing та візуальні параметри ключових semantic entities.

PDF preview відкривається вручну, не генерується на кожен click.

## DesignCraft preview contract

`POST /api/pdf/designcraft/theme-preview` приймає optional educational template та optional custom presentation overlay:

```json
{
  "book": { "...compatibility preview payload...": true },
  "educationalTemplateId": "instruction-clear-steps",
  "customTheme": { "...CustomBookDesignTheme...": true }
}
```

Для educational template response додатково повертає headers:

- `X-Pdf-Theme` — public educational template ID;
- `X-Pdf-Renderer-Base-Theme` — фактична DesignCraft book theme;
- `X-Pdf-Educational-Template`;
- `X-Pdf-Educational-Style-Family`;
- `X-Pdf-Educational-Visuals: 1`.

Невідомий educational template ID → `400 bad_input`.

## Поточний стан PDF styling

Educational semantic style families уже реалізовані через наявний DesignCraft semantic/custom-theme engine. Для educational preview використовуються окремі stable style profiles для всіх 9 шаблонів без створення нового renderer і без мутації 15 книжкових тем.

Наразі підтримуються, зокрема, presentation mappings для таких semantic families:

- learning goal / learning result;
- theory;
- example;
- instruction step;
- practice / project / homework;
- question / reflection;
- materials / equipment;
- warning / safety / common mistake;
- checklist / assessment;
- teacher note;
- additional resource.

Educational Designer Mode може накладати custom presentation style поверх educational template, при цьому built-in шаблон залишається immutable, а custom theme має `basedOn` на відповідну renderer base theme.

## Відомі обмеження поточної фази

Поточна реалізація має такі свідомі обмеження:

1. **Media placement у PDF.** Фото та відео з CourseV2 уже потрапляють у semantic/media projection, але в authoritative educational PDF preview вони ще не мають повноцінного довільного image placement. Media може бути представлена як resource/caption/URL metadata або текстове посилання. Не декларувати повну image-layout fidelity.
2. **Worksheet answer areas.** Поля для відповіді зараз є статичними візуальними зонами, а не інтерактивними PDF form fields.
3. **Page backgrounds.** HTML presentation може мати гнучкіший media background stack, але для PDF не гарантується довільний image background / full-page background image. Безпечна гарантія для PDF — підтримувані presentation styles і solid borders.
4. **Custom educational themes.** Власні educational themes і вибір presentation зараз зберігаються у browser `localStorage`, окремо від `CourseV2`. Тому вони поки не синхронізуються між пристроями та співавторами.
5. **Designer scope.** Educational Designer Mode редагує presentation layer, а не структуру або зміст курсу. Content authoring залишається у Course Studio.

Ці обмеження є частиною поточного product contract і мають бути явно враховані у UI, документації та ручній прийомці.

## Сумісність

Не видаляти й не замінювати:

- 15 book themes;
- Book Design Studio;
- custom book themes;
- legacy `/api/admin/pdf/preview`;
- Media Library;
- current course content/editor;
- Marketplace publishing workflow.

Course Studio і Educational Design Studio є sibling workspaces. Перемикання між ними не повинно втрачати незбережений локальний editor state.

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
9. semantic educational style mappings і 9 visual profiles залишаються валідними;
10. Educational Designer Mode не мутує CourseV2 і передає `customTheme` тільки у preview/presentation layer;
11. Course Studio не робить нескінченний refetch при порожньому списку курсів;
12. перемикання `Курс і зміст ↔ Дизайн навчальних матеріалів` не розмонтовує content editor і не губить його локальний unsaved state;
13. live DesignCraft engine test не регресує.
