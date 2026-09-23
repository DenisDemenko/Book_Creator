/**
 * Словник сторінки довідки («Сутності ядра та діалоги героя»).
 *
 * ЧОМУ ОКРЕМИЙ ФАЙЛ І ЧОМУ ТАК БАГАТО РЯДКІВ. Це не підпис до кнопки, а
 * сторінка для новачка: покрокові інструкції, пояснення «де що знайти» і
 * переліки до номерних міток на скріншотах. Такі тексти не можна розкидати по
 * компоненту — інакше переклад англійською стає археологією.
 *
 * БАГАТОРЯДКОВІ ЗНАЧЕННЯ. Перекладач `t()` повертає лише рядки, тому списки
 * (кроки, мітки) записані одним рядком із `\n`, а компонент робить
 * `split('\n')`. Це та сама конвенція, що й у `charactersView.behaviorPatternsHint`.
 *
 * МОВА. Сторінка не «показує дві мови одночасно»: вона йде за перемикачем мови
 * застосунку (як і всі інші екрани), і в шапці сторінки є кнопка перемикання —
 * щоб новачок одразу бачив, як дістатися другої мови.
 */
export const helpGuide = {
  uk: {
    // Кнопка у футері — на КОЖНІЙ сторінці студії
    footerTitle: 'Довідка',
    footerBtn: 'Сутності ядра та діалоги героя',
    footerHint: 'Покроково, зі скріншотами',

    title: 'Довідка: сутності ядра та діалоги героя',
    subtitle:
      'Як позначати текст книги сутностями ядра, як ставити теги й як вставляти готові репліки героїв. Усе — з нуля, з показами «де що знайти».',
    switchLangBtn: 'English version',
    switchLangHint: 'Сторінка йде за мовою застосунку. Кнопка перемикає мову всього інтерфейсу.',
    closeBtn: 'Закрити',
    tocTitle: 'Зміст сторінки',
    screenshotMissing:
      'Скріншот не згенеровано. Він створюється на вашій машині командою `npm run live:help-screens` — вона піднімає тестову студію й робить покадрові знімки панелі героя.',
    numbersLabel: 'Що на скріншоті під номерами',

    // 1. Що це таке
    s1Title: '1. Що таке сутності ядра — у двох словах',
    s1Body:
      'Сутності ядра — це 118 позначок, якими письменник розмічає текст книги: персонаж, емоція, локація, конфлікт, поріг, діалог тощо. Позначка ставиться прямо в текст і має вигляд тега:\n' +
      '[/character:Олена] — «тут діє Олена»,\n' +
      '[/emotion:страх] — «тут емоція страху».\n' +
      'Тег потрібен не для краси: за ним Студія розуміє, про що абзац, показує кольорову підказку при наведенні й підбирає героїв та їхні репліки. Наприкінці видно найважливіше: у файлі готової книги (PDF, DOCX, EPUB, TXT) тегів немає — читач бачить чистий текст.',
    s1NoteTitle: 'Дві речі, які варто затямити одразу',
    s1Notes:
      'Тег завжди в квадратних дужках і починається зі слеша: [/character:Олена]. Зайва пара дужок ламає розмітку.\n' +
      'У книзі ключ записується англійською (character, emotion), а набирати його можна й українською: /персонаж:Олена або /герой:Олена. Студія сама перекладе його в канонічний вигляд.',

    // 2. Панель сутностей
    s2Title: '2. Панель «Сутності» — де що знайти',
    s2Where:
      'Відкрийте розділ «Книга та текст». Праворуч унизу є вкладки розділів: «Сцена», «Книга і текст», «AI», «Сутності». Натисніть останню — панель 118 сутностей з\'явиться праворуч.',
    s2Body:
      'Панель — це ваш довідник і ваш інструмент одночасно. Нею можна поставити тег, не набираючи його руками. Наведіть курсор на будь-який рядок — з\'явиться підказка про сутність: обидві назви, тег, колір, категорію й характеристики з реєстру.',
    s2Marks:
      'Пошук. Наберіть 2–4 літери: «char», «емоц», «діалог». Сутність з\'явиться у списку навіть якщо ви набрали українською.\n' +
      'Групи. 12 категорій від A до I та J1–J3 (додаток «Літературна критика»). Натисніть на заголовок групи, щоб розгорнути її.\n' +
      'Кнопка «Сховати сутності» — та сама оранжево-зелена смуга. Ховає теги з канви ПОВНІСТЮ: лишається тільки текст книги. Сам текст книги при цьому не змінюється ні на символ, а в експорті теги знімаються й так.',
    s2CaptionTop: 'Панель «Сутності»: пошук, групи та приховування',
    s2MarksRows:
      'Рядок сутності: клік по лівій частині додає тег у ПОТОЧНИЙ абзац, кнопка праворуч — у позицію курсора.\n' +
      'Кольорова мітка з цифрою — сутність заявлена в цьому розділі стільки разів.\n' +
      'Лічильник у поточному абзаці: скільки сутностей уже стоїть там, де зараз курсор. Більше 12 на один абзац Студія не дозволить — і це навмисне обмеження.',
    s2CaptionRows: 'Ті самі сутності нижче: додати в абзац або в курсор, лічильники використання',
    s2Caption: 'Панель «Сутності»: пошук, групи, приховування та додавання тега',

    // 3. Теги в канві
    s3Title: '3. Тег руками, у тексті книги (слеш-підбір)',
    s3Body:
      'Тег можна й набрати. Стійте на початку абзацу (або після пробілу — перед слешем не має бути літери, інакше «стор./2:3» теж ставало б тегом) і наберіть слеш із кількома літерами сутності:',
    s3Steps:
      'Наберіть /char — під курсором відкриється список сутностей, які починаються на ці літери. Ходіння — стрілки ↑↓, вибір — Tab або Enter, вихід — Esc.\n' +
      'Натисніть Tab — у тексті з\'явиться /character: і одразу відкриється ДРУГИЙ список: характеристики цієї сутності (ім\'я, роль, біографія…).\n' +
      'Наберіть або виберіть значення й натисніть Tab — тег закриється дужками: [/character:Олена]. Enter на цьому кроці закриє тег без значення: [/character:].',
    s3Tip:
      'Тег може стояти посеред абзацу — це нормально. Але якщо ви позначаєте абзац цілком, ставте його на початок: так його бачить панель і так його читають майбутні правила обробки сутностей.',

    // 4. Діалоги героя
    s4Title: '4. Діалоги героя — покроково',
    s4Body:
      'Найкорисніше для щоденної роботи: у кожного героя можна наперед зібрати його типові репліки, а потім вставляти їх у сцену одним вибором, не набираючи знову.',
    s4StepsTitle: 'Крок 1 — налаштувати репліки героя',
    s4Steps1:
      'Відкрийте «Книгу та текст» і праворуч перейдіть на вкладку «Сцена» (там, де учасники сцени й параметри сцени).\n' +
      'Прокрутіть панель до самого низу — там блок «Діалоги героя».\n' +
      'Натисніть кнопку «Налаштувати діалоги героя». Відкриється вікно зі списком героїв книги.\n' +
      'Виберіть героя чипом угорі, впишіть його репліки — КОЖНА З НОВОГО РЯДКА (можна розділяти знаком «;» або «|»).\n' +
      'Натисніть «Зберегти». Під кнопкою з\'явиться підтвердження, а кількість діалогів — у самого героя та в чипі.',
    s4MarksScene:
      'Блок «Діалоги героя» у вкладці «Сцена» — тут видно підказку про жест і кнопку налаштування.',
    s4MarksModal:
      'Вибір героя: чипи з кількістю вже готових діалогів.\n' +
      'Поле для реплік: один рядок — один діалог.\n' +
      'Лічильник: скільки діалогів ви щойно вписали.\n' +
      '«Зберегти» — записує в книгу (і в історію версій), «Скасувати» — закриває без змін.',
    s4ModalNote:
      'Якщо власних реплік у героя ще немає, під полем буде прямо сказано, що тимчасово використовуються його поведінкові шаблони — список не буде порожнім.',
    s4StepsTitle2: 'Крок 2 — уставити репліку в сцену',
    s4Steps2:
      'У канві станьте туди, де починається репліка (початок абзацу або після пробілу).\n' +
      'Наберіть: /character:Олена:діалог — замість «Олена» впишіть потрібне ім\'я героя. Працюють і /герой:Олена:діалог, і /персонаж:Олена:діалог, і англійське :dialog.\n' +
      'Під курсором відкриється список заголовком «Олена Савицька · Діалоги героя» — це її наперед заготовлені репліки.\n' +
      'Виберіть репліку стрілками й натисніть Tab — набраний запис зникне, а на його місці з\'явиться тег героя, тег діалогу й сам текст репліки.',
    s4ResultTitle: 'Що саме лягає в текст',
    s4Result:
      '[/character:Олена Савицька] [/dialogue:Готовність до синхронізації] — Готовність до синхронізації 98 відсотків, пане архітекторе.',
    s4ResultNote:
      'У канві це виглядає так: два теги пофарбовані своїми кольорами (персонаж — синій, діалог — блакитний), тло абзацу залишається білим, а сама репліка читається як звичайний текст. У готовій книзі лишається тільки речення.',
    s4MarksMenu:
      'Заголовок меню: чий це герой і що зараз вибираємо.\n' +
      'Репліки героя — саме те, що ви вписали у вікні налаштування; перша вже підсвічена, а бейдж /dialogue праворуч показує, ЯКИЙ тег ляже в текст.\n' +
      'Керування: ↑↓ — вибір, Tab — уставити, Esc — закрити; клік мишею теж працює.',
    s4ShortcutTitle: 'Те саме без слеша',
    s4Shortcut:
      'Наведіть курсор на картку героя у вкладці «Сцена» — у поповері, під його поведінковими шаблонами, є блок «Діалоги героя». Клік по репліці вставляє її в текст із тими самими двома тегами.',

    // 5. Експорт
    s5Title: '5. Теги не потрапляють у готову книгу',
    s5Body:
      'Це головне, за що відповідає Студія: теги — службова розмітка письменника, і читач їх не має бачити. Під час експорту в PDF, DOCX, EPUB і TXT теги знімаються автоматично, разом із зайвими пропусками, які вони лишили б по собі. Абзац, який складався лише з тегів, у книгу не потрапляє зовсім — порожнього місця не буде.',

    // 6. Помилки
    s6Title: '6. Три помилки, які трапляються найчастіше',
    s6Items:
      'Подвійні дужки. [[/character:Олена]] — зайва пара дужок лишається в тексті як є, і в надрукованій книзі ви побачите порожні «[]». Правильно: [/character:Олена].\n' +
      'Замість імені — характеристика. [/character:Ім\'я] виглядає правильно, але «Ім\'я» — це характеристика сутності «Персонаж», а не ваш герой. Такий тег не каже, хто говорить. У тег героя треба вписати його ім\'я: [/character:Олена].\n' +
      'Герой не знайдений. У списку діалогів порожньо й написано «Героя з таким ім\'ям у книзі немає». Перевірте, як героя записано в розділі «Персонажі»: збіг має бути точний — «Олена», «Олена Савицька» або його псевдонім.',

    // 7. Чат
    s7Title: '7. Те саме в чаті зі ШІ',
    s7Body:
      'У «AI-асистенті» справа є власна панель сутностей: щоб поставити сутність у своє питання, знайдіть її в панелі й натисніть — тег ляже в поле вводу. Тумблер «показати теги ядра» вмикає показ тегів у репліках, і той самий режим просить ШІ позначати сутності у відповіді. Групування над історією показує, про які сутності йшлося в розмові й скільки разів.',

    // 8. Питання
    s8Title: '8. Якщо щось не виходить',
    s8Body:
      'Кнопка «Приховати сутності» нічого не зіпсувала: текст книги не змінюється, кольори тільки ховаються. Якщо тег виглядає як звичайний текст — перевірте, що він у квадратних дужках і починається зі слеша: [/character:Олена]. Якщо герой не має діалогів — їх треба один раз вписати кнопкою «Налаштувати діалоги героя».',
  },

  en: {
    footerTitle: 'Help',
    footerBtn: 'Core entities and character dialogues',
    footerHint: 'Step by step, with screenshots',

    title: 'Help: core entities and character dialogues',
    subtitle:
      'How to mark your manuscript with core entities, how to place tags, and how to insert ready-made character lines. Everything from scratch, showing you where to look.',
    switchLangBtn: 'Українська версія',
    switchLangHint: 'This page follows the app language. The button switches the whole interface language.',
    closeBtn: 'Close',
    tocTitle: 'On this page',
    screenshotMissing:
      'The screenshot has not been generated. It is produced on your machine by `npm run live:help-screens`, which boots a test studio and captures the hero panel frame by frame.',
    numbersLabel: 'What the numbers on the screenshot mean',

    s1Title: '1. What core entities are, in two words',
    s1Body:
      'Core entities are 118 markers a writer uses to label the manuscript: character, emotion, location, conflict, threshold, dialogue and so on. A marker is placed right in the text and looks like a tag:\n' +
      '[/character:Olena] — “Olena acts here”,\n' +
      '[/emotion:fear] — “the emotion here is fear”.\n' +
      'A tag is not decoration: it is how Studio understands what a paragraph is about, shows a colour hint on hover, and finds characters and their lines. The most important part comes at the end: the finished book file (PDF, DOCX, EPUB, TXT) contains no tags at all — the reader gets clean text.',
    s1NoteTitle: 'Two things worth remembering right away',
    s1Notes:
      'A tag is always in square brackets and starts with a slash: [/character:Olena]. An extra pair of brackets breaks the markup.\n' +
      'In the book the key is written in English (character, emotion), but you may type it in Ukrainian too: /персонаж:Олена or /герой:Олена. Studio converts it to the canonical form for you.',

    s2Title: '2. The “Entities” panel — where to find what',
    s2Where:
      'Open the “Book and text” section. At the bottom right there are panel tabs: “Scene”, “Book and text”, “AI”, “Entities”. Click the last one and the panel of 118 entities appears on the right.',
    s2Body:
      'The panel is both your reference book and your tool: you can place a tag without typing it by hand. Hover any row to see the tooltip: both names, the tag, the colour, the category and the characteristics from the registry.',
    s2Marks:
      'Search. Type 2–4 letters: “char”, “emot”, “dialogue”. The entity appears even if you typed in Ukrainian.\n' +
      'Groups. 12 categories from A to I plus J1–J3 (the “Literary critic” appendix). Click a group header to expand it.\n' +
      'The “Hide entities” button — the orange-to-green bar. It removes the tags from the canvas ENTIRELY: only the book text remains. The manuscript itself is not changed by a single character, and tags are stripped on export anyway.',
    s2CaptionTop: 'The “Entities” panel: search, groups and hiding',
    s2MarksRows:
      'An entity row: clicking its left side adds the tag to the CURRENT paragraph, the button on the right adds it at the caret.\n' +
      'The coloured badge with a number — how many times the entity is declared in this section.\n' +
      'The counter of the current paragraph: how many entities the paragraph already holds. Studio will not allow more than 12 per paragraph — that limit is intentional.',
    s2CaptionRows: 'The same entities lower down: add to paragraph or caret, and the usage counters',
    s2Caption: 'The “Entities” panel: search, groups, hiding and adding a tag',

    s3Title: '3. Typing a tag in the text (slash picker)',
    s3Body:
      'You can also type a tag. Put the caret at the start of the paragraph (or after a space — the character before the slash must not be a letter, otherwise “p. /2:3” would become a tag too) and type a slash with a few letters of the entity:',
    s3Steps:
      'Type /char — a list of matching entities opens at the caret. Move with ↑↓, pick with Tab or Enter, close with Esc.\n' +
      'Press Tab — the text gets /character: and a SECOND list opens immediately: the characteristics of that entity (name, role, biography…).\n' +
      'Type or pick a value and press Tab — the tag closes with brackets: [/character:Olena]. Enter at this step closes the tag without a value: [/character:].',
    s3Tip:
      'A tag may sit inside a paragraph — that is fine. But when you label the whole paragraph, put it at the start: that is how the panel sees it and how the upcoming entity rules will read it.',

    s4Title: '4. Character dialogues — step by step',
    s4Body:
      'The most useful part for daily work: you can collect a character’s typical lines in advance and then insert them into a scene with a single pick.',
    s4StepsTitle: 'Step 1 — set up the character’s lines',
    s4Steps1:
      'Open “Book and text” and switch the right panel to the “Scene” tab (where scene participants and scene settings live).\n' +
      'Scroll the panel to the very bottom — there is the “Character dialogues” block.\n' +
      'Press “Set up character dialogues”. A window with the book’s characters opens.\n' +
      'Pick a character with the chips at the top and type the lines — ONE PER LINE (you may also separate them with “;” or “|”).\n' +
      'Press “Save”. A confirmation appears under the button, and the count shows up on the character and on the chip.',
    s4MarksScene:
      'The “Character dialogues” block on the “Scene” tab — the hint about the slash entry and the setup button live here.',
    s4MarksModal:
      'Character picker: chips with the number of lines already saved.\n' +
      'The lines field: one dialogue per line.\n' +
      'The counter: how many lines you have just typed.\n' +
      '“Save” writes into the book (and its version history), “Cancel” closes without changes.',
    s4ModalNote:
      'If the character has no custom lines yet, the note under the field says that the behaviour patterns are used meanwhile — the list is never empty.',
    s4StepsTitle2: 'Step 2 — insert a line into the scene',
    s4Steps2:
      'In the canvas, place the caret where the line starts (paragraph start or after a space).\n' +
      'Type: /character:Olena:dialog — replace “Olena” with your character’s name. /герой:Олена:діалог and /персонаж:Олена:діалог work as well.\n' +
      'A list opens at the caret headed “Olena Savytska · Character dialogues” — those are the lines you prepared.\n' +
      'Pick a line with the arrows and press Tab — what you typed disappears and the character tag, the dialogue tag and the line itself take its place.',
    s4ResultTitle: 'What exactly lands in the text',
    s4Result:
      '[/character:Olena Savytska] [/dialogue:Synchronisation readiness] — Synchronisation readiness is 98 percent, architect.',
    s4ResultNote:
      'In the canvas the two tags are coloured (character — blue, dialogue — cyan), the paragraph background stays white, and the line reads as ordinary text. In the finished book only the sentence remains.',
    s4MarksMenu:
      'The menu header: which character it is and what you are picking.\n' +
      'The character’s lines — exactly what you typed in the setup window; the first one is highlighted, and the /dialogue badge shows WHICH tag will land in the text.\n' +
      'Controls: ↑↓ to move, Tab to insert, Esc to close; the mouse works too.',
    s4ShortcutTitle: 'The same without the slash',
    s4Shortcut:
      'Hover a character card on the “Scene” tab — in the popover, under the behaviour patterns, there is a “Character dialogues” block. Clicking a line inserts it with the same two tags.',

    s5Title: '5. Tags never reach the finished book',
    s5Body:
      'This is the core promise: tags are the writer’s service markup, and the reader must not see them. On export to PDF, DOCX, EPUB and TXT the tags are removed automatically, together with the extra whitespace they would leave behind. A paragraph that consisted of tags only is dropped entirely — no empty spot is left.',

    s6Title: '6. The three most common mistakes',
    s6Items:
      'Double brackets. [[/character:Olena]] — the extra pair stays in the text and the printed book shows empty “[]”. Correct: [/character:Olena].\n' +
      'A characteristic instead of a name. [/character:Ім\'я] looks right, but “Ім\'я” (name) is a characteristic of the “Character” entity, not your hero. Such a tag does not say who speaks. Put the hero’s name in it: [/character:Olena].\n' +
      'Character not found. The dialogue list is empty and says no character with that name exists. Check how the character is written in the “Characters” section: the match must be exact — “Olena”, “Olena Savytska”, or the alias.',

    s7Title: '7. The same inside the AI chat',
    s7Body:
      'The “AI assistant” has its own entity panel on the right: find an entity in it and click to place the tag into your question. The “show core tags” toggle displays tags in the messages, and the same mode asks the AI to mark entities in its answer. The grouping block above the history shows which entities the conversation touched and how many times.',

    s8Title: '8. If something does not work',
    s8Body:
      'The “Hide entities” button breaks nothing: the manuscript text is untouched, only the colours are hidden. If a tag looks like plain text, check that it is in square brackets and starts with a slash: [/character:Olena]. If a character has no dialogues, type them once via “Set up character dialogues”.',
  },
};
