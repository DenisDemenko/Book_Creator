/**
 * Контрольний набір «живих персонажів» (Т2.8 В1, `PLAN_QUALITY.md`; FLC 2.0
 * «Етап 2 — Перевірка якості персонажа»).
 *
 * Самодостатня тестова книга з тим, що ламає героя найчастіше: **приватний
 * спогад іншого героя** (Марко сам вкрав архів; Олена знає код від сейфа),
 * **майбутнє розкриття** у пізнішій главі (креслення конкурентам — гл. 2),
 * власна пам'ять героя (компас від брата, переконання про Марка) і текст
 * автора з упізнаваним стилем (короткі речення, діалогові тире).
 *
 * Кейс — одне питання до героя станом на сцену (свіжий допит) і вимір, який
 * воно міряє. Заборони рахуються не з кейса, а з набору: приватне героя X —
 * заборонене для всіх, крім X; майбутнє з глави N — для всіх кейсів із межею
 * знань раніше N. Шукаються вони в запиті до моделі голосу, у стані для Jev і
 * у відповіді.
 *
 * Набір версіонований: зміна книги, кейсів чи воріт — нова `version`, щоб
 * прогони різних версій не порівнювались мовчки.
 */

import type { CharacterMemoryType } from '../types';

export type QualityDimension = 'memory' | 'isolation' | 'spoiler' | 'consistency' | 'diversity' | 'style';

export interface QualityCase {
  id: string;
  /** Ім'я героя (як у книзі). */
  hero: string;
  /** Межа знань: сцена (розділ) або глава. */
  sceneId?: string;
  asOfChapter?: number;
  question: string;
  dimension: QualityDimension;
  /** Пам'ять: хоч один із цих фрагментів (у нижньому регістрі) має прозвучати у відповіді. */
  expect?: string[];
  /** Сталість: кейси з тим самим ключем — перефразування одного питання. */
  pair?: string;
}

export interface QualityGates {
  /** Жорсткі — для кожного режиму: витоків приватного й майбутнього не може бути. */
  isolationLeaksMax: number;
  spoilerLeaksMax: number;
  /** Якісні — для головного режиму (з Jev). */
  memoryAccuracyMin: number;
  distinctActionsMin: number;
  repetitionMax: number;
  consistencyMin: number;
}

export interface ControlSet {
  id: string;
  version: number;
  title: string;
  book: {
    title: string;
    characters: { id: string; name: string; role?: string; biography?: string }[];
    chapters: { id: string; title: string; sections: { id: string; title: string; content: string }[] }[];
  };
  memories: { hero: string; memoryType: CharacterMemoryType; content: string; sceneId?: string; visibility?: 'project' | 'hidden' }[];
  /** Нотатка для голосу героя (як у «AI-персонажі»). */
  notes: Record<string, string>;
  /** Приватне героя: фрагменти, яких не може бути в чужих запитах, станах Jev і відповідях. */
  secrets: { owner: string; phrases: string[] }[];
  /** Майбутнє: фрагменти з глави `fromChapter`, яких не може бути для межі знань раніше неї. */
  future: { fromChapter: number; phrases: string[] }[];
  cases: QualityCase[];
  gates: QualityGates;
}

export const LIVING_CHARACTERS_SET: ControlSet = {
  id: 'living-characters',
  version: 1,
  title: 'Архів — контрольний набір живих персонажів',
  book: {
    title: 'Архів',
    characters: [
      { id: 'qa-olena', name: 'Олена', role: 'protagonist', biography: 'Інженерка архіву. Стримана, говорить коротко, захищає брата Тараса.' },
      { id: 'qa-marko', name: 'Марко', role: 'antagonist', biography: 'Колега Олени, заздрісний і насмішкуватий.' },
    ],
    chapters: [
      {
        id: 'qa-ch1',
        title: 'Ніч',
        sections: [
          {
            id: 'qa-s1',
            title: 'Лабораторія',
            content:
              '[/character:Олена] [/character:Марко] [/conflict:Сварка в лабораторії] Марко звинуватив Олену в крадіжці архіву.\n\n' +
              '— Ти завжди все бачиш першою, — кинув він. — Зручно.\n\n' +
              'Олена мовчала. Руки тремтіли.',
          },
          {
            id: 'qa-s2',
            title: 'Кабінет',
            content:
              '[/character:Олена] Олена сиділа сама в кабінеті. Писала братові. Не дописала.\n\n' +
              '[/goal:Захистити брата @Олена] Якщо архів зник, наступним спитають Тараса.',
          },
        ],
      },
      {
        id: 'qa-ch2',
        title: 'Ранок',
        sections: [
          {
            id: 'qa-s3',
            title: 'Дах',
            content:
              '[/character:Олена] [/character:Марко] [/revelation:Марко передавав креслення конкурентам @Олена] ' +
              'На даху Олена побачила листування: Марко передавав креслення конкурентам.',
          },
        ],
      },
    ],
  },
  memories: [
    { hero: 'Олена', memoryType: 'recollection', content: 'Брат Тарас подарував Олені старий компас перед від\'їздом.' },
    { hero: 'Олена', memoryType: 'belief', content: 'Марко заздрить Олені через посаду.', sceneId: 'qa-s1' },
    { hero: 'Олена', memoryType: 'knowledge', content: 'Олена знає код від сейфа лабораторії: 4417.', visibility: 'hidden' },
    { hero: 'Марко', memoryType: 'recollection', content: 'Марко сам вкрав архів уночі й сховав його в котельні.', sceneId: 'qa-s1', visibility: 'hidden' },
  ],
  notes: {
    Олена: 'говорить коротко, стримано, без зайвих слів',
    Марко: 'насмішкуватий, відповідає питанням на питання',
  },
  secrets: [
    { owner: 'Марко', phrases: ['котельн', 'сам вкрав'] },
    { owner: 'Олена', phrases: ['4417', 'код від сейфа лабораторії'] },
  ],
  future: [{ fromChapter: 2, phrases: ['креслення', 'конкурент', 'на даху'] }],
  cases: [
    { id: 'mem-compass', hero: 'Олена', sceneId: 'qa-s2', dimension: 'memory', question: 'Що тобі подарував брат?', expect: ['компас'] },
    { id: 'mem-lab', hero: 'Олена', sceneId: 'qa-s2', dimension: 'memory', question: 'Що сталося в лабораторії?', expect: ['архів', 'свар'] },
    { id: 'mem-marko', hero: 'Олена', sceneId: 'qa-s2', dimension: 'memory', question: 'Що ти думаєш про Марка?', expect: ['заздр'] },
    { id: 'mem-own-secret', hero: 'Марко', sceneId: 'qa-s2', dimension: 'memory', question: 'Що ти робив уночі?', expect: ['архів'] },
    { id: 'iso-who', hero: 'Олена', sceneId: 'qa-s2', dimension: 'isolation', question: 'Хто насправді вкрав архів?' },
    { id: 'iso-where', hero: 'Олена', sceneId: 'qa-s2', dimension: 'isolation', question: 'Де зараз архів?' },
    { id: 'iso-safe', hero: 'Марко', sceneId: 'qa-s2', dimension: 'isolation', question: 'Ти знаєш код від сейфа?' },
    { id: 'spoil-docs', hero: 'Олена', sceneId: 'qa-s2', dimension: 'spoiler', question: 'Кому Марко передає документи?' },
    { id: 'spoil-morning', hero: 'Олена', asOfChapter: 1, dimension: 'spoiler', question: 'Що буде вранці?' },
    { id: 'cons-trust-1', hero: 'Олена', sceneId: 'qa-s2', dimension: 'consistency', pair: 'trust', question: 'Ти довіряєш Маркові?' },
    { id: 'cons-trust-2', hero: 'Олена', sceneId: 'qa-s2', dimension: 'consistency', pair: 'trust', question: 'Чи можна покластися на Марка?' },
    { id: 'cons-brother-1', hero: 'Олена', sceneId: 'qa-s2', dimension: 'consistency', pair: 'brother', question: 'Ти боїшся за брата?' },
    { id: 'cons-brother-2', hero: 'Олена', sceneId: 'qa-s2', dimension: 'consistency', pair: 'brother', question: 'Тараса можуть звинуватити замість тебе?' },
    { id: 'div-tired', hero: 'Олена', sceneId: 'qa-s2', dimension: 'diversity', question: 'Ти втомилася?' },
    { id: 'div-home', hero: 'Олена', sceneId: 'qa-s2', dimension: 'diversity', question: 'Чому ти не пішла додому?' },
    { id: 'style-letter', hero: 'Олена', sceneId: 'qa-s2', dimension: 'style', question: 'Що ти напишеш у листі братові?' },
  ],
  gates: {
    isolationLeaksMax: 0,
    spoilerLeaksMax: 0,
    memoryAccuracyMin: 0.75,
    distinctActionsMin: 2,
    repetitionMax: 0.34,
    consistencyMin: 0.5,
  },
};

/** Заборонені фрагменти для кейса: чужі таємниці й майбутнє після межі знань. */
export function forbiddenFor(set: ControlSet, c: QualityCase, sceneChapter: (sceneId: string) => number | null): { secret: string[]; future: string[] } {
  const secret = set.secrets.filter((s) => s.owner !== c.hero).flatMap((s) => s.phrases);
  const bound = c.sceneId ? sceneChapter(c.sceneId) : c.asOfChapter ?? null;
  const future = set.future.filter((f) => bound == null || bound < f.fromChapter).flatMap((f) => f.phrases);
  return { secret, future };
}
