/**
 * WDI — вимірювання розвитку письменника. Фундамент: дерево навичок,
 * модель доказів (evidence) і обчислення балів.
 *
 * Походження: макет власника «AI Mentor v7 · Adaptive Mastery Engine»
 * (`public/mentor/index.html`, запис #155). Сюда перенесено те, чого в
 * продукті не було, але **не** перенесено локальну симуляцію: докази тут
 * народжуються з реальної роботи автора в застосунку, а не з regex у
 * браузері.
 *
 * ДВА РІВНІ, а не дві паралельні системи (рішення власника, #155).
 * У продукті вже є десять КАТЕГОРІЙ шляху автора — від «Мислення» до
 * «Автор та розвиток» (`src/data/skillsData.ts`, 1823 рядки
 * `MasteryView.tsx`, XP і streak). У макеті — десять ІНШИХ компетенцій,
 * усі про текст. Це не дві версії одного: категорії покривають весь шлях
 * від ідеї до маркетингу, а WDI дрібніше розкладає лише письмо. Тому
 * категорії лишаються верхнім рівнем, а компетенції WDI стають
 * вимірюваним шаром під текстовими з них. Три категорії — «Підготовка
 * книги», «Візуальна майстерність», «Автор та розвиток» — WDI-бала не
 * мають СВІДОМО: WDI міряє письмо, а не верстку й маркетинг, і вдавати
 * тут число означало б брехати.
 *
 * ЧОМУ EVIDENCE — ДЖЕРЕЛО ПРАВДИ, А БАЛИ — ПРОЄКЦІЯ.
 * У макеті `skillScores` — змінне поле: подія його зсуває й зникає. Тут
 * навпаки: журнал доказів доповнюється й ніколи не переписується, а бал
 * ЩОРАЗУ згортається з журналу. Ціна — трохи обчислень; виграш у тому,
 * що будь-яке число можна показати разом із подіями, які його дали, і
 * автор бачить не вердикт, а підставу. Саме цього вимагає принцип, який
 * власник і поклав у основу: **сама лише порада ШІ рейтинг не підвищує**.
 */

/** Десять категорій верхнього рівня — ті самі id, що в `skillsData.ts`. */
export type SkillCategoryId =
  | 'thinking' | 'concept' | 'plot' | 'characters' | 'craft'
  | 'emotion' | 'editing' | 'book_prep' | 'visual' | 'author_brand';

/** Вимірювані компетенції WDI. */
export type WdiSkillId =
  | 'story_architecture' | 'character_craft' | 'scene_craft'
  | 'language_style' | 'dialogue_subtext' | 'pov_narration'
  | 'emotion_reader_impact' | 'world_continuity'
  | 'revision_mastery' | 'writer_development';

export interface WdiSkillMeta {
  id: WdiSkillId;
  labelUk: string;
  /** Під якою категорією верхнього рівня показувати. `null` — мета-рівень. */
  category: SkillCategoryId | null;
}

/**
 * Дерево. Прив'язка кожної компетенції виведена з `subSkills` категорій у
 * `skillsData.ts`, а не з подібності назв: «Майстерність письма» має в
 * під-навичках і сцени, і діалоги, і описи, і авторський голос — тому їй
 * відповідають ЧОТИРИ компетенції, а не одна.
 */
export const WDI_SKILLS: WdiSkillMeta[] = [
  { id: 'story_architecture',    labelUk: 'Архітектура історії',   category: 'plot' },
  { id: 'character_craft',       labelUk: 'Робота з персонажем',   category: 'characters' },
  { id: 'scene_craft',           labelUk: 'Побудова сцени',        category: 'craft' },
  { id: 'language_style',        labelUk: 'Мова і стиль',          category: 'craft' },
  { id: 'dialogue_subtext',      labelUk: 'Діалог і підтекст',     category: 'craft' },
  { id: 'pov_narration',         labelUk: 'POV і наратив',         category: 'craft' },
  { id: 'emotion_reader_impact', labelUk: 'Емоційний вплив',       category: 'emotion' },
  { id: 'world_continuity',      labelUk: 'Світ і послідовність',  category: 'editing' },
  { id: 'revision_mastery',      labelUk: 'Майстерність редактури', category: 'editing' },
  // Не належить жодній категорії: це і є наявний XP/streak автора —
  // міст між двома рівнями, а не одинадцята навичка.
  { id: 'writer_development',    labelUk: 'Розвиток автора',       category: null },
];

export const WDI_SKILL_IDS: WdiSkillId[] = WDI_SKILLS.map((s) => s.id);

/** Категорії, які свідомо лишаються без WDI-бала. */
export const CATEGORIES_WITHOUT_WDI: SkillCategoryId[] = [
  'thinking', 'concept', 'book_prep', 'visual', 'author_brand',
];

export function skillsForCategory(cat: SkillCategoryId): WdiSkillMeta[] {
  return WDI_SKILLS.filter((s) => s.category === cat);
}

/**
 * Типи доказів — за силою, і порядок тут не випадковий.
 *
 * Найслабший доказ — що текст проаналізовано; найсильніший — що автор
 * САМ переніс навичку в новий контекст. Вага кожного типу задана нижче
 * (`EVIDENCE_WEIGHT`) і саме вона втілює принцип власника: порада ШІ
 * взагалі не є доказом і в журнал не пишеться.
 */
export type EvidenceType =
  | 'TEXT_ANALYSIS'    // сцену проаналізовано, сигнали зафіксовані
  | 'KNOWLEDGE_TEST'   // відповідь у тесті знань
  | 'PRACTICAL_TASK'   // практичне завдання з оцінкою
  | 'REVISION_LOOP'    // автор виправив, повторна перевірка підтвердила
  | 'VERIFIED_GROWTH'  // покращення підтверджене на новому тексті
  | 'TRANSFER';        // навичка застосована в іншому контексті без підказки

/**
 * Максимальний зсув бала за одну подію кожного типу.
 *
 * Числа підібрані так, щоб порядок сили був видний у самій моделі:
 * аналіз тексту майже нічого не важить (він лише спостереження),
 * revision loop важить у чотири рази більше, а transfer — найбільше.
 */
export const EVIDENCE_WEIGHT: Record<EvidenceType, number> = {
  TEXT_ANALYSIS: 0.5,
  KNOWLEDGE_TEST: 0.8,
  PRACTICAL_TASK: 1.2,
  REVISION_LOOP: 2.0,
  VERIFIED_GROWTH: 2.5,
  TRANSFER: 3.0,
};

export interface EvidenceEvent {
  id: string;
  userId: string;
  bookId: string | null;
  skill: WdiSkillId;
  type: EvidenceType;
  /** −1…+1: наскільки подія свідчить ЗА чи ПРОТИ навички. */
  outcome: number;
  /** 0…1: наскільки ми впевнені в самому спостереженні. */
  confidence: number;
  /**
   * 0…100: наскільки це зробив автор САМ. Правка за прямою вказівкою ШІ —
   * низька незалежність; знайдена й виправлена самостійно — висока.
   */
  independence: number;
  summary: string;
  /**
   * Ключ ідемпотентності. Без нього повторний аналіз того самого тексту
   * накручував би бал — саме тому в макеті й з'явився `seenTextHashes`.
   * Тут це робить база: UNIQUE(user_id, source_id).
   */
  sourceId: string;
  createdAt: string;
}

export const BASE_SCORE = 50;

export interface SkillProjection {
  skill: WdiSkillId;
  /** 0…100, згорнуто з журналу доказів. */
  score: number;
  /** 0…100: наскільки бал заслужений, а не вгаданий. */
  confidence: number;
  /** 0…100: середня незалежність у доказах цієї навички. */
  independence: number;
  events: number;
  positive: number;
  negative: number;
  transfers: number;
}

/**
 * Згортає журнал доказів у бал навички.
 *
 * Свідомо БЕЗ згасання за часом на цьому етапі: щоб його вводити, треба
 * спершу побачити реальні дані за кілька місяців, інакше константа
 * напіврозпаду буде вигадана. Тут лишається чесна проста модель, і це
 * записано, щоб наступна сесія не вважала це недоглядом.
 */
export function projectSkill(skill: WdiSkillId, events: EvidenceEvent[]): SkillProjection {
  const mine = events.filter((e) => e.skill === skill);
  let score = BASE_SCORE;
  let indSum = 0;
  let confAccum = 0;
  let positive = 0;
  let negative = 0;
  let transfers = 0;

  for (const e of mine) {
    const weight = EVIDENCE_WEIGHT[e.type] ?? 0.5;
    // Зсув = сила типу × напрям × впевненість у спостереженні.
    score += weight * clamp(e.outcome, -1, 1) * clamp(e.confidence, 0, 1);
    indSum += clamp(e.independence, 0, 100);
    // Впевненість у балі росте від кількості та якості доказів, але
    // насичується: сто аналізів тексту не дають тієї ж певності, що
    // десять revision loop.
    confAccum += weight * clamp(e.confidence, 0, 1);
    if (e.outcome > 0) positive += 1;
    if (e.outcome < 0) negative += 1;
    if (e.type === 'TRANSFER' && e.outcome > 0) transfers += 1;
  }

  return {
    skill,
    score: Math.round(clamp(score, 0, 100)),
    // 12 одиниць накопиченої ваги ≈ повна впевненість. Взято так, щоб
    // шість revision loop або десять практичних давали майже 100%.
    confidence: Math.round(clamp((confAccum / 12) * 100, 0, 100)),
    independence: mine.length ? Math.round(indSum / mine.length) : 0,
    events: mine.length,
    positive,
    negative,
    transfers,
  };
}

export function projectAll(events: EvidenceEvent[]): Record<WdiSkillId, SkillProjection> {
  const out = {} as Record<WdiSkillId, SkillProjection>;
  for (const id of WDI_SKILL_IDS) out[id] = projectSkill(id, events);
  return out;
}

/** WDI 1000 — сума десяти компетенцій по 100. */
export function wdiScore(proj: Record<WdiSkillId, SkillProjection>): number {
  return WDI_SKILL_IDS.reduce((a, id) => a + (proj[id]?.score ?? BASE_SCORE), 0);
}

export function wdiLevelUk(score: number): string {
  if (score < 200) return 'Фундамент';
  if (score < 350) return 'Початківець';
  if (score < 500) return 'Автор, що зростає';
  if (score < 650) return 'Впевнений автор';
  if (score < 750) return 'Досвідчений автор';
  if (score < 850) return 'Сильний автор';
  if (score < 930) return 'Майстер ремесла';
  return 'Майстерність';
}

/**
 * Наскільки взагалі можна вірити загальному балу.
 *
 * Окремо від `confidence` кожної навички: тут ідеться про те, чи
 * достатньо даних про автора в цілому. Поки доказів мало, інтерфейс має
 * казати «недостатньо даних», а не показувати число з трьох цифр.
 */
export type WdiStatus = 'INSUFFICIENT_DATA' | 'PROVISIONAL' | 'STABLE' | 'HIGH_CONFIDENCE';

export function wdiStatus(events: EvidenceEvent[]): WdiStatus {
  const strong = events.filter((e) =>
    e.type === 'REVISION_LOOP' || e.type === 'VERIFIED_GROWTH' || e.type === 'TRANSFER'
  ).length;
  const covered = new Set(events.map((e) => e.skill)).size;
  if (events.length < 8 || covered < 3) return 'INSUFFICIENT_DATA';
  if (strong < 3 || covered < 5) return 'PROVISIONAL';
  if (strong < 10 || covered < 8) return 'STABLE';
  return 'HIGH_CONFIDENCE';
}

/** Стан опанування навички. Порядок = зростання. */
export type MasteryState =
  | 'UNOBSERVED' | 'INTRODUCED' | 'PRACTICING'
  | 'DEVELOPING' | 'RELIABLE' | 'TRANSFERRED' | 'MASTERED';

export const MASTERY_ORDER: MasteryState[] = [
  'UNOBSERVED', 'INTRODUCED', 'PRACTICING', 'DEVELOPING', 'RELIABLE', 'TRANSFERRED', 'MASTERED',
];

/**
 * Стан виводиться з проєкції, а не зберігається окремо.
 *
 * У макеті стан лежав у `mastery[skill].state` і оновлювався вручну —
 * через це демо-кнопки й revision loop спершу його НЕ рухали (правки №2
 * і №3 власника). Якщо стан виводити, розсинхронізуватися нічому.
 */
export function masteryFor(p: SkillProjection): MasteryState {
  if (p.events === 0) return 'UNOBSERVED';
  if (p.transfers >= 2 && p.score >= 82 && p.confidence >= 80 && p.independence >= 75) return 'MASTERED';
  if (p.transfers >= 1 && p.score >= 72 && p.confidence >= 70) return 'TRANSFERRED';
  if (p.score >= 70 && p.confidence >= 65 && p.independence >= 60) return 'RELIABLE';
  if (p.score >= 60 && p.confidence >= 55 && p.positive >= 4) return 'DEVELOPING';
  if (p.score >= 45 && p.positive >= 2) return 'PRACTICING';
  return 'INTRODUCED';
}

/**
 * Навичка з найбільшим потенціалом росту — куди вести автора далі.
 *
 * ВАЖЛИВО: лише серед НАМІРЯНИХ навичок. Перша версія сортувала всі
 * десять і через доданок упевненості віддавала перевагу навичці, про яку
 * невідомо НІЧОГО (нуль доказів, впевненість 0), перед тією, де вже є
 * підтверджений негативний доказ. Тест це зловив, і він мав рацію: «куди
 * вести автора» — це підтверджена слабкість, а не незнання. Незміряні
 * навички треба ПРОМІРЯТИ (`nextToProbe`), і це інше питання.
 *
 * Якщо не намірено жодної — віддаємо будь-яку, бо вести все одно треба.
 */
export function weakestSkill(proj: Record<WdiSkillId, SkillProjection>): WdiSkillId {
  const measured = WDI_SKILL_IDS.filter((id) => proj[id]?.events > 0);
  const pool = measured.length ? measured : [...WDI_SKILL_IDS];
  return pool.sort((a, b) => {
    const pa = proj[a], pb = proj[b];
    // Серед намірених низький бал важить найбільше, низька впевненість —
    // трохи менше: слабкість, підтверджену слабко, варто ще перевірити.
    const ra = (100 - pa.score) + (100 - pa.confidence) * 0.35;
    const rb = (100 - pb.score) + (100 - pb.confidence) * 0.35;
    return rb - ra;
  })[0];
}

/**
 * Що промірити наступним — навичка, про яку найменше відомо.
 *
 * Окремо від `weakestSkill` саме тому, що це інше питання: тут ідеться не
 * «де автор слабкий», а «де ми не маємо права нічого стверджувати». Це
 * вхід для адаптивного тесту, а не для порад у редакторі.
 */
export function nextToProbe(proj: Record<WdiSkillId, SkillProjection>): WdiSkillId {
  return [...WDI_SKILL_IDS].sort((a, b) => {
    const pa = proj[a], pb = proj[b];
    // Спершу ті, де доказів менше; за рівної кількості — де нижча впевненість.
    return (pa.events - pb.events) || (pa.confidence - pb.confidence);
  })[0];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

/** Проблеми, які вже знаходить AI-коуч → компетенція, про яку вони свідчать. */
export const COACH_PROBLEM_TO_SKILL: Record<string, WdiSkillId> = {
  goal: 'scene_craft',
  conflict: 'story_architecture',
  stakes: 'story_architecture',
  choice: 'scene_craft',
  emotional_change: 'emotion_reader_impact',
  pov: 'pov_narration',
  rhythm: 'language_style',
  sensory: 'language_style',
  intent: 'emotion_reader_impact',
  dialogue: 'dialogue_subtext',
  continuity: 'world_continuity',
  arc: 'character_craft',
};
