/**
 * ЯДРО СУТНОСТЕЙ СТУДІЇ — 118 типів сутностей і 37 типів зв'язків.
 *
 * Джерело істини — документ власника
 * `Fusion_Lab_Studio_Entity_Registry_with_Literary_Critic_UA_EN.pdf` (10 стор.,
 * звірено 22.09.2026), а не цей файл: тут він лише перенесений у код так,
 * щоб його можна було читати машиною. При розходженні правий документ.
 *
 * ЩО ЦЕ ЗА ЧИСЛА (вони в документі розписані окремо й сходяться):
 *   A–I   — базовий реєстр: 88 типів у 9 групах;
 *   J1–J3 — додаток «Літературна критика»: 30 типів у 3 підгрупах;
 *   разом  88 + 30 = **118 типів сутностей**;
 *   зв'язки: 21 базовий + 16 критичних = **37 типів зв'язків**.
 * Група «K» документа (id, project_id, type, slug, color, attributes…)
 * переліком типів НЕ є — це спільний службовий набір полів, тож окремою
 * сутністю тут не заводиться: він реалізований самою схемою реєстру
 * (див. server/db.ts → core_entities).
 *
 * ТРИ РІВНІ, ЯКІ ДОКУМЕНТ РОЗРІЗНЯЄ, І ЇХ НЕ МОЖНА ПЛУТАТИ:
 *   • СУТНІСТЬ (тип) — `character`, те, що можна позначити тегом;
 *   • ХАРАКТЕРИСТИКА — `Ім’я`, `роль`, `біографія` — властивість сутності,
 *     те, що автор пише після двокрапки: `/character:Serhii`;
 *   • ЗВ'ЯЗОК — `participates_in` — відношення між двома сутностями.
 *
 * ФОРМАТ ТЕГА В ТЕКСТІ КНИГИ. Документ описує тег як `/entity-type:entity-name`.
 * У тексті розділу він загорнутий у квадратні дужки — `[/character:Serhii]` —
 * з тієї ж причини, з якої в дужках живуть `[^1]`, `[IMG: …]` і `[QR: …`]:
 * без межі тег неможливо ні надійно знайти, ні безпечно зняти на експорті
 * (звичайний текст «стор. /2:3» інакше вважався б тегом). Дужки — не частина
 * формату власника, а лише маркер межі навколо нього.
 *
 * ЧОМУ ОКРЕМИЙ ФАЙЛ, А НЕ КОНСТАНТА В КОМПОНЕНТІ. Реєстр читають чотири
 * різні споживачі з різних середовищ: панель сутностей у редакторі, чат ШІ,
 * сервер (насіння таблиці `core_entities`) і тести. Дублювати 118 записів у
 * кожному — гарантований спосіб розійтися з документом.
 */

/** Склад реєстру: базовий документ чи додаток про літературну критику. */
export type CoreEntityRegistry = 'base' | 'critic';

/** Мова характеристики: у документі вони лише українською. */
export interface CoreEntityGroup {
  /** `A`…`I` — базові, `J1`…`J3` — підгрупи критичного додатка. */
  id: string;
  nameUk: string;
  nameEn: string;
  registry: CoreEntityRegistry;
}

export interface CoreEntity {
  /** Тег без дужок, як у документі: `/character`. Він же — машинний ключ. */
  tag: string;
  /** Ключ без слеша: `character`. Саме він порівнюється з тим, що набрав автор. */
  slug: string;
  nameUk: string;
  nameEn: string;
  /** id групи з `CORE_ENTITY_GROUPS`. */
  groupId: string;
  /** HEX із документа, як є — включно з повторами (див. `duplicateColors`). */
  color: string;
  /** Характеристики сутності — те, що підказується після двокрапки. */
  characteristics: string[];
  registry: CoreEntityRegistry;
}

export interface CoreEntityRelation {
  /** `participates_in` — як у документі, без слеша. */
  key: string;
  nameUk: string;
  /** Приклад застосування з документа: «Сергій → подія». */
  example: string;
  registry: CoreEntityRegistry;
}

/**
 * Групи в порядку документа. `J1`–`J3` — не «ще три групи базового
 * реєстру», а підгрупи додатка: тому в `registry` вони позначені `critic`,
 * і в інтерфейсі їх видно окремим блоком.
 */
export const CORE_ENTITY_GROUPS: CoreEntityGroup[] = [
  { id: 'A', nameUk: 'Структура документа та зміст', nameEn: 'Document structure', registry: 'base' },
  { id: 'B', nameUk: 'Сценарій і драматургія', nameEn: 'Plot and dramaturgy', registry: 'base' },
  { id: 'C', nameUk: 'Персонажі, психологія та взаємини', nameEn: 'Characters and psychology', registry: 'base' },
  { id: 'D', nameUk: 'Світ, предмети та візуальні матеріали', nameEn: 'World and visuals', registry: 'base' },
  { id: 'E', nameUk: 'Авторський стиль, теми та ідеї', nameEn: 'Style, themes, ideas', registry: 'base' },
  { id: 'F', nameUk: 'Навчальні курси та перевірка знань', nameEn: 'Courses and assessment', registry: 'base' },
  { id: 'G', nameUk: 'Технічні інструкції та послідовності дій', nameEn: 'Instructions and procedures', registry: 'base' },
  { id: 'H', nameUk: 'Ігри та інтерактивні сценарії', nameEn: 'Games and interactive scenarios', registry: 'base' },
  { id: 'I', nameUk: 'Джерела, перевірка та редакторська робота', nameEn: 'Sources, verification, editorial', registry: 'base' },
  { id: 'J1', nameUk: 'Критичне дослідження та аргументація', nameEn: 'Critical research', registry: 'critic' },
  { id: 'J2', nameUk: 'Наратив, композиція та мова', nameEn: 'Narrative and language', registry: 'critic' },
  { id: 'J3', nameUk: 'Контекст, читач і проблеми тексту', nameEn: 'Context, reader, text issues', registry: 'critic' },
];

/**
 * Рядок реєстру: `[slug, nameEn, nameUk, groupId, color, characteristics]`.
 *
 * Навмисно компактний кортеж, а не 118 об'єктів: так рядок можна звірити з
 * документом очима (один рядок — один рядок таблиці PDF) і так само
 * скопіювати назад. Характеристики — один рядок через кому, як у документі;
 * розбиття на масив робить `expand` нижче.
 */
type EntityRow = [slug: string, nameEn: string, nameUk: string, groupId: string, color: string, characteristics: string];

const ENTITY_ROWS: EntityRow[] = [
  // A. Структура документа та зміст (8)
  ['project', 'Project', 'Проєкт', 'A', '#334155', 'Тип, назва, мова, власник, статус'],
  ['document', 'Document', 'Документ', 'A', '#475569', 'Назва, формат, версія, дата'],
  ['chapter', 'Chapter', 'Глава / розділ', 'A', '#15803D', 'Номер, заголовок, порядок, статус'],
  ['section', 'Section', 'Підрозділ', 'A', '#34D399', 'Заголовок, порядок, призначення'],
  ['paragraph', 'Paragraph', 'Абзац', 'A', '#64748B', 'Текст, позиція, версія, мова'],
  ['content-block', 'Content Block', 'Блок змісту', 'A', '#94A3B8', 'Тип вмісту, позиція, формат'],
  ['outline', 'Outline', 'План / структура', 'A', '#0F766E', 'Рівень, порядок, стан розробки'],
  ['summary', 'Summary', 'Резюме', 'A', '#047857', 'Обсяг, охоплення, висновки'],

  // B. Сценарій і драматургія (15)
  ['plot', 'Plot', 'Сюжет', 'B', '#047857', 'Структура, початок, розвиток, завершення'],
  ['storyline', 'Storyline', 'Сюжетна лінія', 'B', '#059669', 'Назва, учасники, стан, послідовність'],
  ['scene', 'Scene', 'Сцена', 'B', '#22C55E', 'Місце, час, учасники, мета, результат'],
  ['event', 'Event', 'Подія', 'B', '#FB923C', 'Тип, учасники, час, місце, наслідки'],
  ['conflict', 'Conflict', 'Конфлікт', 'B', '#EF4444', 'Сторони, предмет, причина, напруженість'],
  ['obstacle', 'Obstacle', 'Перешкода', 'B', '#F97316', 'Тип, складність, кого обмежує'],
  ['stake', 'Stake', 'Ставка', 'B', '#EA580C', 'Що можна здобути або втратити, значущість'],
  ['decision', 'Decision', 'Рішення', 'B', '#D97706', 'Хто ухвалює, альтернативи, мотив, наслідок'],
  ['threshold', 'Threshold', 'Поріг', 'B', '#8B5CF6', 'Стан до/після, ризик, ціна, незворотність'],
  ['turning-point', 'Turning Point', 'Поворотна точка', 'B', '#F59E0B', 'Подія-причина, напрям зміни, масштаб'],
  ['consequence', 'Consequence', 'Наслідок', 'B', '#C2410C', 'Причина, постраждалі, тривалість, значущість'],
  ['revelation', 'Revelation', 'Розкриття таємниці', 'B', '#FACC15', 'Яку інформацію відкрито, кому, коли'],
  ['mystery', 'Mystery', 'Загадка', 'B', '#4338CA', 'Запитання, прихована відповідь, статус'],
  ['story-promise', 'Story Promise', 'Сюжетна обіцянка', 'B', '#4F46E5', 'Очікування читача, джерело, виконання'],
  ['ending', 'Ending', 'Фінал', 'B', '#312E81', 'Тип, завершені лінії, відкриті питання'],

  // C. Персонажі, психологія та взаємини (12)
  ['character', 'Character', 'Персонаж', 'C', '#3B82F6', 'Ім’я, роль, біографія, опис, статус'],
  ['group', 'Group', 'Група / команда', 'C', '#6366F1', 'Назва, склад, мета, правила'],
  ['relationship', 'Relationship', 'Стосунки', 'C', '#EC4899', 'Учасники, тип, взаємність, динаміка'],
  ['character-arc', 'Character Arc', 'Арка персонажа', 'C', '#9333EA', 'Початковий стан, зміни, кінцевий стан'],
  ['goal', 'Goal', 'Мета персонажа', 'C', '#16A34A', 'Бажаний результат, термін, досягнення'],
  ['need', 'Inner Need', 'Внутрішня потреба', 'C', '#65A30D', 'Потреба, усвідомлення, задоволення'],
  ['belief', 'Belief', 'Переконання', 'C', '#14B8A6', 'Зміст, сила, походження, зміни'],
  ['value', 'Value', 'Цінність', 'C', '#0D9488', 'Назва, пріоритет, суперечності'],
  ['emotion', 'Emotion', 'Емоційний стан', 'C', '#F43F5E', 'Тип, інтенсивність, тривалість, причина'],
  ['character-state', 'Character State', 'Стан персонажа', 'C', '#A855F7', 'Фізичний, психічний, соціальний стан, час'],
  ['dialogue', 'Dialogue', 'Діалог', 'C', '#06B6D4', 'Учасники, репліки, намір, підтекст'],
  ['character-voice', 'Character Voice', 'Мовний портрет', 'C', '#0E7490', 'Лексика, синтаксис, інтонація, звички'],

  // D. Світ, предмети та візуальні матеріали (8)
  ['world', 'World', 'Світ твору', 'D', '#115E59', 'Правила, історія, географія, культура'],
  ['location', 'Location', 'Локація', 'D', '#2DD4BF', 'Назва, координати у світі, опис, тип'],
  ['object', 'Object', 'Предмет', 'D', '#78716C', 'Назва, властивості, власник, стан'],
  ['image', 'Image', 'Зображення', 'D', '#C026D3', 'Файл, тип, опис, авторство, версія'],
  ['appearance', 'Appearance', 'Зовнішній вигляд', 'D', '#D946EF', 'Риси, одяг, вік на момент опису, зміни'],
  ['map', 'Map', 'Карта', 'D', '#0EA5E9', 'Територія, масштаб, позначення'],
  ['diagram', 'Diagram', 'Схема / діаграма', 'D', '#A855F7', 'Тип, елементи, зв’язки, призначення'],
  ['timeline', 'Timeline', 'Хронологія', 'D', '#475569', 'Часова шкала, початок, кінець, порядок'],

  // E. Авторський стиль, теми та ідеї (6)
  ['theme', 'Theme', 'Тема', 'E', '#6D28D9', 'Назва, значення, розвиток, сцени'],
  ['concept', 'Concept', 'Концепція', 'E', '#7C3AED', 'Визначення, контекст, пов’язані ідеї'],
  ['motif', 'Motif', 'Мотив', 'E', '#A78BFA', 'Образ, повторення, зміна значення'],
  ['symbol', 'Symbol', 'Символ', 'E', '#C084FC', 'Форма, значення, контекст, появи'],
  ['author-style', 'Author Style', 'Авторський стиль', 'E', '#BE185D', 'Лексика, синтаксис, ритм, образність'],
  ['narrative-voice', 'Narrative Voice', 'Голос оповідача', 'E', '#0284C7', 'Особа, дистанція, надійність, манера'],

  // F. Навчальні курси та перевірка знань (10)
  ['course', 'Course', 'Навчальний курс', 'F', '#0369A1', 'Назва, рівень, тривалість, аудиторія'],
  ['module', 'Module', 'Навчальний модуль', 'F', '#0284C7', 'Назва, порядок, тривалість, передумови'],
  ['lesson', 'Lesson', 'Урок', 'F', '#38BDF8', 'Тема, тривалість, матеріали, результат'],
  ['learning-objective', 'Learning Objective', 'Навчальна мета', 'F', '#2563EB', 'Очікувана дія, критерій досягнення'],
  ['skill', 'Skill', 'Навичка', 'F', '#6D28D9', 'Назва, рівень, критерії, передумови'],
  ['exercise', 'Exercise', 'Вправа', 'F', '#F97316', 'Завдання, складність, час, матеріали'],
  ['assessment', 'Assessment', 'Оцінювання', 'F', '#B45309', 'Метод, критерії, максимальний бал'],
  ['question', 'Question', 'Запитання', 'F', '#EAB308', 'Тип, текст, складність, відповідь'],
  ['case-study', 'Case Study', 'Практичний кейс', 'F', '#4D7C0F', 'Ситуація, дані, завдання, результат'],
  ['feedback', 'Feedback', 'Зворотний зв’язок', 'F', '#0F766E', 'Адресат, критерій, зауваження, порада'],

  // G. Технічні інструкції та послідовності дій (10)
  ['instruction', 'Instruction', 'Інструкція', 'G', '#1D4ED8', 'Тип, призначення, обладнання, версія'],
  ['procedure', 'Procedure', 'Процедура', 'G', '#0891B2', 'Мета, початкові умови, результат'],
  ['step', 'Step', 'Крок', 'G', '#60A5FA', 'Номер, дія, тривалість, результат'],
  ['requirement', 'Requirement', 'Вимога', 'G', '#4F46E5', 'Обов’язковість, умова, критерій'],
  ['safety-rule', 'Safety Rule', 'Правило безпеки', 'G', '#DC2626', 'Небезпека, запобіжний захід, пріоритет'],
  ['tool', 'Tool', 'Інструмент', 'G', '#64748B', 'Назва, призначення, характеристики'],
  ['material', 'Material', 'Матеріал', 'G', '#A16207', 'Тип, кількість, одиниця, властивості'],
  ['component', 'Component', 'Компонент / деталь', 'G', '#57534E', 'Артикул, розміри, кількість, сумісність'],
  ['parameter', 'Parameter', 'Параметр', 'G', '#334155', 'Назва, значення, одиниця, діапазон'],
  ['hazard', 'Hazard', 'Небезпека', 'G', '#991B1B', 'Джерело, тяжкість, імовірність, наслідки'],

  // H. Ігри та інтерактивні сценарії (12)
  ['game', 'Game', 'Гра', 'H', '#7C3AED', 'Тип, назва, кількість гравців, тривалість'],
  ['player', 'Player', 'Гравець', 'H', '#1E40AF', 'ID, стан, роль, результати'],
  ['game-role', 'Game Role', 'Ігрова роль', 'H', '#6366F1', 'Назва, права, здібності, обмеження'],
  ['rule', 'Rule', 'Правило', 'H', '#BE123C', 'Умова, дія, винятки, пріоритет'],
  ['game-state', 'Game State', 'Стан гри', 'H', '#155E75', 'Фаза, змінні, активні учасники'],
  ['game-action', 'Game Action', 'Ігрова дія', 'H', '#0D9488', 'Виконавець, ціль, вартість, результат'],
  ['challenge', 'Challenge', 'Випробування', 'H', '#C2410C', 'Мета, складність, умови, результат'],
  ['quest', 'Quest', 'Квест', 'H', '#9333EA', 'Завдання, етапи, учасники, нагорода'],
  ['game-resource', 'Game Resource', 'Ігровий ресурс', 'H', '#15803D', 'Тип, кількість, спосіб отримання'],
  ['reward', 'Reward', 'Нагорода', 'H', '#CA8A04', 'Тип, цінність, умови отримання'],
  ['game-condition', 'Game Condition', 'Ігрова умова', 'H', '#EA580C', 'Вираз, перемога або поразка'],
  ['game-branch', 'Game Branch', 'Гілка сценарію', 'H', '#818CF8', 'Умова входу, вибір, наступний стан'],

  // I. Джерела, перевірка та редакторська робота (7)
  ['source', 'Source', 'Джерело', 'I', '#075985', 'Автор, назва, URL, дата, тип'],
  ['claim', 'Claim', 'Твердження', 'I', '#1D4ED8', 'Зміст, автор, статус перевірки'],
  ['evidence', 'Evidence', 'Доказ / свідчення', 'I', '#0C4A6E', 'Джерело, фрагмент, релевантність'],
  ['definition', 'Definition', 'Визначення', 'I', '#0891B2', 'Термін, формулювання, сфера'],
  ['author-note', 'Author Note', 'Нотатка автора', 'I', '#A8A29E', 'Текст, адресат, пріоритет, статус'],
  ['editorial-task', 'Editorial Task', 'Редакторське завдання', 'I', '#F97316', 'Опис, виконавець, термін, статус'],
  ['ai-insight', 'AI Insight', 'Висновок AI', 'I', '#8B5CF6', 'Висновок, докази, модель, впевненість'],

  // J1. Критичне дослідження та аргументація (10)
  ['critical-review', 'Critical Review', 'Критична рецензія', 'J1', '#164E63', 'Об’єкт, мета, аудиторія, теза, підсумок'],
  ['critical-thesis', 'Critical Thesis', 'Критична теза', 'J1', '#155E75', 'Формулювання, сфера дії, статус, впевненість'],
  ['critical-argument', 'Critical Argument', 'Критичний аргумент', 'J1', '#0369A1', 'Теза, підстави, докази, логічний перехід'],
  ['counterargument', 'Counterargument', 'Контраргумент', 'J1', '#0284C7', 'Яку тезу заперечує, підстава, відповідь'],
  ['critical-observation', 'Critical Observation', 'Критичне спостереження', 'J1', '#0891B2', 'Що помічено, фрагмент, масштаб, достовірність'],
  ['interpretation', 'Interpretation', 'Інтерпретація', 'J1', '#0E7490', 'Гіпотеза значення, альтернативи, докази, статус'],
  ['critical-criterion', 'Critical Criterion', 'Критерій аналізу', 'J1', '#0F766E', 'Назва, визначення, застосовність, шкала'],
  ['critical-judgment', 'Critical Judgment', 'Критичне судження', 'J1', '#047857', 'Критерій, висновок, обґрунтування, межі'],
  ['critical-finding', 'Critical Finding', 'Висновок критика', 'J1', '#059669', 'Тип, серйозність, доказ, рекомендація, статус'],
  ['critical-report', 'Critical Report', 'Звіт літературного критика', 'J1', '#065F46', 'Версія, охоплення, метод, висновки, автор'],

  // J2. Наратив, композиція та мова (11)
  ['narrative-technique', 'Narrative Technique', 'Наративний прийом', 'J2', '#7C3AED', 'Назва, функція, місця застосування, ефект'],
  ['focalization', 'Focalization', 'Фокалізація', 'J2', '#6D28D9', 'Чия перспектива, доступ до знань, зміни'],
  ['temporal-structure', 'Temporal Structure', 'Часова організація', 'J2', '#5B21B6', 'Порядок, тривалість, частота, часові стрибки'],
  ['pacing', 'Pacing', 'Темп оповіді', 'J2', '#8B5CF6', 'Діапазон сцен, інтенсивність, паузи, ритм'],
  ['narrative-tension', 'Narrative Tension', 'Наративна напруга', 'J2', '#9333EA', 'Джерело, розвиток, невизначеність, розрядка'],
  ['stylistic-device', 'Stylistic Device', 'Стилістичний прийом', 'J2', '#A855F7', 'Тип, текстовий фрагмент, функція, частота'],
  ['diction', 'Diction', 'Лексичний вибір', 'J2', '#C026D3', 'Регістр, точність, конотації, повтори'],
  ['syntactic-pattern', 'Syntactic Pattern', 'Синтаксичний патерн', 'J2', '#BE185D', 'Конструкція, частота, ритмічний ефект'],
  ['subtext', 'Subtext', 'Підтекст', 'J2', '#DB2777', 'Буквальний зміст, прихований смисл, підтвердження'],
  ['ambiguity', 'Ambiguity', 'Смислова неоднозначність', 'J2', '#E11D48', 'Конкуруючі прочитання, фрагменти, намір'],
  ['irony', 'Irony', 'Іронія', 'J2', '#BE123C', 'Тип, розрив між сказаним і значенням, контекст'],

  // J3. Контекст, читач і проблеми тексту (9)
  ['intertextual-reference', 'Intertextual Reference', 'Інтертекстуальне посилання', 'J3', '#B45309', 'Інший твір, тип перегуку, джерело, впевненість'],
  ['genre-convention', 'Genre Convention', 'Жанрова конвенція', 'J3', '#A16207', 'Жанр, очікування, дотримання або порушення'],
  ['reader-response', 'Reader Response Hypothesis', 'Гіпотеза реакції читача', 'J3', '#CA8A04', 'Аудиторія, очікувана реакція, підстава, межі'],
  ['reception-context', 'Reception Context', 'Контекст сприйняття', 'J3', '#854D0E', 'Епоха, аудиторія, культурні умови, джерела'],
  ['comparative-work', 'Comparative Work', 'Твір для порівняння', 'J3', '#92400E', 'Назва, автор, підстава порівняння, джерело'],
  ['coherence-issue', 'Coherence Issue', 'Проблема зв’язності', 'J3', '#DC2626', 'Рівень, фрагменти, тип розриву, серйозність'],
  ['continuity-issue', 'Continuity Issue', 'Проблема безперервності', 'J3', '#B91C1C', 'Суперечливі факти, сцени, часові стани'],
  ['critical-recommendation', 'Critical Recommendation', 'Рекомендація критика', 'J3', '#EA580C', 'Ціль, дія, підстава, пріоритет, статус'],
  ['revision-outcome', 'Revision Outcome', 'Результат редакторської правки', 'J3', '#16A34A', 'До/після, авторське рішення, перевірка ефекту'],
];

function expand(row: EntityRow): CoreEntity {
  const [slug, nameEn, nameUk, groupId, color, characteristics] = row;
  const group = CORE_ENTITY_GROUPS.find((g) => g.id === groupId);
  return {
    tag: `/${slug}`,
    slug,
    nameUk,
    nameEn,
    groupId,
    color,
    characteristics: characteristics.split(',').map((c) => c.trim()).filter(Boolean),
    registry: group?.registry ?? 'base',
  };
}

/** Усі 118 типів сутностей. Порядок — як у документі (A → I, далі J1 → J3). */
export const CORE_ENTITIES: CoreEntity[] = ENTITY_ROWS.map(expand);

/**
 * Зв'язки. Базові 21 — з розділу J базового документа, критичні 16 — з J4
 * додатка. Документ описує їх як окремий перелік, а не як різновид
 * сутностей: тому це друга таблиця (`core_entity_relations`), а не
 * `kind='relation'` у тій самій — інакше «118 сутностей» перестало б бути
 * правдою в тому ж запиті.
 */
const RELATION_ROWS: [key: string, nameUk: string, example: string, registry: CoreEntityRegistry][] = [
  ['contains', 'Містить', 'Глава → сцена', 'base'],
  ['part_of', 'Є частиною', 'Сцена → сюжетна лінія', 'base'],
  ['participates_in', 'Бере участь', 'Сергій → подія', 'base'],
  ['performs', 'Виконує', 'Сергій → дія', 'base'],
  ['targets', 'Спрямовано на', 'Дія → персонаж', 'base'],
  ['experiences', 'Переживає', 'Сергій → страх', 'base'],
  ['caused_by', 'Спричинено', 'Страх → викрадення', 'base'],
  ['triggers', 'Запускає', 'Викрадення → поріг', 'base'],
  ['motivates', 'Мотивує', 'Потреба → рішення', 'base'],
  ['opposes', 'Протидіє', 'Антагоніст → герой', 'base'],
  ['prevents', 'Перешкоджає', 'Перешкода → мета', 'base'],
  ['leads_to', 'Призводить до', 'Рішення → наслідок', 'base'],
  ['transforms', 'Трансформує', 'Подія → переконання', 'base'],
  ['precedes', 'Передує', 'Подія A → подія B', 'base'],
  ['depicts', 'Зображує', 'Портрет → Сергій', 'base'],
  ['describes', 'Описує', 'Зовнішність → Сергій', 'base'],
  ['supports', 'Підтверджує', 'Доказ → твердження', 'base'],
  ['contradicts', 'Суперечить', 'Факт A → факт B', 'base'],
  ['requires', 'Потребує', 'Крок → інструмент', 'base'],
  ['assesses', 'Оцінює', 'Тест → навичка', 'base'],
  ['unlocks', 'Відкриває доступ', 'Квест → гілка', 'base'],
  ['analyzes', 'аналізує', '/critical-review → /document', 'critic'],
  ['advances', 'висуває тезу', '/critical-argument → /critical-thesis', 'critic'],
  ['challenges', 'оспорює', '/counterargument → /critical-thesis', 'critic'],
  ['interprets', 'інтерпретує', '/interpretation → /symbol', 'critic'],
  ['cites_passage', 'посилається на фрагмент', '/critical-observation → /paragraph', 'critic'],
  ['applies_criterion', 'застосовує критерій', '/critical-judgment → /critical-criterion', 'critic'],
  ['substantiates', 'обґрунтовує', '/evidence → /critical-argument', 'critic'],
  ['uses_technique', 'застосовує прийом', '/scene → /narrative-technique', 'critic'],
  ['focalized_through', 'подає через перспективу', '/scene → /character', 'critic'],
  ['creates_tension', 'створює напругу', '/event → /narrative-tension', 'critic'],
  ['echoes', 'перегукується з', '/document → /comparative-work', 'critic'],
  ['violates_convention', 'порушує конвенцію', '/scene → /genre-convention', 'critic'],
  ['predicts_response', 'припускає реакцію', '/reader-response → /scene', 'critic'],
  ['flags_issue', 'позначає проблему', '/critical-finding → /coherence-issue', 'critic'],
  ['recommends', 'рекомендує', '/critical-finding → /critical-recommendation', 'critic'],
  ['addresses_issue', 'усуває або розглядає', '/revision-outcome → /critical-finding', 'critic'],
];

export const CORE_ENTITY_RELATIONS: CoreEntityRelation[] = RELATION_ROWS.map(
  ([key, nameUk, example, registry]) => ({ key, nameUk, example, registry })
);

/** Скільки саме сутностей мусить бути в реєстрі — охорона від випадкового видалення рядка. */
export const CORE_ENTITY_COUNT = 118;
/** Скількох типів зв'язків — те саме. */
export const CORE_RELATION_COUNT = 37;
/** Базовий реєстр без додатка критики — для перевірок походження запису. */
export const CORE_ENTITY_BASE_COUNT = 88;
/** Додаток «Літературна критика». */
export const CORE_ENTITY_CRITIC_COUNT = 30;

/**
 * Максимум сутностей на один абзац (постановка власника, пункт 7: «однієї,
 * двох чи більше — до 12»). Обмеження не декоративне: дванадцять кольорів
 * на абзаці — це вже межа того, що людина розрізняє як окремі мітки, а
 * панель показує лічильник саме проти цього числа.
 */
export const MAX_ENTITIES_PER_PARAGRAPH = 12;

// ---------------------------------------------------------------------------
// Пошук і звернення до записів
// ---------------------------------------------------------------------------

const BY_SLUG = new Map(CORE_ENTITIES.map((e) => [e.slug, e]));
const BY_TAG = new Map(CORE_ENTITIES.map((e) => [e.tag, e]));

/** Нормалізація псевдоніма: регістр, « / » та подвійні пропуски. */
function normalizeAlias(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Українські (і англійські) назви як ключі тега.
 *
 * НАВІЩО. Постановка власника (23.09.2026, п. 3): усі 118 тегів мають
 * вводитись і англійською, і українською. Тобто `/персонаж:Сергій` мусить
 * працювати так само, як `/character:Serhii`. Документ реєстру сам каже, чому
 * канонічним лишається англійський ключ: «Українські назви використовуються в
 * інтерфейсі, англомовні теги — як стабільні системні ключі». Тож у книгу
 * завжди пишеться англійський slug, а українська назва — це лише спосіб його
 * набрати.
 *
 * Реєструємо декілька форм на одну сутність:
 *   • англійську назву (`rider`), бо її автор бачить у панелі англійською;
 *   • повну українську назву;
 *   • першу частину складеної назви до «/»: «Глава / розділ» → «глава».
 *     Без цього складене ім'я вимагало б набирати слеш усередині тега, а він
 *     там службовий — тег `/глава розділ:x` виглядав би як дві сутності.
 */
const ALIASES = new Map<string, CoreEntity>();
for (const entity of CORE_ENTITIES) {
  const candidates = [
    entity.nameEn,
    entity.nameUk,
    entity.nameUk.split('/')[0],
    // Українська назва-«рід» без уточнення в дужках: «Емоційний стан (тип)» — немає,
    // але «Проблема безперервності» лишається як є.
  ];
  for (const candidate of candidates) {
    const alias = normalizeAlias(candidate);
    // Перша реєстрація виграє: інакше однакові українські назви в різних
    // сутностей (їх у документі 32 за кольорами, а за назвами теж буває)
    // перезаписували б одна одну в непередбачуваному порядку.
    if (alias && !ALIASES.has(alias)) ALIASES.set(alias, entity);
  }
  const bySlugAlias = normalizeAlias(entity.slug.replace(/-/g, ' '));
  if (!ALIASES.has(bySlugAlias)) ALIASES.set(bySlugAlias, entity);
}

/**
 * Слова, якими автор реально називає сутність, але яких немає серед назв
 * документа. Потрібні рівно для двох випадків, і обидва — не здогад:
 *
 *   • **«герой»** — так сутність `character` називає САМ ВЛАСНИК у постановці
 *     («тег сутності `/ герой:Ім'я`»). У документі її українська назва —
 *     «Персонаж», і без цього рядка жест власника не працював би.
 *   • **назви-фрази** — «Емоційний стан», «Мовний портрет»: автор набиратиме
 *     «емоція», а не «емоційний стан». Додаємо лише ті, де слово є очевидним
 *     і не збігається з іншою сутністю.
 *
 * Розширювати цей список «на всяк випадок» не можна: кожен аліас — це ще один
 * спосіб написати ключ, і зайвий аліас тихо зробить тегом те, що тегом не
 * задумано (саме тому «сирі» теги перевіряються реєстром, див. `stripEntityTags`).
 */
const EXTRA_ALIASES: Record<string, string> = {
  герой: 'character',
  героїня: 'character',
  емоція: 'emotion',
};
for (const [alias, slug] of Object.entries(EXTRA_ALIASES)) {
  const entity = CORE_ENTITIES.find((e) => e.slug === slug);
  if (entity && !ALIASES.has(normalizeAlias(alias))) ALIASES.set(normalizeAlias(alias), entity);
}

/** Сутність за ключем без слеша (`character`), зі слешем або за назвою (`Персонаж`, `Character`). */
export function entityBySlug(slugOrTag: string): CoreEntity | undefined {
  const raw = String(slugOrTag || '').trim().toLowerCase();
  if (!raw) return undefined;
  const withoutSlash = raw.replace(/^\//, '');
  return BY_SLUG.get(withoutSlash) || BY_TAG.get(raw) || ALIASES.get(normalizeAlias(withoutSlash));
}

/** Чи це ключ, за яким реєстр справді знає сутність — для розпізнавання тегів у тексті. */
export function isKnownEntityKey(key: string): boolean {
  return !!entityBySlug(key);
}

export function entityGroup(groupId: string): CoreEntityGroup | undefined {
  return CORE_ENTITY_GROUPS.find((g) => g.id === groupId);
}

/** Сутності одної групи — у порядку документа. */
export function entitiesInGroup(groupId: string): CoreEntity[] {
  return CORE_ENTITIES.filter((e) => e.groupId === groupId);
}

/**
 * Підбір сутностей за тим, що вже набрав автор.
 *
 * Саме ПРЕФІКС, а не «містить»: пункт 3 постановки описує підбір за першими
 * однією-двома-трьома літерами, тобто автор диктує початок ключа. Пошук
 * «де завгодно» на трьох літерах давав би десятки випадкових збігів і
 * робив би Tab небезпечним.
 *
 * Порядок результатів: точний початок ключа → початок англійської назви →
 * початок української назви → початок характеристики. Так `/char` дає
 * спершу `character`, а вже потім `character-arc`, `character-state`,
 * `character-voice` — і Tab без вибору стрілками робить найочевидніше.
 */
export function searchEntities(query: string, limit = 8): CoreEntity[] {
  const q = String(query || '').trim().toLowerCase().replace(/^\//, '');
  if (!q) return CORE_ENTITIES.slice(0, limit);

  const scored: { entity: CoreEntity; score: number; index: number }[] = [];
  CORE_ENTITIES.forEach((entity, index) => {
    const slug = entity.slug.toLowerCase();
    const nameEn = entity.nameEn.toLowerCase();
    const nameUk = entity.nameUk.toLowerCase();
    let score = -1;
    if (slug === q) score = 0;
    else if (slug.startsWith(q)) score = 1;
    else if (nameEn.startsWith(q)) score = 2;
    else if (nameUk.startsWith(q)) score = 3;
    else if (entity.characteristics.some((c) => c.toLowerCase().startsWith(q))) score = 4;
    if (score >= 0) scored.push({ entity, score, index });
  });

  scored.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.index - b.index));
  return scored.slice(0, limit).map((s) => s.entity);
}

/** Характеристики сутності, що починаються з набраного — другий крок підбору. */
export function searchCharacteristics(entity: CoreEntity, query: string, limit = 8): string[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return entity.characteristics.slice(0, limit);
  return entity.characteristics.filter((c) => c.toLowerCase().startsWith(q)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Тег у тексті: побудова, розбір, зняття
// ---------------------------------------------------------------------------

/**
 * Символ-розділювач у тегу. Саме двокрапка, як у документі
 * (`/character:Serhii`).
 */
export const ENTITY_TAG_SEPARATOR = ':';

/**
 * Регулярка тега. Навмисно вузька: слеш, ключ лише з `a-z0-9-`, двокрапка,
 * значення БЕЗ дужок і без переходу рядка. Усе, що не підходить під це,
 * тегом не вважається — і це правильно: хибний збіг зіпсував би текст при
 * знятті тегів на експорті, а це вже незворотна втрата авторського тексту.
 *
 * Значення може бути порожнім (`[/character:]`) — це стан «сутність обрана,
 * характеристику ще пишуть», і він має лишатися розпізнаваним.
 */
export function entityTagRegexp(): RegExp {
  // Ключ допускає кирилицю: власник просив вводити теги і українською
  // (`/персонаж:Сергій`), а не лише англійським slug. Канонічною у книзі все
  // одно стає англійська форма (див. `buildEntityTag`), але розпізнати й
  // убрати з експорту треба ОБИДВІ — інакше український тег потрапив би
  // в надруковану книгу.
  return /\[(\/[a-z0-9\u0400-\u04FF-]+):([^\]\n]*)\]/g;
}

/**
 * Інлайн-маркери форматування рукопису — ті самі, що розбирає
 * `utils/manuscriptDoc.ts` (INLINE_TOKEN): жирний/курсив, шрифт, розмір,
 * колір, виділення, посилання. Порядок `\*\*` перед `\*` — як там же.
 */
const FORMAT_MARKER_SOURCE =
  '\\*\\*|\\*|\\[FONT="[^"]*"\\]|\\[\\/FONT\\]|\\[SIZE=[\\d.]+\\]|\\[\\/SIZE\\]|\\[COLOR="[^"]*"\\]|\\[\\/COLOR\\]|\\[HL="[^"]*"\\]|\\[\\/HL\\]|\\[LINK="[^"]*"\\]|\\[\\/LINK\\]';

/** Чи збалансовані маркери всередині тега: кожен відкритий там же й закритий. */
function markersBalanced(markers: string[]): boolean {
  let bold = 0;
  let italic = 0;
  const depth: Record<string, number> = {};
  for (const mk of markers) {
    if (mk === '**') bold ^= 1;
    else if (mk === '*') italic ^= 1;
    else {
      const close = /^\[\/(FONT|SIZE|COLOR|HL|LINK)\]$/.exec(mk);
      const open = /^\[(FONT|SIZE|COLOR|HL|LINK)[=]/.exec(mk);
      if (open) depth[open[1]] = (depth[open[1]] || 0) + 1;
      else if (close) {
        depth[close[1]] = (depth[close[1]] || 0) - 1;
        if (depth[close[1]] < 0) return false;
      }
    }
  }
  return bold === 0 && italic === 0 && Object.values(depth).every((d) => d === 0);
}

/**
 * Знімає канонічні теги, які форматування розрізало маркерами.
 *
 * ВАДА, ЯКУ ЦЕ ЗАКРИВАЄ (власник, 24.09.2026): досить пофарбувати чи
 * виділити жирним частину тега — і в рукописі він зберігається як
 * `[[COLOR="#e11d48"]/character:Олена[/COLOR]]` або `[/emotion:**страх**]`.
 * Звичайний `entityTagRegexp` такого тега не бачить, тож у редакторі
 * «Сховати сутності» лишало дужки `[` `]`, а експорт друкував тег повністю.
 *
 * Як: маркери стають «нульової ширини» — тег шукається в тексті без них,
 * потім знімаються саме символи тега. Маркери, що стоять ВСЕРЕДИНІ тега й
 * там же закриваються, знімаються разом із ним (інакше лишився б `****`);
 * якщо маркер лише відкрився в тезі, а закривається в тексті книги, — він
 * лишається, щоб не зламати форматування сусіднього тексту. Порожні пари,
 * що лишилися навколо знятого тега (`[COLOR="…"][/COLOR]`), прибираються.
 */
export function removeFormattedEntityTags(text: string): string {
  const source = String(text ?? '');
  if (!source.includes('/') || !/\*|\[(?:FONT|SIZE|COLOR|HL|LINK)=/.test(source)) return source;

  const markerRe = new RegExp(FORMAT_MARKER_SOURCE, 'g');
  const plainChars: string[] = [];
  const plainToSource: number[] = [];
  const markerSpans: { start: number; end: number; text: string }[] = [];
  let cursor = 0;
  let mm: RegExpExecArray | null;
  while ((mm = markerRe.exec(source))) {
    for (let i = cursor; i < mm.index; i++) { plainChars.push(source[i]); plainToSource.push(i); }
    markerSpans.push({ start: mm.index, end: mm.index + mm[0].length, text: mm[0] });
    cursor = mm.index + mm[0].length;
  }
  if (!markerSpans.length) return source;
  for (let i = cursor; i < source.length; i++) { plainChars.push(source[i]); plainToSource.push(i); }

  const plain = plainChars.join('');
  const drop = new Uint8Array(source.length);
  let changed = false;
  const tagRe = entityTagRegexp();
  let tm: RegExpExecArray | null;
  while ((tm = tagRe.exec(plain))) {
    const from = plainToSource[tm.index];
    const to = plainToSource[tm.index + tm[0].length - 1] + 1;
    // Тег без маркерів усередині теж знімається тут: тоді порожня пара
    // навколо нього (`[COLOR="…"][/COLOR]`) прибереться нижче, а не лишиться.
    for (let k = tm.index; k < tm.index + tm[0].length; k++) drop[plainToSource[k]] = 1;
    const inside = markerSpans.filter((s) => s.start >= from && s.end <= to);
    if (markersBalanced(inside.map((s) => s.text))) {
      inside.forEach((s) => { for (let k = s.start; k < s.end; k++) drop[k] = 1; });
    }
    changed = true;
  }
  if (!changed) return source;

  let out = '';
  for (let i = 0; i < source.length; i++) if (!drop[i]) out += source[i];
  return out
    .replace(/\[(FONT|COLOR|HL|LINK)="[^"]*"\]\[\/\1\]/g, '')
    .replace(/\[SIZE=[\d.]+\]\[\/SIZE\]/g, '');
}

/** Один розібраний тег: сутність плюс те, що автор написав після двокрапки. */
export interface ParsedEntityTag {
  /** Тег як у документі: `/character`. */
  tag: string;
  slug: string;
  /** Значення після двокрапки — може бути порожнім. */
  value: string;
  /** Сутність із реєстру; `undefined`, якщо тег у тексті не з реєстру. */
  entity?: CoreEntity;
  /** Позиція в рядку — потрібна підсвітці й заміні. */
  start: number;
  end: number;
}

/** Будує тег для тексту книги. Значення обрізається від дужок, щоб не зламати розбір. */
export function buildEntityTag(slugOrTag: string, value = ''): string {
  const entity = entityBySlug(slugOrTag);
  const slug = entity ? entity.slug : String(slugOrTag || '').trim().toLowerCase().replace(/^\/+/, '');
  const clean = String(value || '').replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return `[/${slug}:${clean}]`;
}

/** Усі теги в рядку — у порядку появи. */
export function parseEntityTags(text: string): ParsedEntityTag[] {
  const source = String(text ?? '');
  const re = entityTagRegexp();
  const found: ParsedEntityTag[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const slug = m[1].slice(1);
    found.push({
      tag: m[1],
      slug,
      value: (m[2] || '').trim(),
      entity: entityBySlug(slug),
      start: m.index,
      end: m.index + m[0].length,
    });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return found;
}

/**
 * Прибирає теги з тексту — для PDF, DOCX, TXT і будь-якого експорту
 * (постановка, пункт 6: «теги сутностей не включаємо в документ PDF-експорту
 * та форматування»).
 *
 * Дві речі, які тут важливі й неочевидні:
 *   1. Пробіл на місці тега не лишається «як є». Тег стоїть на початку абзацу
 *      разом із рештою тегів, тож після зняття утворюється набір порожніх
 *      пропусків і переносів. Їх прибирає `tidy` — інакше в PDF поїхали б
 *      відступи перед кожним абзацом.
 *   2. Порожній рядок, що лишився від тега в абзаці, ЯКИЙ СКЛАДАВСЯ ЛИШЕ З
 *      ТЕГІВ, прибирається повністю: друкувати порожнє місце замість абзацу
 *      з самими тегами — єдиний наслідок, якого автор не побачив би заздалегідь.
 */
export function stripEntityTags(text: string): string {
  const original = String(text ?? '');
  if (!original.includes('/')) return original;
  // Спершу — теги, розрізані маркерами форматування (див. removeFormattedEntityTags).
  // Перевірка на `/` — ДО цього кроку: після нього тегів уже може не лишитись,
  // а прибирання пропусків нижче все одно потрібне.
  const source = removeFormattedEntityTags(original);

  /*
   * Знімаються ОБИДВІ форми — канонічна й «сира», одним проходом.
   *
   * Канонічна (`[/character:Serhii]`) знімається завжди: це наш службовий
   * синтаксис, і в купленій книзі його не має бути навіть тоді, коли ключа
   * немає в реєстрі (автор помилився в літері — це все одно маркер, а не
   * текст).
   *
   * «Сира» (`/character:Serhii` без дужок) знімається ЛИШЕ якщо ключ є в
   * реєстрі. Це страховка на випадок, коли нормалізація ще не відбулася
   * (вона робиться в редакторі на виході з нього), і водночас захист
   * звичайного тексту: «стор. /2:3», дроби й URL-и лишаються як є, бо їхніх
   * ключів у реєстрі немає.
   */
  const withoutTags = source.replace(
    /\[(\/[a-z0-9\u0400-\u04FF-]+):([^\]\n]*)\]|(^|[\s({«"',;:—-])(\/[a-z0-9\u0400-\u04FF-]+):([^\s\n\]]*)/g,
    (full, wrappedTag: string | undefined, _wrappedValue: string, prefix: string | undefined, looseTag: string | undefined) => {
      if (wrappedTag) return '';
      if (looseTag && entityBySlug(looseTag.slice(1))) return prefix || '';
      return full;
    }
  );

  return withoutTags
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Абзаци тексту разом із їхніми сутностями.
 *
 * Абзац — це те, чим він є для автора: блок між порожніми рядками. Межа
 * взята з тією ж логікою, що й у PDF-рушії (`toParagraphs` у
 * server/pdf/pdfRenderer.ts ділить саме по `\n\s*\n`), тож «абзац» тут і
 * «абзац» у зверстаній книзі — одне й те саме, а не дві різні межі, які
 * розійшлися б за першої ж правки.
 */
export interface ParagraphEntityInfo {
  index: number;
  /** Текст абзацу БЕЗ тегів — те, що друкується. */
  text: string;
  entities: ParsedEntityTag[];
  /** Колір першої заявленої сутності — ним краситься фон абзацу. */
  color?: string;
}

export function paragraphsWithEntities(content: string): ParagraphEntityInfo[] {
  const source = String(content ?? '').replace(/\r\n?/g, '\n');
  return source
    .split(/\n\s*\n/)
    .map((raw, index) => {
      const entities = parseEntityTags(raw);
      const withEntity = entities.find((e) => e.entity);
      return {
        index,
        text: stripEntityTags(raw).trim(),
        entities,
        color: withEntity?.entity?.color,
      };
    })
    .filter((p) => p.text.length > 0 || p.entities.length > 0);
}

// ---------------------------------------------------------------------------
// Кольори: фон абзацу, фон канви, кнопки
// ---------------------------------------------------------------------------

/** Розбирає `#RRGGBB` у три канали. Повертає null на будь-що інше. */
function hexChannels(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Змішує колір із білим. `amount` — частка білого: 0 — колір як є,
 * 1 — білий.
 *
 * Навіщо окрема функція, а не `color + '20'` (альфа у восьмизначному HEX):
 * альфа-фон працює лише там, де під ним біле тло. У редакторі канва темна,
 * у чаті — теж, а в PDF абзац має бути світлий із темним текстом. Змішування
 * дає НЕПРОЗОРИЙ світлий відтінок, який читається однаково на будь-якому тлі.
 */
export function mixWithWhite(hex: string, amount: number): string {
  const rgb = hexChannels(hex);
  if (!rgb) return hex;
  const a = Math.max(0, Math.min(1, amount));
  return toHex([rgb[0] + (255 - rgb[0]) * a, rgb[1] + (255 - rgb[1]) * a, rgb[2] + (255 - rgb[2]) * a]);
}

/**
 * Тло абзацу з позначеними сутностями.
 *
 * Постановка, пункт 8: покрашення мусить бути **на декілька тонів світліше**
 * від кольору сутності, щоб текст лишався читабельним. Це не косметика:
 * кольори реєстру насичені (є #DC2626, #4338CA), і абзац, залитий кольором
 * як є, зробив би текст нечитабельним — тобто фіча зламала б роботу з
 * рукописом. 0.86 лишає від кольору рівно стільки, щоб він розрізнявся
 * серед сусідніх абзаців, і не заважав читати.
 */
export const ENTITY_PARAGRAPH_TINT = 0.86;

export function paragraphBackground(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return mixWithWhite(color, ENTITY_PARAGRAPH_TINT);
}

/** Той самий відтінок, але для темної канви чату й редактора. */
export const ENTITY_DARK_TINT = 0.72;

export function paragraphBackgroundDark(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return mixWithWhite(color, ENTITY_DARK_TINT);
}

/**
 * Змішує колір із чорним — для тем канви, де білий відтінок зробив би текст
 * нечитабельним (світле тло під світлим шрифтом редактора).
 */
export function mixWithBlack(hex: string, amount: number): string {
  const rgb = hexChannels(hex);
  if (!rgb) return hex;
  const a = Math.max(0, Math.min(1, amount));
  return toHex([rgb[0] * (1 - a), rgb[1] * (1 - a), rgb[2] * (1 - a)]);
}

/**
 * Читабельний колір тексту на заданому тлі.
 *
 * Навіщо це окремою функцією, а не «завжди білий» чи «завжди темний». Кольори
 * реєстру простягаються від #FACC15 (світлий жовтий) до #312E81 (майже
 * чорний синій). Білий текст на жовтому сузір'ї `revelation` не читається
 * взагалі, темний на `ending` — теж. Порог береться за відносною яскравістю
 * (формула WCAG), а не за середнім каналом: око по-різному важить зелений і
 * синій, і «середнє» давало б неправильний бік для половини палітри.
 */
export function readableTextOn(hex: string): string {
  return relativeLuminance(hex) > 0.45 ? '#0f172a' : '#ffffff';
}

/** Відносна яскравість кольору за WCAG (0 — чорний, 1 — білий). */
function relativeLuminance(hex: string): number {
  const rgb = hexChannels(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Колір ТЕКСТУ тега на білій канві книги (рішення власника 23.09.2026: тег
 * позначається кольором тексту, а не заливкою абзацу).
 *
 * ЧОМУ НЕ КОЛІР ІЗ ДОКУМЕНТА ЯК Є. Палітра реєстру простягається від
 * `#FACC15` (світлий жовтий) до `#312E81` (майже чорний синій): на білій
 * сторінці жовтий тег не читався б зовсім, а темні кольори навпаки — цілком
 * годяться. Тому колір затемнюється рівно настільки, щоб пройти поріг
 * читабельності, і не більше: зайве затемнення зробило б різні сутності
 * однаковими на вигляд.
 */
export function textColorOnWhite(hex: string, maxLuminance = 0.42): string {
  if (!hexChannels(hex)) return hex;
  let out = hex;
  for (let amount = 0; amount <= 0.8; amount += 0.08) {
    if (relativeLuminance(out) <= maxLuminance) break;
    out = mixWithBlack(hex, amount);
  }
  return out;
}

/**
 * Колір тексту тега на темній канві (чат, нічна тема): колір навпаки
 * освітлюється, бо інакше `#312E81` злився б із тлом.
 */
export function textColorOnDark(hex: string, minLuminance = 0.5): string {
  if (!hexChannels(hex)) return hex;
  let out = hex;
  for (let amount = 0; amount <= 0.8; amount += 0.08) {
    if (relativeLuminance(out) >= minLuminance) break;
    out = mixWithWhite(hex, amount);
  }
  return out;
}

/**
 * Тло абзацу на темній канві редактора й чату.
 *
 * Це НЕ `paragraphBackgroundDark`: там колір змішується з білим (світле тло
 * під темним текстом), тут — із чорним, бо текст у канві світлий. Обидва
 * потрібні: одне й те саме тло не може бути читабельним і для світлого
 * шрифту на темній канві, і для темного на друкованій сторінці.
 */
export function paragraphBackgroundOnDarkCanvas(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return mixWithBlack(color, 0.62);
}

/**
 * Кольори, які в документі повторюються.
 *
 * Документ сам про це попереджає: «Деякі близькі типи мають однаковий HEX;
 * якщо потрібна абсолютна унікальність кольорів, її варто забезпечити
 * окремою перевіркою під час імпорту». Це і є та перевірка — вона нічого не
 * ламає й нічого не «виправляє»: вигадувати власні кольори замість
 * документованих означало б розійтися з реєстром власника.
 */
export function duplicateColors(): { color: string; slugs: string[] }[] {
  const byColor = new Map<string, string[]>();
  for (const entity of CORE_ENTITIES) {
    const key = entity.color.toUpperCase();
    byColor.set(key, [...(byColor.get(key) || []), entity.slug]);
  }
  return [...byColor.entries()]
    .filter(([, slugs]) => slugs.length > 1)
    .map(([color, slugs]) => ({ color, slugs }));
}

// ---------------------------------------------------------------------------
// «Сирий» тег: те, що автор набирає руками
// ---------------------------------------------------------------------------

/**
 * Розпізнає тег у тому вигляді, у якому його НАБИРАЄ автор — без дужок:
 * `/character:Serhii`.
 *
 * Навіщо окремо від `parseEntityTags`. Дужковий маркер — це те, що лежить у
 * файлі; а те, що людина набирає в канві, дужок не має й мати не повинно
 * (постановка описує формат саме як «/сутність:назва характеристики»).
 * Підсвітка має працювати ВЖЕ ПІД ЧАС набору, а не після збереження, тому
 * читати треба обидві форми.
 *
 * ЩО ТУТ ГОЛОВНЕ — і чому це не «пошук слеша з двокрапкою». Кандидат
 * приймається ЛИШЕ ЯКЩО КЛЮЧ Є В РЕЄСТРІ. Без цієї умови звичайний текст
 * автора ставав би тегами: «Див. стор. /2:3» — це слеш із двокрапкою, і
 * наївний патерн перетворив би його на сутність `/2`, якої не існує, а
 * потім ще й зняв би його на експорті. Перевірка по реєстру робить хибне
 * спрацювання неможливим за побудовою, а не «малоймовірним».
 *
 * Межа слова перед слешем теж обов'язкова: `https://example.com/a:1`
 * містить `/a:1`, і без неї URL перетворився б на тег.
 */
export function parseLooseEntityTags(text: string): ParsedEntityTag[] {
  const source = String(text ?? '');
  if (!source.includes('/')) return [];
  // У класі межі НЕМАЄ квадратної дужки — і це не дрібниця. З нею патерн
  // ловив тег УСЕРЕДИНІ вже канонічного маркера (`[/character:Serhii]`),
  // бо перед слешем стоїть саме «[». Наслідок був подвійний: підсвітка
  // малювала два теги на одному місці, а нормалізація перетворювала
  // `[/character:Serhii]` на `[[/character:Serhii]]` — тобто псувала
  // канонічний маркер при кожному збереженні. Знайдено тестом.
  const re = /(^|[\s({«"',;:—-])(\/[a-z0-9\u0400-\u04FF-]+):([^\s\n\]]*)/g;
  const found: ParsedEntityTag[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const slug = m[2].slice(1);
    const entity = entityBySlug(slug);
    if (!entity) continue;
    const start = m.index + m[1].length;
    const value = (m[3] || '').replace(/[.,;:!?)]+$/, '').trim();
    found.push({
      tag: m[2],
      slug,
      value,
      entity,
      start,
      end: start + m[2].length + 1 + value.length,
    });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return found;
}

/**
 * Перетворює набрані руками теги на канонічні маркери:
 * `/character:Serhii` → `[/character:Serhii]`.
 *
 * Для чого. Поки автор набирає, у документі лежить «сира» форма — з нею
 * зручно писати й видно курсор. Але зберігати її не можна: текст без межі
 * неможливо безпечно зняти на експорті (див. коментар до `parseLooseEntityTags`)
 * і неможливо відрізнити від звичайного тексту при читанні книги на сервері.
 * Тому нормалізація робиться ОДИН раз — на шляху до книги, а не під час
 * кожного натискання клавіші.
 *
 * Функція чиста й ідемпотентна: текст, у якому теги вже в дужках, вона не
 * чіпає (дужкова форма не проходить межу слова перед слешем — там стоїть «[»,
 * який у клас межі не входить саме тому, щоб не зламати вже канонічний тег).
 */
export function wrapPlainEntityTags(text: string): string {
  const source = String(text ?? '');
  if (!source.includes('/')) return source;
  const loose = parseLooseEntityTags(source);
  if (loose.length === 0) return source;

  let out = '';
  let cursor = 0;
  for (const tag of loose) {
    out += source.slice(cursor, tag.start);
    out += `[${tag.tag}:${tag.value}]`;
    cursor = tag.end;
  }
  out += source.slice(cursor);
  return out;
}

/** Усі теги в тексті — в обох формах, у порядку появи (для підсвітки канви). */
export function parseAnyEntityTags(text: string): ParsedEntityTag[] {
  const wrapped = parseEntityTags(text);
  const loose = parseLooseEntityTags(text).filter(
    (looseTag) => !wrapped.some((w) => looseTag.start < w.end && w.start < looseTag.end)
  );
  return [...wrapped, ...loose].sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Підказка про зміст сутності (для наведення в панелі)
// ---------------------------------------------------------------------------

/**
 * Текст підказки про сутність — у МОВІ НАБОРУ автора (постановка, п. 4).
 *
 * ЩО ТУТ Є І ЧОГО НЕМАЄ. Усе береться з документа власника й нічого не
 * вигадується: назви (англійська й українська — у документі вони обидві),
 * група й перелік характеристик («Основні характеристики» — колонка
 * документа). **Опису-речення** в документі немає для жодної з 118 сутностей,
 * тому підказка не вдає, ніби він існує: вона показує саме те, що власник у
 * документі написав.
 *
 * Характеристики в документі лише українською — тому в англійському варіанті
 * вони наведені як є, з явною позначкою мови джерела. Перекладати їх означало
 * б розійтися з реєстром: ці слова — назви полів, за якими працюють майбутні
 * правила обробки сутностей.
 */
export function entityTooltip(entity: CoreEntity, lang: 'uk' | 'en' = 'uk'): string {
  const group = CORE_ENTITY_GROUPS.find((g) => g.id === entity.groupId);
  const lines: string[] = [];
  lines.push(`${entity.nameUk} · ${entity.nameEn}`);
  lines.push(`${entity.tag} · ${entity.color}`);
  if (group) {
    lines.push(`${group.id}. ${lang === 'en' ? group.nameEn : group.nameUk}`);
  }
  lines.push(
    entity.characteristics.length > 0
      ? (lang === 'en' ? 'Characteristics (as in the registry): ' : 'Характеристики (з реєстру): ') +
          entity.characteristics.join(', ')
      : lang === 'en'
        ? 'No characteristics listed in the registry'
        : 'Характеристик у реєстрі не вказано'
  );
  lines.push(
    entity.registry === 'critic'
      ? lang === 'en'
        ? 'Appendix: literary critic (J1–J3)'
        : 'Додаток: літературна критика (J1–J3)'
      : lang === 'en'
        ? 'Base registry (A–I)'
        : 'Базовий реєстр (A–I)'
  );
  return lines.join('\n');
}

/** Стисла довідка про склад реєстру — для тестів і для заголовка панелі. */
export function registryStats(): {
  entities: number;
  base: number;
  critic: number;
  relations: number;
  groups: number;
  duplicateColors: number;
} {
  return {
    entities: CORE_ENTITIES.length,
    base: CORE_ENTITIES.filter((e) => e.registry === 'base').length,
    critic: CORE_ENTITIES.filter((e) => e.registry === 'critic').length,
    relations: CORE_ENTITY_RELATIONS.length,
    groups: CORE_ENTITY_GROUPS.length,
    duplicateColors: duplicateColors().length,
  };
}
