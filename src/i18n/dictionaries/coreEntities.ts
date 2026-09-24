/**
 * Словник панелі сутностей ядра (задача #227) — окремим файлом, як
 * `describeCharacter.ts` і `mediaLibraryView.ts`: одне завдання — один
 * словник. Ключі вживаються як `coreEntities.*`.
 *
 * НАЗВИ СУТНОСТЕЙ ТУТ НЕ ПЕРЕКЛАДАЮТЬСЯ — і це навмисно. Українська та
 * англійська назви кожної зі 118 сутностей лежать у самому реєстрі
 * (`src/utils/coreEntities.ts`, перенесеному з документа власника), бо вони є
 * ДАНИМИ реєстру: реєстр — двомовний за побудовою, і дублювати 118 назв у
 * словнику означало б мати два джерела істини для одного слова. Словник
 * містить лише те, що належить інтерфейсу.
 */
export const coreEntities = {
  uk: {
    rootTab: 'Сутності',
    rootTabTitle: 'Реєстр сутностей ядра: 118 типів у 12 групах',
    heading: 'Сутності ядра',
    subheading:
      'Мітьте абзаци сутностями книги. Тег лягає на початок абзацу, фон абзацу бере колір першої сутності, а в PDF-експорт теги не потрапляють.',
    totalLabel: 'У реєстрі {n} типів',
    groupsLabel: '{n} груп · {relations} типів зв’язків',
    baseLabel: 'Базовий реєстр · 88',
    criticLabel: 'Літературна критика · 30',
    searchPlaceholder: 'Ключ або назва: character, сцена, емоція…',
    clearSearch: 'Очистити пошук',
    noResults: 'За запитом «{q}» нічого не знайдено',
    addToParagraph: 'Додати до поточного абзацу',
    insertAtCursor: 'Вставити тег у позицію курсора',
    paragraphCounter: 'У цьому абзаці {n} із {max} сутностей',
    paragraphFull: 'Межа {max} сутностей на абзац досягнута',
    sectionUsage: 'У розділі заявлено:',
    nothingInSection: 'У цьому розділі сутностей ще немає',
    hideBtn: 'Сховати сутності',
    showBtn: 'Показати сутності',
    hiddenHint: 'Сутності приховані: у книзі лишився тільки текст.',
    visibleHint: 'Сутності показані: теги видно, абзаци пофарбовані.',
    slashHint: 'Наберіть / і ключ сутності — Таб підставить вибране',
    slashEntityHint: 'Таб — узяти сутність',
    slashValueHint: 'Таб — узяти характеристику, Enter — закрити тег',
    slashFieldsHint: 'Формат: {fields} · чиє — «@Ім’я» в кінці',
    duplicatesNote: 'У документі {n} кольорів повторюються — так і задумано в реєстрі.',
    needEditor: 'Відкрийте розділ, щоб додавати сутності в текст.',
    characteristicsLabel: 'Характеристики:',
    // Чат зі ШІ (п. 7 постановки): ті самі сутності, але в розмові.
    chatPickerButton: 'Сутності',
    chatPickerTitle: 'Сутності ядра · {n} типів',
    chatPickerHint: 'Натисніть сутність — тег стане в текст запиту в позицію курсора.',
    chatGroupingTitle: 'Сутності цієї розмови:',
    chatGroupingEmpty: 'У цій розмові сутностей ще не заявлено.',
    chatMessageEntities: 'Сутності репліки:',
    // Права панель сутностей у чаті (постановка 23.09.2026, п. 5).
    chatPanelTitle: 'Сутності ядра',
    chatPanelToggleOn: 'Теги увімкнено',
    chatPanelToggleOff: 'Показати теги ядра',
    chatPanelToggleHint: 'Показати теги в репліках і попросити ШІ тегувати свої відповіді',
    chatPanelHintOn:
      'Увімкнено: у репліках видно теги, і ШІ додає теги до своїх відповідей — щоб було ясно, про яку сутність він говорить.',
    chatPanelHintOff:
      'Вимкнено: теги в репліках приховані й модель їх не додає. Вибір сутності в запит працює завжди.',
    chatPanelPickHint: 'Клік по сутності — тег стане в текст запиту в позицію курсора.',
    entityHintLabel: 'Зміст тега',
  },
  en: {
    rootTab: 'Entities',
    rootTabTitle: 'Core entity registry: 118 types in 12 groups',
    heading: 'Core entities',
    subheading:
      'Tag book paragraphs with entities. The tag goes to the start of the paragraph, the paragraph background takes the colour of the first entity, and tags never reach the PDF export.',
    totalLabel: '{n} types in the registry',
    groupsLabel: '{n} groups · {relations} relation types',
    baseLabel: 'Base registry · 88',
    criticLabel: 'Literary critic · 30',
    searchPlaceholder: 'Key or name: character, scene, emotion…',
    clearSearch: 'Clear search',
    noResults: 'Nothing found for “{q}”',
    addToParagraph: 'Add to the current paragraph',
    insertAtCursor: 'Insert the tag at the cursor',
    paragraphCounter: '{n} of {max} entities in this paragraph',
    paragraphFull: 'The limit of {max} entities per paragraph is reached',
    sectionUsage: 'Declared in this section:',
    nothingInSection: 'No entities in this section yet',
    hideBtn: 'Hide entities',
    showBtn: 'Show entities',
    hiddenHint: 'Entities are hidden: only the text remains in the book.',
    visibleHint: 'Entities are visible: tags shown, paragraphs tinted.',
    slashHint: 'Type / and an entity key — Tab inserts the choice',
    slashEntityHint: 'Tab to take the entity',
    slashValueHint: 'Tab to take the characteristic, Enter to close the tag',
    slashFieldsHint: 'Format: {fields} · whose — “@Name” at the end',
    duplicatesNote: '{n} colours repeat in the document — as the registry intends.',
    needEditor: 'Open a section to add entities to the text.',
    characteristicsLabel: 'Characteristics:',
    chatPickerButton: 'Entities',
    chatPickerTitle: 'Core entities · {n} types',
    chatPickerHint: 'Click an entity — its tag lands at the cursor in the prompt.',
    chatGroupingTitle: 'Entities in this conversation:',
    chatGroupingEmpty: 'No entities declared in this conversation yet.',
    chatMessageEntities: 'Entities in this reply:',
    // Right-hand entity panel in the chat (owner's brief 23.09.2026, item 5).
    chatPanelTitle: 'Core entities',
    chatPanelToggleOn: 'Tags are on',
    chatPanelToggleOff: 'Show core tags',
    chatPanelToggleHint: 'Show tags in replies and ask the AI to tag its answers',
    chatPanelHintOn:
      'On: tags are visible in replies and the AI adds tags to its answers, so it is clear which entity it is talking about.',
    chatPanelHintOff:
      'Off: tags in replies are hidden and the model does not add them. Picking an entity for your prompt always works.',
    chatPanelPickHint: 'Click an entity — its tag lands at the cursor in your prompt.',
    entityHintLabel: 'Tag meaning',
  },
};
