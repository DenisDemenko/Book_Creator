/**
 * Розкладання розпізнаного тексту на курс, інструкцію чи книгу БЕЗ ШІ (журнал #550).
 *
 * Локальний шлях приватності не має хмарної моделі, яка б «розклала» текст на модулі й кроки, тож це роблять правила:
 * заголовки («Розділ 2», «Модуль», НАПИСАНЕ ВЕЛИКИМИ, «1.1 …»), нумеровані кроки («1.», «Крок 3»), іменовані розділи
 * («Комплектація», «Увага», «Результати навчання»). Результат — ЧЕРНЕТКА для перевірки: правила помиляються, і автор
 * правит її в звичайному редакторі. Нічого не вигадується: кожен рядок результату — з розпізнаного тексту.
 *
 * Модуль чистий (без Node і React): його викликає браузер Studio, перевіряє scripts/test-localScanStructure.mts.
 */

export type LocalScanKind = 'course' | 'instruction' | 'manuscript';

export interface ScanPageText {
  order: number;
  text: string;
}

export interface LocalScanInput {
  kind: LocalScanKind;
  title?: string;
  instructionMode?: 'assembly' | 'operation' | null;
  modelCode?: string;
  craft?: string;
  audience?: string;
  pages: ScanPageText[];
}

export interface LocalLesson {
  title: string;
  body: string;
  topics: string[];
}
export interface LocalModule {
  title: string;
  summary: string;
  lessons: LocalLesson[];
}
export interface LocalCourse {
  title: string;
  summary: string;
  outcomes: string[];
  audience: string[];
  modules: LocalModule[];
}
export interface LocalStep {
  title: string;
  description: string;
  warning: string;
}
export interface LocalMaterial {
  code: string;
  name: string;
  qty: string;
}
export interface LocalInstruction {
  title: string;
  description: string;
  modelCode: string;
  materials: LocalMaterial[];
  tools: string[];
  warnings: string[];
  steps: LocalStep[];
  finalChecks: string[];
}
export interface LocalChapter {
  title: string;
  sections: { title: string; content: string }[];
}
export interface LocalBook {
  title: string;
  chapters: LocalChapter[];
}

export interface LocalStructureResult {
  kind: LocalScanKind;
  course?: LocalCourse;
  instruction?: LocalInstruction;
  book?: LocalBook;
  /** Чи знайшлася структура в самому тексті: false — розкладено за сторінками чи абзацами, потрібна ручна правка. */
  structured: boolean;
  /** Що саме правила знайшли: заголовків, кроків, абзаців — для екрана перевірки. */
  stats: { headings: number; steps: number; paragraphs: number; characters: number };
  /** Пояснення автору, де правила не впевнені. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Нормалізація тексту
// ---------------------------------------------------------------------------

const PAGE_NUMBER_LINE = /^[\s\-–—.·•]*\d{1,4}[\s\-–—.·•]*$/;
const ROMAN_HEADING = '[\\dIVXLCivxlc]+';

/** Прибирає «шапки й підвали» (рядок, що повторюється на 3+ сторінках), номери сторінок, переноси, «--». */
export function normalizePages(pages: ScanPageText[]): string[] {
  const ordered = [...pages].sort((a, b) => a.order - b.order);
  const lineCount = new Map<string, number>();
  const split = ordered.map((p) => String(p.text || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/g, '')));
  for (const lines of split) {
    const seen = new Set<string>();
    for (const l of lines) {
      const key = l.trim().toLowerCase();
      if (key.length >= 4 && key.length <= 80 && !seen.has(key)) {
        seen.add(key);
        lineCount.set(key, (lineCount.get(key) || 0) + 1);
      }
    }
  }
  const repeated = new Set([...lineCount].filter(([, n]) => ordered.length >= 4 && n >= 3 && n / ordered.length >= 0.6).map(([k]) => k));
  return split.map((lines) => {
    const kept = lines.filter((l) => !PAGE_NUMBER_LINE.test(l) && !repeated.has(l.trim().toLowerCase()));
    return kept
      .join('\n')
      .replace(/(\p{L})[-­]\n(\p{Ll})/gu, '$1$2')
      .replace(/ -- /g, ' — ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });
}

// ---------------------------------------------------------------------------
// Блоки
// ---------------------------------------------------------------------------

type Block =
  | { type: 'heading'; level: number; text: string; weak?: boolean }
  | { type: 'step'; number: number; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'para'; text: string; lines?: string[] };

const LEVEL1_WORDS = '(?:Розділ|Глава|Частина|Модуль|Блок)';
const LEVEL2_WORDS = '(?:Тема|Урок|Заняття|Лекція|Практика|Практичне завдання)';
const RE_LEVEL1 = new RegExp(`^${LEVEL1_WORDS}\\s+${ROMAN_HEADING}\\s*[.:)\\-–—]?\\s*(.*)$`, 'iu');
const RE_LEVEL2 = new RegExp(`^${LEVEL2_WORDS}\\s+${ROMAN_HEADING}\\s*[.:)\\-–—]?\\s*(.*)$`, 'iu');
const RE_STEP_WORD = /^(?:Крок|Етап|Step)\s*(\d{1,3})\s*[.:)\-–—]?\s*(.*)$/iu;
const RE_STEP_NUM = /^(\d{1,3})\s*[.)]\s+(\S.*)$/u;
const RE_DOTTED = /^(\d{1,2}(?:\.\d{1,2}){1,3})\.?\s+(\S.{1,90})$/u;
const RE_BULLET = /^[-–—•·*▪●]\s+(\S.*)$/u;
const RE_WARNING = /^(Увага|Попередження|Застереження|Важливо|Небезпечно|Обережно|Примітка)\s*[!:.\-–—]\s*(.*)$/iu;

/** Розділи з відомою роллю (анотація, комплектація, перевірка…): навіть окремий короткий рядок — це заголовок. */
const NAMED_HEADING = /^(Результати навчання|Чого (?:ви )?навчитесь|Чого навчимось|Мета курсу|Для кого|Аудиторія|Кому підійде|Кому цей курс|Анотація|Опис курсу|Про курс|Вступ до курсу|Про що курс|Комплектація|Що входить|Склад|Комплект|Інструменти|Що знадобиться|Необхідні інструменти|Безпека|Заходи безпеки|Кроки|Порядок (?:складання|роботи|користування)|Послідовність|Перевірка|Контроль|Фінальна перевірка|Підсумкова перевірка)\s*[:.]?$/iu;

const isUpperHeading = (line: string): boolean => {
  const letters = line.match(/\p{L}/gu) || [];
  if (letters.length < 4 || line.length > 90) return false;
  const upper = line.match(/\p{Lu}/gu) || [];
  return upper.length / letters.length >= 0.85 && !/[.,;]$/.test(line);
};

function parseBlocks(pages: string[], kind: LocalScanKind): Block[] {
  const text = pages.join('\n\n');
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ type: 'para', text: para.join(' ').replace(/\s{2,}/g, ' ').trim(), lines: [...para] });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const prevBlank = i === 0 || !lines[i - 1].trim();
    const nextBlank = i === lines.length - 1 || !lines[i + 1].trim();
    let m: RegExpExecArray | null;
    if ((m = RE_LEVEL1.exec(line))) {
      flush();
      blocks.push({ type: 'heading', level: 1, text: cleanHeading(line) });
      continue;
    }
    if ((m = RE_LEVEL2.exec(line))) {
      flush();
      blocks.push({ type: 'heading', level: 2, text: cleanHeading(line) });
      continue;
    }
    if ((m = RE_STEP_WORD.exec(line))) {
      flush();
      blocks.push({ type: 'step', number: Number(m[1]), text: (m[2] || '').trim() });
      continue;
    }
    if ((m = RE_DOTTED.exec(line)) && kind !== 'instruction' && prevBlank) {
      flush();
      blocks.push({ type: 'heading', level: Math.min(3, m[1].split('.').length), text: `${m[1]} ${m[2]}`.trim() });
      continue;
    }
    if ((m = RE_STEP_NUM.exec(line))) {
      // Нумерований рядок: у курсі й книзі короткий окремий рядок — це заголовок, довгий — пункт; в інструкції — крок.
      const body = m[2].trim();
      if (kind !== 'instruction' && prevBlank && nextBlank && body.length <= 70 && !/[.;,]$/.test(body)) {
        flush();
        blocks.push({ type: 'heading', level: 1, text: `${m[1]}. ${body}` });
        continue;
      }
      flush();
      blocks.push({ type: 'step', number: Number(m[1]), text: body });
      continue;
    }
    if ((m = RE_BULLET.exec(line))) {
      flush();
      blocks.push({ type: 'bullet', text: m[1].trim() });
      continue;
    }
    if (prevBlank && nextBlank && isUpperHeading(line)) {
      flush();
      blocks.push({ type: 'heading', level: 1, text: titleCase(line) });
      continue;
    }
    // Іменований розділ — рядок цілком («Результати навчання»): OCR часто губить порожні рядки навколо нього, тож сусідів не перевіряємо.
    if (NAMED_HEADING.test(line)) {
      flush();
      blocks.push({ type: 'heading', level: 2, text: line.replace(/[:.]\s*$/u, '') });
      continue;
    }
    // Слабкий заголовок: короткий окремий рядок без розділових знаків (лише якщо сильних заголовків не буде — див. нижче).
    if (prevBlank && nextBlank && line.length >= 4 && line.length <= 60 && !/[.,;:!?]$/.test(line) && line.split(/\s+/).length <= 8 && !/^\d/.test(line)) {
      flush();
      blocks.push({ type: 'heading', level: 2, text: line, weak: true });
      continue;
    }
    // Рядок, що продовжує попередній пункт (крок чи маркер): дописуємо до нього, а не до нового абзацу
    const last = blocks[blocks.length - 1];
    if (!para.length && last && (last.type === 'step' || last.type === 'bullet') && !prevBlank) {
      last.text = `${last.text} ${line}`.trim();
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

function cleanHeading(line: string): string {
  return line.replace(/\s+/g, ' ').replace(/[:.\s]+$/g, '').trim();
}

function titleCase(upper: string): string {
  const lower = upper.toLocaleLowerCase('uk-UA');
  return lower.charAt(0).toLocaleUpperCase('uk-UA') + lower.slice(1);
}

/** Якщо сильних заголовків немає, слабкі лишаємо; якщо є — слабкі повертаємо в абзаци (щоб не нашаткувати текст). */
function resolveWeakHeadings(blocks: Block[]): { blocks: Block[]; strong: number; weak: number } {
  const strong = blocks.filter((b) => b.type === 'heading' && !b.weak).length;
  const weak = blocks.filter((b) => b.type === 'heading' && b.weak).length;
  if (strong > 0 || weak > 12) {
    return { blocks: blocks.map((b) => (b.type === 'heading' && b.weak ? ({ type: 'para', text: b.text } as Block) : b)), strong, weak: 0 };
  }
  return { blocks, strong: 0, weak };
}

const textOf = (blocks: Block[]): string =>
  blocks
    .map((b) => (b.type === 'bullet' ? `• ${b.text}` : b.type === 'step' ? `${b.number}. ${b.text}` : b.type === 'heading' ? b.text : b.text))
    .join('\n\n')
    .trim();

const firstSentence = (text: string, max = 80): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  const m = /^(.{8,}?[.!?:;])(\s|$)/u.exec(clean);
  const cut = m && m[1].length <= max ? m[1].replace(/[.:;]$/g, '') : clean.length <= max ? clean : `${clean.slice(0, max).replace(/\s+\S*$/u, '')}…`;
  return cut.trim();
};

// ---------------------------------------------------------------------------
// Курс
// ---------------------------------------------------------------------------

const OUTCOME_HEAD = /^(Результати навчання|Чого (?:ви )?навчитесь|Чого навчимось|Мета курсу|Мета|Цілі|Після курсу)/iu;
const AUDIENCE_HEAD = /^(Для кого|Аудиторія|Кому підійде|Кому цей курс)/iu;
const SUMMARY_HEAD = /^(Анотація|Опис курсу|Про курс|Вступ до курсу|Про що курс)/iu;

function buildCourse(input: LocalScanInput, blocks: Block[], weakCount: number): { course: LocalCourse; structured: boolean; notes: string[] } {
  const notes: string[] = [];
  const course: LocalCourse = { title: '', summary: '', outcomes: [], audience: [], modules: [] };
  const items = [...blocks];
  // назва: задана; або перший рядок документа, якщо це заголовок/короткий абзац над усім іншим
  let i = 0;
  const first = items[0];
  if (input.title?.trim()) course.title = input.title.trim().slice(0, 160);
  else if (first && (first.type === 'heading' || (first.type === 'para' && first.text.length <= 100))) {
    course.title = first.text.replace(/^(Курс|Тренінг)\s*[:«"]?\s*/iu, '').replace(/[»"]$/u, '').trim().slice(0, 160);
    i = 1;
  }
  if (!course.title) course.title = 'Курс із документа';

  const named: Record<string, Block[]> = {};
  let currentModule: LocalModule | null = null;
  let currentLesson: LocalLesson | null = null;
  let preface: string[] = [];
  let namedKey: string | null = null;
  let moduleLead: string[] = [];

  const closeLesson = () => {
    if (currentLesson) {
      currentLesson.body = currentLesson.body.trim();
      if (currentModule) currentModule.lessons.push(currentLesson);
    }
    currentLesson = null;
  };
  const closeModule = () => {
    closeLesson();
    if (currentModule) {
      if (moduleLead.length) {
        const lead = moduleLead.join('\n\n').trim();
        if (currentModule.lessons.length === 0) currentModule.lessons.push({ title: currentModule.title, body: lead, topics: [] });
        else if (lead.length > 250) currentModule.lessons.unshift({ title: 'Вступ', body: lead, topics: [] });
        else currentModule.summary = lead;
      }
      course.modules.push(currentModule);
    }
    currentModule = null;
    moduleLead = [];
  };
  const ensureModule = (title: string) => {
    if (!currentModule) currentModule = { title, summary: '', lessons: [] };
    return currentModule;
  };

  for (; i < items.length; i++) {
    const b = items[i];
    if (b.type === 'heading') {
      const key = OUTCOME_HEAD.test(b.text) ? 'outcomes' : AUDIENCE_HEAD.test(b.text) ? 'audience' : SUMMARY_HEAD.test(b.text) ? 'summary' : null;
      if (key) {
        closeModule();
        namedKey = key;
        named[key] = named[key] || [];
        continue;
      }
      namedKey = null;
      if (b.level === 1 || (b.level >= 2 && !currentModule)) {
        closeModule();
        currentModule = { title: b.text, summary: '', lessons: [] };
        if (b.level >= 2) {
          // урок без модуля: збираємо у спільний модуль
          currentModule.title = course.title;
          currentLesson = { title: b.text, body: '', topics: [] };
        }
        continue;
      }
      closeLesson();
      currentLesson = { title: b.text, body: '', topics: [] };
      continue;
    }
    if (namedKey) {
      named[namedKey].push(b);
      continue;
    }
    const piece = b.type === 'bullet' ? `• ${b.text}` : b.type === 'step' ? `${b.number}. ${b.text}` : b.text;
    if (currentLesson) {
      currentLesson.body += (currentLesson.body ? '\n\n' : '') + piece;
      if (b.type === 'bullet' && currentLesson.topics.length < 8) currentLesson.topics.push(b.text.slice(0, 120));
    } else if (currentModule) moduleLead.push(piece);
    else preface.push(piece);
  }
  closeModule();

  if (named.outcomes) course.outcomes = named.outcomes.flatMap((b) => (b.type === 'bullet' || b.type === 'step' ? [b.text] : b.type === 'para' ? b.text.split(/(?<=[.;])\s+/u) : [])).map((s) => s.replace(/[.;]$/u, '').trim()).filter(Boolean).slice(0, 12);
  if (named.audience) course.audience = named.audience.flatMap((b) => (b.type === 'bullet' ? [b.text] : b.type === 'para' ? b.text.split(/[;,]\s*/u) : [])).map((s) => s.replace(/\.$/u, '').trim()).filter(Boolean).slice(0, 8);
  if (named.summary) course.summary = named.summary.map((b) => ('text' in b ? b.text : '')).join(' ').trim().slice(0, 600);
  if (!course.summary && preface.length) course.summary = preface.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600);

  let structured = course.modules.length > 0;
  if (!structured) {
    // Заголовків не знайдено: уроки за сторінками, по п'ять у модулі.
    const lessons = (input.pages.length ? [...input.pages].sort((a, b) => a.order - b.order) : []).map((p, n) => ({ title: `Сторінка ${n + 1}`, body: p.text.trim(), topics: [] as string[] })).filter((l) => l.body);
    for (let k = 0; k < lessons.length; k += 5) course.modules.push({ title: `Частина ${Math.floor(k / 5) + 1}`, summary: '', lessons: lessons.slice(k, k + 5) });
    notes.push('Заголовків у тексті не знайдено: уроки розкладено за сторінками. Перейменуйте їх у редакторі курсу.');
  } else if (weakCount > 0) {
    notes.push('Окремі короткі рядки прийнято за заголовки: перевірте назви модулів і уроків.');
  }
  if (structured && course.modules.every((m) => m.lessons.length === 0)) structured = false;
  return { course, structured, notes };
}

// ---------------------------------------------------------------------------
// Інструкція
// ---------------------------------------------------------------------------

const KIT_HEAD = /^(Комплектація|Що входить(?: у комплект)?|Склад(?: набору)?|Комплект)/iu;
const TOOLS_HEAD = /^(Інструменти|Що знадобиться|Необхідні інструменти|Для роботи потрібно)/iu;
const SAFETY_HEAD = /^(Безпека|Заходи безпеки|Попередження|Застереження|Увага)/iu;
const STEPS_HEAD = /^(Кроки|Порядок (?:складання|роботи|користування)|Складання|Інструкція|Послідовність)/iu;
const CHECK_HEAD = /^(Перевірка|Контроль|Фінальна перевірка|Підсумкова перевірка)/iu;

function parseMaterial(line: string): LocalMaterial {
  const clean = line.replace(/^[-–—•·*▪●]\s*/u, '').trim();
  const code = /^([A-ZА-ЯІЇЄҐ]{1,2})[.)]\s+(.+)$/u.exec(clean);
  const rest = code ? code[2] : clean;
  const qty = /(?:[—–-]\s*|x\s*|×\s*|\s)(\d{1,4})\s*(шт\.?|штук|комплект(?:ів)?|пар[иа]?|м|мм|см|кг)?\s*$/iu.exec(rest);
  const name = qty ? rest.slice(0, qty.index).replace(/[—–\-:,\s]+$/u, '').trim() : rest;
  return { code: code ? code[1] : '', name: name.slice(0, 160), qty: qty ? `${qty[1]}${qty[2] ? ' ' + qty[2].replace(/\.$/, '') : ''}` : '1' };
}

function listLines(blocks: Block[], splitCommas = false): string[] {
  return blocks
    .flatMap((b) => {
      if (b.type === 'bullet' || b.type === 'step') return [b.text];
      if (b.type !== 'para') return [];
      const lines = b.lines && b.lines.length > 1 ? b.lines : [b.text];
      return lines.flatMap((l) => l.split(splitCommas ? /;\s+|,\s+/u : /;\s+/u));
    })
    .map((s) => s.trim().replace(/[.;]$/u, ''))
    .filter(Boolean);
}

function buildInstruction(input: LocalScanInput, blocks: Block[]): { instruction: LocalInstruction; structured: boolean; notes: string[]; steps: number } {
  const notes: string[] = [];
  const ins: LocalInstruction = { title: '', description: '', modelCode: (input.modelCode || '').trim().slice(0, 120), materials: [], tools: [], warnings: [], steps: [], finalChecks: [] };
  let i = 0;
  if (input.title?.trim()) ins.title = input.title.trim().slice(0, 160);
  else if (blocks[0] && (blocks[0].type === 'heading' || (blocks[0].type === 'para' && blocks[0].text.length <= 120))) {
    ins.title = blocks[0].text.slice(0, 160);
    i = 1;
  }
  if (!ins.title) ins.title = 'Інструкція з документа';

  const sections: { key: string; blocks: Block[] }[] = [{ key: 'preface', blocks: [] }];
  // «Комплектація: …» окремим рядком — розділ лише на цей абзац (і маркери одразу після нього), далі текст іде звичайним потоком.
  let inline: { key: string; blocks: Block[] } | null = null;
  for (; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'heading') {
      inline = null;
      const key = KIT_HEAD.test(b.text) ? 'kit' : TOOLS_HEAD.test(b.text) ? 'tools' : SAFETY_HEAD.test(b.text) ? 'safety' : CHECK_HEAD.test(b.text) ? 'checks' : STEPS_HEAD.test(b.text) ? 'steps' : 'other';
      sections.push({ key, blocks: [] });
      continue;
    }
    if (inline && b.type === 'bullet') {
      inline.blocks.push(b);
      continue;
    }
    if (b.type === 'para') {
      const m = /^(Комплектація|Що знадобиться|Інструменти|Перевірка)\s*:\s*(.*)$/iu.exec(b.text);
      if (m) {
        const key = KIT_HEAD.test(m[1]) ? 'kit' : TOOLS_HEAD.test(m[1]) ? 'tools' : 'checks';
        const restLines = (b.lines ?? [b.text]).map((l, idx) => (idx === 0 ? l.replace(/^[^:]*:\s*/u, '') : l)).filter((l) => l.trim());
        inline = { key, blocks: restLines.length ? [{ type: 'para', text: restLines.join(' '), lines: restLines }] : [] };
        sections.push(inline);
        sections.push({ key: 'flow', blocks: [] });
        continue;
      }
    }
    inline = null;
    sections[sections.length - 1].blocks.push(b);
  }

  const stepBlocks: Block[] = [];
  const preface: string[] = [];
  for (const sec of sections) {
    if (sec.key === 'kit') ins.materials.push(...listLines(sec.blocks).map(parseMaterial).filter((m) => m.name));
    else if (sec.key === 'tools') ins.tools.push(...listLines(sec.blocks, true));
    else if (sec.key === 'safety') ins.warnings.push(...listLines(sec.blocks));
    else if (sec.key === 'checks') ins.finalChecks.push(...listLines(sec.blocks));
    else if (sec.key === 'preface' || sec.key === 'flow') {
      for (const b of sec.blocks) {
        if (b.type === 'para') {
          const w = RE_WARNING.exec(b.text);
          if (w) ins.warnings.push(`${w[1]}: ${w[2]}`.replace(/:\s*$/u, ''));
          else preface.push(b.text);
        } else if (b.type === 'step') stepBlocks.push(b);
        else if (b.type === 'bullet') preface.push(b.text);
      }
    } else stepBlocks.push(...sec.blocks);
  }

  let current: LocalStep | null = null;
  const pushStep = (text: string) => {
    let t = text.replace(/\s+/g, ' ').trim();
    if (!t) return;
    let warning = '';
    const inline = /(?:^|[.!?]\s+)((?:Увага|Попередження|Застереження|Важливо|Небезпечно|Обережно)\s*[!:].*)$/iu.exec(t);
    if (inline && inline.index + (inline[0].length - inline[1].length) > 0) {
      warning = inline[1].replace(/\s*[!:]\s*/u, ': ').trim();
      t = t.slice(0, inline.index + (inline[0].length - inline[1].length)).trim();
    }
    const title = firstSentence(t);
    const description = t.length > title.length + 3 ? t.slice(title.length).replace(/^[\s.:;…]+/u, '').trim() : '';
    current = { title, description, warning };
    ins.steps.push(current);
  };
  let steps = 0;
  for (const b of stepBlocks) {
    if (b.type === 'step') {
      steps += 1;
      pushStep(b.text);
    } else if (b.type === 'para') {
      const w = RE_WARNING.exec(b.text);
      if (w && current) (current as LocalStep).warning = `${w[1]}: ${w[2]}`.replace(/:\s*$/u, '');
      else if (w) ins.warnings.push(`${w[1]}: ${w[2]}`.replace(/:\s*$/u, ''));
      else if (current) (current as LocalStep).description = `${(current as LocalStep).description} ${b.text}`.trim();
      else preface.push(b.text);
    } else if (b.type === 'bullet' && current) (current as LocalStep).description = `${(current as LocalStep).description} • ${b.text}`.trim();
  }
  ins.description = preface.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600);

  let structured = steps > 0;
  if (!steps) {
    // Нумерованих кроків немає: кожен абзац — крок.
    const paras = stepBlocks.filter((b): b is Extract<Block, { type: 'para' }> => b.type === 'para');
    ins.steps = [];
    for (const p of paras) pushStep(p.text);
    if (!ins.steps.length && preface.length) {
      for (const p of preface) pushStep(p);
      ins.description = '';
    }
    notes.push('Нумерованих кроків у тексті не знайдено: кожен абзац став кроком. Перевірте порядок і назви кроків.');
    structured = false;
  }
  if (!ins.materials.length && !ins.tools.length) notes.push('Розділів «Комплектація» й «Інструменти» в тексті не знайдено: заповніть їх вручну.');
  return { instruction: ins, structured, notes, steps };
}

// ---------------------------------------------------------------------------
// Книга (рукопис)
// ---------------------------------------------------------------------------

function buildBook(input: LocalScanInput, allBlocks: Block[], weakCount: number): { book: LocalBook; structured: boolean; notes: string[] } {
  const notes: string[] = [];
  let blocks = allBlocks;
  const book: LocalBook = { title: input.title?.trim().slice(0, 160) || '', chapters: [] };
  let chapter: LocalChapter | null = null;
  let section: { title: string; content: string } | null = null;
  const closeSection = () => {
    if (section && section.content.trim()) {
      section.content = section.content.trim();
      (chapter ?? (chapter = { title: 'Розділ 1', sections: [] })).sections.push(section);
    }
    section = null;
  };
  const closeChapter = () => {
    closeSection();
    if (chapter && chapter.sections.length) book.chapters.push(chapter);
    chapter = null;
  };
  let started = false;
  const lead = blocks[0];
  if (!book.title && lead && lead.type === 'para' && lead.text.length <= 100 && !/[.!?]$/u.test(lead.text) && blocks.some((b) => b.type === 'heading')) {
    book.title = lead.text;
    blocks = blocks.slice(1);
  }
  for (const b of blocks) {
    if (b.type === 'heading') {
      if (!started && !book.title) {
        book.title = b.text;
        started = true;
        continue;
      }
      started = true;
      if (b.level === 1) {
        closeChapter();
        chapter = { title: b.text, sections: [] };
        section = { title: b.text, content: '' };
      } else {
        closeSection();
        section = { title: b.text, content: '' };
      }
      continue;
    }
    started = true;
    const piece = b.type === 'bullet' ? `• ${b.text}` : b.type === 'step' ? `${b.number}. ${b.text}` : b.text;
    if (!section) section = { title: 'Початок', content: '' };
    section.content += (section.content ? '\n\n' : '') + piece;
  }
  closeChapter();
  const structured = book.chapters.length > 1 || book.chapters.some((c) => c.sections.length > 1);
  if (!book.chapters.length) {
    const all = textOf(blocks);
    book.chapters.push({ title: 'Розділ 1', sections: [{ title: 'Розділ 1', content: all }] });
  }
  if (!book.title) book.title = 'Книга з рукопису';
  if (!structured) notes.push('Заголовків розділів у тексті не знайдено: увесь текст лежить в одному розділі. Розбийте його в редакторі книги.');
  else if (weakCount > 0) notes.push('Окремі короткі рядки прийнято за заголовки: перевірте розбиття на розділи.');
  return { book, structured, notes };
}

// ---------------------------------------------------------------------------
// Вхід
// ---------------------------------------------------------------------------

export function structureLocally(input: LocalScanInput): LocalStructureResult {
  const pages = normalizePages(input.pages);
  const raw = parseBlocks(pages, input.kind);
  const { blocks, strong, weak } = resolveWeakHeadings(raw);
  const stats = {
    headings: blocks.filter((b) => b.type === 'heading').length,
    steps: blocks.filter((b) => b.type === 'step').length,
    paragraphs: blocks.filter((b) => b.type === 'para').length,
    characters: pages.reduce((n, p) => n + p.length, 0),
  };
  void strong;
  if (!stats.characters) {
    return { kind: input.kind, structured: false, stats, notes: ['Розпізнаного тексту немає: спершу розпізнайте сторінки.'] };
  }
  if (input.kind === 'course') {
    const r = buildCourse(input, blocks, weak);
    return { kind: 'course', course: r.course, structured: r.structured, stats, notes: r.notes };
  }
  if (input.kind === 'instruction') {
    const r = buildInstruction(input, blocks);
    return { kind: 'instruction', instruction: r.instruction, structured: r.structured, stats: { ...stats, steps: r.steps }, notes: r.notes };
  }
  const r = buildBook(input, blocks, weak);
  return { kind: 'manuscript', book: r.book, structured: r.structured, stats, notes: r.notes };
}
