import { CompetenceMarkerType } from '../types';

/**
 * Каталог «навичка → текстові маркери» (завдання 3 хвилі 1).
 *
 * Це навмисно **дані, а не текст у промпті**: усі фічі — підсвітка
 * компетентностей, показники глави, звіти «до/після» — беруть критерії
 * звідси. Інакше кожна фіча вигадувала б власне визначення «конфлікту»
 * і оцінки між екранами не сходилися б.
 *
 * `id` тут — ключ у `skillScores` та `SkillSnapshot.scores`.
 */

export interface SkillMarkerSpec {
  /** Ключ показника. Не змінювати після першого зрізу — зламає порівняння. */
  id: string;
  titleUk: string;
  titleEn: string;
  /** Що змінюється в тексті, коли навичка розвинена. */
  textChange: string;
  /** Як це відчуває читач — формулювання від першої особи. */
  readerPerception: string;
  /** Що саме AI шукає в тексті як доказ навички. */
  looksFor: string[];
  /** Типи маркерів, які підсвічуються для цієї навички. */
  markerTypes: CompetenceMarkerType[];
  /** Для яких книг має сенс: художня, нон-фікшн або обидві. */
  scope: 'fiction' | 'nonfiction' | 'both';
}

export const SKILL_MARKERS: SkillMarkerSpec[] = [
  {
    id: 'idea',
    titleUk: 'Ідея',
    titleEn: 'Idea',
    textChange: 'чіткіша центральна думка',
    readerPerception: 'Я розумію, про що ця книга',
    looksFor: [
      'одна наскрізна думка, повторена в різних главах',
      'формулювання, що відповідає логлайну книги',
      'відсутність конкуруючих головних тем',
    ],
    markerTypes: ['thesis'],
    scope: 'both',
  },
  {
    id: 'structure',
    titleUk: 'Структура',
    titleEn: 'Structure',
    textChange: 'логічна послідовність',
    readerPerception: 'Мене ведуть від одного до іншого',
    looksFor: [
      'кожна глава виконує власну функцію',
      'перехід між главами має причину',
      'немає двох глав з однаковою функцією',
    ],
    markerTypes: ['plot_turn', 'thesis'],
    scope: 'both',
  },
  {
    id: 'composition',
    titleUk: 'Композиція',
    titleEn: 'Composition',
    textChange: 'правильне розташування інформації',
    readerPerception: 'Мені цікаво читати далі',
    looksFor: [
      'інформація подається дозовано',
      'відкрите питання наприкінці фрагмента',
      'ключове відкриття не витрачене зарано',
    ],
    markerTypes: ['plot_turn'],
    scope: 'both',
  },
  {
    id: 'conflict',
    titleUk: 'Конфлікт',
    titleEn: 'Conflict',
    textChange: 'протилежні цілі та перешкоди',
    readerPerception: 'Хочу знати, що станеться',
    looksFor: [
      'дві сторони з несумісними цілями',
      'перешкода, яку не можна обійти',
      'ціна помилки названа',
    ],
    markerTypes: ['conflict'],
    scope: 'fiction',
  },
  {
    id: 'characters',
    titleUk: 'Персонажі',
    titleEn: 'Characters',
    textChange: 'мотиви, бажання, страхи',
    readerPerception: 'Я розумію цього героя',
    looksFor: [
      'бажання героя видно з його дій, а не з пояснення автора',
      'страх, який керує рішенням',
      'рішення, що змінює героя',
    ],
    markerTypes: ['conflict', 'emotional_peak'],
    scope: 'fiction',
  },
  {
    id: 'dialogue',
    titleUk: 'Діалог',
    titleEn: 'Dialogue',
    textChange: 'підтекст, цілі, голос',
    readerPerception: 'Люди справді розмовляють',
    looksFor: [
      'репліка має мету, а не лише повідомляє факт',
      'герой чогось не договорює',
      'голоси персонажів відрізняються',
      'діалог рухає сюжет',
    ],
    markerTypes: ['conflict'],
    scope: 'fiction',
  },
  {
    id: 'scene',
    titleUk: 'Сцена',
    titleEn: 'Scene',
    textChange: 'мета → перешкода → зміна',
    readerPerception: 'Сцена має сенс',
    looksFor: [
      'герой заходить у сцену з метою',
      'мета наштовхується на перешкоду',
      'наприкінці щось змінилося',
    ],
    markerTypes: ['conflict', 'plot_turn'],
    scope: 'fiction',
  },
  {
    id: 'description',
    titleUk: 'Опис',
    titleEn: 'Description',
    textChange: 'конкретні деталі',
    readerPerception: 'Я бачу і відчуваю ситуацію',
    looksFor: [
      'конкретні предмети замість абстракцій',
      'задіяно більше ніж зір',
      'деталь працює на настрій, а не просто присутня',
    ],
    markerTypes: ['description'],
    scope: 'both',
  },
  {
    id: 'style',
    titleUk: 'Стиль',
    titleEn: 'Style',
    textChange: 'послідовний авторський голос',
    readerPerception: 'У тексту є характер',
    looksFor: [
      'упізнаваний ритм речень',
      'сталий регістр лексики',
      'відсутність випадкових стрибків тону',
    ],
    markerTypes: ['description'],
    scope: 'both',
  },
  {
    id: 'pace',
    titleUk: 'Темп',
    titleEn: 'Pace',
    textChange: 'чергування напруги та спокою',
    readerPerception: 'Текст не провисає',
    looksFor: [
      'коротші речення в напружених місцях',
      'пауза після сильної сцени',
      'немає довгої рівної ділянки без подій',
    ],
    markerTypes: ['emotional_peak', 'plot_turn'],
    scope: 'both',
  },
  {
    id: 'argumentation',
    titleUk: 'Аргументація',
    titleEn: 'Argumentation',
    textChange: 'теза → доказ → висновок',
    readerPerception: 'Я можу повірити автору',
    looksFor: [
      'теза сформульована явно',
      'до тези є доказ',
      'з доказу зроблено висновок',
    ],
    markerTypes: ['thesis', 'argument'],
    scope: 'nonfiction',
  },
  {
    id: 'research',
    titleUk: 'Дослідження',
    titleEn: 'Research',
    textChange: 'факти та джерела',
    readerPerception: 'Автор знає тему',
    looksFor: [
      'конкретні числа й дати',
      'вказане джерело твердження',
      'згадані альтернативні погляди',
    ],
    markerTypes: ['argument'],
    scope: 'nonfiction',
  },
  {
    id: 'expertise',
    titleUk: 'Експертність',
    titleEn: 'Expertise',
    textChange: 'власні моделі та висновки',
    readerPerception: 'Автор дає мені нове',
    looksFor: [
      'власне поняття або назва явища',
      'власна класифікація чи модель',
      'висновок, якого немає в джерелах',
    ],
    markerTypes: ['thesis', 'argument'],
    scope: 'nonfiction',
  },
  {
    id: 'pedagogy',
    titleUk: 'Педагогіка',
    titleEn: 'Pedagogy',
    textChange: 'пояснення → приклад → практика',
    readerPerception: 'Я навчився',
    looksFor: [
      'принцип пояснено простими словами',
      'є приклад застосування',
      'є завдання для читача',
    ],
    markerTypes: ['example'],
    scope: 'nonfiction',
  },
  {
    id: 'editing',
    titleUk: 'Редагування',
    titleEn: 'Editing',
    textChange: 'менше шуму, більше точності',
    readerPerception: 'Текст легко читається',
    looksFor: [
      'немає слів, які можна прибрати без втрати',
      'немає повторів однакового кореня поруч',
      'дієслова замість віддієслівних іменників',
    ],
    markerTypes: ['description'],
    scope: 'both',
  },
  {
    id: 'emotion',
    titleUk: 'Емоційність',
    titleEn: 'Emotional impact',
    textChange: 'емоційна динаміка',
    readerPerception: 'Текст на мене впливає',
    looksFor: [
      'емоція показана через дію чи тіло, а не названа',
      'зміна емоційного стану всередині фрагмента',
      'є момент найвищої напруги',
    ],
    markerTypes: ['emotional_peak'],
    scope: 'both',
  },
  {
    id: 'symbolism',
    titleUk: 'Символіка',
    titleEn: 'Symbolism',
    textChange: 'повторювані смислові образи',
    readerPerception: 'У тексті є глибина',
    looksFor: [
      'образ повторюється в різних главах',
      'образ змінює значення по ходу книги',
      'предмет пов’язаний з темою книги',
    ],
    markerTypes: ['description'],
    scope: 'fiction',
  },
  {
    id: 'logic',
    titleUk: 'Логіка',
    titleEn: 'Logic',
    textChange: 'причинно-наслідкові звʼязки',
    readerPerception: 'Я розумію, чому це відбувається',
    looksFor: [
      'кожна подія має причину в попередній',
      'немає стрибків, які нічим не пояснені',
      'рішення героя випливає з його мотиву',
    ],
    markerTypes: ['argument', 'plot_turn'],
    scope: 'both',
  },
  {
    id: 'originality',
    titleUk: 'Оригінальність',
    titleEn: 'Originality',
    textChange: 'несподівані звʼязки та авторські рішення',
    readerPerception: 'Цього я раніше не бачив',
    looksFor: [
      'несподіване, але вмотивоване рішення',
      'незвичне порівняння',
      'відхід від жанрового шаблону',
    ],
    markerTypes: ['plot_turn'],
    scope: 'both',
  },
  {
    id: 'completeness',
    titleUk: 'Завершеність',
    titleEn: 'Completeness',
    textChange: 'закриття основних питань',
    readerPerception: 'Книга дає відчуття завершеності',
    looksFor: [
      'питання, поставлене на початку, отримало відповідь',
      'лінії героїв доведені до рішення',
      'фінал перегукується з початком',
    ],
    markerTypes: ['thesis', 'plot_turn'],
    scope: 'both',
  },
];

/** Швидкий доступ за ключем показника. */
export const SKILL_MARKER_BY_ID: Record<string, SkillMarkerSpec> = Object.fromEntries(
  SKILL_MARKERS.map((s) => [s.id, s])
);

/** Кольори та підписи типів маркерів — спільні для підсвітки й легенди. */
export const MARKER_STYLE: Record<
  CompetenceMarkerType,
  { emoji: string; labelUk: string; labelEn: string; color: string }
> = {
  thesis: { emoji: '🟦', labelUk: 'Теза', labelEn: 'Thesis', color: '#60a5fa' },
  argument: { emoji: '🟩', labelUk: 'Аргумент', labelEn: 'Argument', color: '#34d399' },
  example: { emoji: '🟨', labelUk: 'Приклад', labelEn: 'Example', color: '#fbbf24' },
  conflict: { emoji: '🟥', labelUk: 'Конфлікт', labelEn: 'Conflict', color: '#f87171' },
  emotional_peak: { emoji: '🟪', labelUk: 'Емоційна кульмінація', labelEn: 'Emotional peak', color: '#a78bfa' },
  plot_turn: { emoji: '🟧', labelUk: 'Поворот сюжету', labelEn: 'Plot turn', color: '#fb923c' },
  description: { emoji: '⬜', labelUk: 'Опис', labelEn: 'Description', color: '#cbd5e1' },
};
