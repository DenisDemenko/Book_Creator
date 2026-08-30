import type { HeroArcState } from '../types';

/**
 * Статичний зміст «Кривої головного героя»: 13 кроків конструктора шляху
 * героя (мономіф Кемпбелла) і 14 точок емоційної кривої, що їм
 * відповідають. Навмисно окремо від HeroArcState (types.ts) — книга
 * зберігає лише ВІДПОВІДІ й ІНТЕНСИВНОСТІ, а самі питання й дефолтна форма
 * кривої належать коду, не даним (той самий поділ, що й FRAMEWORKS/STEPS
 * у ExpressWizardView.tsx).
 *
 * Джерело — та сама структура, що й у скілі `hero-journey`; тут навмисно
 * НЕМАЄ вкладки «Підсумок» (копіювання запиту для AI-наставника, експорт
 * файлу, скидання) — за прямою вказівкою в ТЗ вона тут не потрібна: книга
 * й так живе в студії, «наставник» — це вже сам AI-асистент редактора.
 */
export interface HeroArcStep {
  id: string;
  title: string;
  question: string;
  placeholder: string;
  /** Індекси точок емоційної кривої (BEATS), яким відповідає цей крок. */
  beats: number[];
}

export interface HeroArcBeat {
  title: string;
  emotion: string;
  /** Дефолтна інтенсивність -10..10 — те, з чого стартує повзунок. */
  value: number;
  /** Фаза шляху: 0 — вихід, 1 — ініціація, 2 — повернення. */
  phase: 0 | 1 | 2;
}

export const HERO_ARC_STEPS: HeroArcStep[] = [
  { id: 's1', title: 'Старий герой', question: 'Хто він зараз? Який характер, обставини, звичне життя?', placeholder: 'Наприклад: чим займається, з ким живе, що для нього звичайний день…', beats: [0] },
  { id: 's2', title: 'Внутрішня проблема', question: 'Що заважає йому жити? Яка незадоволеність чи конфлікт уже приховані в звичному світі?', placeholder: 'Наприклад: відчуває, що живе не своє життя, боїться визнати це навіть собі…', beats: [0] },
  { id: 's3', title: 'Поклик', question: 'Що змушує його залишити старий світ?', placeholder: 'Подія, лист, зустріч, втрата, правда, небезпека…', beats: [1] },
  { id: 's4', title: 'Страх', question: 'Чому він не хоче йти? Який внутрішній опір змінам?', placeholder: '«Я не готовий», «це не для мене», «тут безпечно»…', beats: [2] },
  { id: 's5', title: 'Наставник', question: 'Хто або що допомагає йому зробити перший крок?', placeholder: 'Людина, символ, знання, інструмент, новий погляд…', beats: [3] },
  { id: 's6', title: 'Поріг', question: 'Коли повернення назад стає неможливим?', placeholder: 'Момент, після якого старе життя вже недоступне…', beats: [4] },
  { id: 's7', title: 'Випробування', question: 'Що руйнує старого героя? З якими перешкодами й власними страхами він стикається?', placeholder: 'Кожне випробування показує: старий спосіб життя більше не працює…', beats: [5, 6, 7] },
  { id: 's8', title: 'Найглибша криза', question: 'Що повинно «померти» в ньому? (не обов’язково фізично)', placeholder: 'Він може програти, втратити близьку людину, побачити свою темну сторону…', beats: [8, 9] },
  { id: 's9', title: 'Трансформація', question: 'Що він усвідомлює після найважчого моменту?', placeholder: 'Нове розуміння себе, можливе лише після «смерті» старого «я»…', beats: [10] },
  { id: 's10', title: 'Дар', question: 'Що він отримує? Знання, силу, мудрість, предмет, любов, нову ідентичність?', placeholder: 'Найважливіше — нове розуміння себе, а не просто трофей…', beats: [10] },
  { id: 's11', title: 'Повернення', question: 'Як він повертається у звичайний світ, який лишився старим, поки герой змінився?', placeholder: 'Опір поверненню, шлях назад, потреба жити по-новому серед старого…', beats: [11, 12] },
  { id: 's12', title: 'Новий герой', question: 'Ким він став? Чим цей герой відрізняється від того, з ким ми почали в кроці 1?', placeholder: 'Порівняйте прямо зі своєю відповіддю на перший крок…', beats: [13] },
  { id: 's13', title: 'Дар для світу', question: 'Що змінилося для інших завдяки його подорожі?', placeholder: 'Знання, порятунок, новий спосіб життя, приклад для інших…', beats: [13] },
];

export const HERO_ARC_BEATS: HeroArcBeat[] = [
  { title: 'Звичайний світ', emotion: 'спокій, буденність, стабільність', value: 0, phase: 0 },
  { title: 'Поклик до пригоди', emotion: 'цікавість, передчуття, хвилювання', value: 2, phase: 0 },
  { title: 'Відмова від поклику', emotion: 'сумнів, страх, невпевненість', value: -2, phase: 0 },
  { title: 'Зустріч із наставником', emotion: 'надія, довіра, натхнення', value: 3, phase: 0 },
  { title: 'Перетин першого порогу', emotion: 'рішучість, страх невідомого', value: 1, phase: 0 },
  { title: 'Випробування', emotion: 'напруга, боротьба, складнощі', value: 4, phase: 1 },
  { title: 'Зустріч із найглибшим бажанням', emotion: 'радість, натхнення, відчуття сенсу', value: 6, phase: 1 },
  { title: 'Спокуса', emotion: 'сумнів, внутрішній конфлікт', value: 2, phase: 1 },
  { title: 'Найголовніше випробування', emotion: 'відчай, страх, відчуття безвиході', value: -5, phase: 1 },
  { title: 'Символічна смерть', emotion: 'біль, страждання, повне руйнування', value: -9, phase: 1 },
  { title: 'Нагорода', emotion: 'полегшення, радість, нове усвідомлення', value: -2, phase: 2 },
  { title: 'Шлях назад', emotion: 'невпевненість, страх втратити досягнуте', value: -1, phase: 2 },
  { title: 'Останнє випробування', emotion: 'напруга, останній бій, рішучість', value: 3, phase: 2 },
  { title: 'Повернення з еліксиром', emotion: 'радість, спокій, гармонія, вдячність', value: 8, phase: 2 },
];

export const HERO_ARC_PHASE_LABELS = ['Вихід', 'Ініціація', 'Повернення'];

export function defaultHeroArcState(): HeroArcState {
  return { answers: {}, intensities: HERO_ARC_BEATS.map((b) => b.value) };
}

/** Заповнює прогалини (нові точки/кроки після оновлення коду) значеннями за замовчуванням. */
export function normalizeHeroArcState(state: HeroArcState | undefined): HeroArcState {
  const base = defaultHeroArcState();
  if (!state) return base;
  const intensities = base.intensities.map((v, i) =>
    typeof state.intensities?.[i] === 'number' ? state.intensities[i] : v
  );
  return { answers: { ...state.answers }, intensities };
}

/** Скільки з 13 кроків уже мають непорожню відповідь. */
export function heroArcProgress(state: HeroArcState | undefined): number {
  if (!state) return 0;
  return HERO_ARC_STEPS.reduce((n, s) => n + ((state.answers[s.id] || '').trim() ? 1 : 0), 0);
}

/** Плавна крива Катмулла-Рома через усі точки — той самий алгоритм, що й у скілі hero-journey. */
export function catmullRomPath(points: Array<[number, number]>): string {
  if (points.length < 2) return '';
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)} `;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)} `;
  }
  return d;
}

function mixColor(c1: string, c2: string, k: number): string {
  const h = (c: string) => {
    const clean = c.replace('#', '');
    return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
  };
  const a = h(c1);
  const b = h(c2);
  const r = Math.round(a[0] + (b[0] - a[0]) * k);
  const g = Math.round(a[1] + (b[1] - a[1]) * k);
  const bl = Math.round(a[2] + (b[2] - a[2]) * k);
  return `rgb(${r},${g},${bl})`;
}

/** Колір точки за її валентністю: червоний (-10) → бурштиновий (0) → зелений (+10). */
export function valenceColor(v: number): string {
  const t = Math.max(-10, Math.min(10, v));
  if (t <= 0) return mixColor('#f43f5e', '#f59e0b', (t + 10) / 10);
  return mixColor('#f59e0b', '#34d399', t / 10);
}
