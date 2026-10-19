/**
 * Можливості встановленого DesignCraft — дані, а не регулярка.
 *
 * ЧОМУ ЦЕ ІСНУЄ. У production стояв shell-шим
 * (`scripts/designcraft-cli-compat.sh`), який awk-ом переписував уже
 * згенерований `.dcs`-скрипт перед запуском: `text.selectStory` →
 * `text.select` із великим focus, і `"align":"justify"` →
 * `"align":"leftJustified"`. Правити мову команд регуляркою в production
 * погано двома способами. По-перше, це тихо: якщо виробник скрипта почне
 * видавати недійсну команду, шим її замаскує, і ніхто не дізнається. По-друге,
 * це сліпо: шим не знає, що саме вміє прибитий бінарник, він лише вгадує два
 * відомі випадки.
 *
 * Перевірка 19.10.2026 показала, що обидва випадки вже мертві:
 *   - `text.selectStory` не емітує жоден виробник скриптів у цьому репозиторії
 *     (єдині згадки були в самому шимі й у коментарі рушія V1);
 *   - `"align":"justify"` теж ніхто не емітує: `dcAlign()` у styleCommands.ts
 *     і в рушіях V1/V2 уже віддає `leftJustified`.
 * Причому `leftJustified` — НЕ пережиток старої версії, а єдине правильне
 * написання: рушій (і 0.7.1, і поточні джерела) на `justify` відповідає
 * `unknown variant 'justify', expected one of left, center, right,
 * leftJustified, centerJustified, rightJustified, fullyJustified,
 * towardsSpine, awayFromSpine`.
 *
 * Тому awk не замінюється «розумнішим awk». Замість нього — дві перевірки
 * ПЕРЕД запуском, обидві гучні:
 *   1. кожен id команди у скрипті справді існує у ВСТАНОВЛЕНОМУ бінарнику
 *      (`designcraft-cli commands` — це сам бінарник про себе, тобто дані);
 *   2. кожне значення `align` належить набору, який рушій приймає.
 *
 * Перша перевірка — узагальнення випадку `text.selectStory` на весь словник
 * команд: розбіжність версій стає явною помилкою з назвою команди, а не
 * поломкою посеред рендера. Друга ловить регресію виробника, яку раніше
 * ховав awk.
 *
 * ЧОГО ТУТ НЕМА. Набір значень `align` не вичитується з бінарника, бо
 * `designcraft-cli describe type.align` документує його скорочено —
 * `{align: left|center|right|leftJustified|…}`, з буквальним «…». Повний
 * перелік відомий лише з повідомлення про помилку, тож він записаний нижче
 * константою, а тест `test:designcraft-capabilities` звіряє її з живим
 * бінарником, коли той доступний.
 */

/** Значення `align`, які приймає рушій. Джерело — повідомлення самого рушія (див. шапку). */
export const DESIGNCRAFT_ALIGN_VALUES: ReadonlySet<string> = new Set([
  'left',
  'center',
  'right',
  'leftJustified',
  'centerJustified',
  'rightJustified',
  'fullyJustified',
  'towardsSpine',
  'awayFromSpine',
]);

export interface DesigncraftCapabilities {
  /** Усі id команд, які має встановлений бінарник. */
  commandIds: ReadonlySet<string>;
  /** Скільки команд повернув бінарник — для діагностики й тестів. */
  commandCount: number;
}

export interface CapabilityProbeResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Запускач CLI. Передається знадвору, щоб цей модуль не знав про child_process. */
export type CapabilityProbeRunner = (args: string[]) => Promise<CapabilityProbeResult>;

/**
 * Розібрати вивід `designcraft-cli commands` у набір можливостей.
 * Чиста функція: саме її перевіряють тести, без запуску справжнього CLI.
 */
export function parseDesigncraftCapabilities(raw: unknown): DesigncraftCapabilities {
  const list = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!Array.isArray(list)) {
    throw new Error('`designcraft-cli commands` повернув не масив команд.');
  }
  const ids = new Set<string>();
  for (const entry of list) {
    const id = (entry as { id?: unknown })?.id;
    if (typeof id === 'string' && id.trim()) ids.add(id.trim());
  }
  if (!ids.size) {
    throw new Error('`designcraft-cli commands` повернув масив без жодного id команди.');
  }
  return { commandIds: ids, commandCount: ids.size };
}

function safeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('`designcraft-cli commands` не повернув нічого.');
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `\`designcraft-cli commands\` повернув не JSON (${trimmed.length} символів): ${trimmed.slice(0, 300)}`,
      { cause: err as Error }
    );
  }
}

/**
 * Кеш проби на процес, за шляхом до бінарника. Кешується саме Promise, щоб
 * два паралельні рендери не запускали пробу двічі. Невдала проба з кешу
 * прибирається: наступний рендер має право спробувати ще раз.
 */
const cache = new Map<string, Promise<DesigncraftCapabilities>>();

export function readDesigncraftCapabilities(
  cliPath: string,
  run: CapabilityProbeRunner
): Promise<DesigncraftCapabilities> {
  const cached = cache.get(cliPath);
  if (cached) return cached;

  const probe = (async () => {
    const out = await run(['commands']);
    if (out.code !== 0) {
      throw new Error(
        `\`designcraft-cli commands\` завершився з кодом ${String(out.code)}: ` +
          (out.stderr.trim() || out.stdout.trim() || 'без повідомлення').slice(-500)
      );
    }
    return parseDesigncraftCapabilities(out.stdout);
  })();

  cache.set(cliPath, probe);
  probe.catch(() => cache.delete(cliPath));
  return probe;
}

/** Лише для тестів: забути попередні проби. */
export function __resetDesigncraftCapabilitiesCache(): void {
  cache.clear();
}

interface ScriptStep {
  index: number;
  id: string;
  params: unknown;
}

/**
 * Розібрати текст скрипта на кроки. Формат — `crates/engine/src/script.rs`:
 * `command.id {json}`, `command.id={json}`, `command.id` окремо, або рядок
 * JSON `{"command": …, "params": …}`. Коментарі (`#`, `//`) і порожні рядки
 * кроками не є — так само, як їх не рахує сам рушій при нумерації `$N`.
 *
 * Якщо файл — цілий JSON-масив (форма, якої жоден виробник у цьому
 * репозиторії не використовує), повертається null: краще не перевіряти, ніж
 * перевірити неправильно.
 */
function parseScriptSteps(script: string): ScriptStep[] | null {
  if (script.replace(/^﻿/, '').trimStart().startsWith('[')) return null;

  const steps: ScriptStep[] = [];
  let index = 0;
  for (const rawLine of script.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    if (line.startsWith('{')) {
      const parsed = tryJson(line) as { command?: unknown; params?: unknown } | undefined;
      const id = typeof parsed?.command === 'string' ? parsed.command.trim() : '';
      steps.push({ index, id, params: parsed?.params });
      index += 1;
      continue;
    }

    const eq = line.indexOf('=');
    const space = line.search(/\s/);
    const cut =
      eq >= 0 && (space < 0 || eq < space) ? { at: eq, skip: 1 } : space >= 0 ? { at: space, skip: 1 } : null;
    const id = (cut ? line.slice(0, cut.at) : line).trim();
    const rest = cut ? line.slice(cut.at + cut.skip).trim() : '';
    steps.push({ index, id, params: rest ? tryJson(rest) : undefined });
    index += 1;
  }
  return steps;
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Усі значення ключа `align` на будь-якій глибині параметрів. */
function alignValues(params: unknown, out: string[] = []): string[] {
  if (Array.isArray(params)) {
    for (const item of params) alignValues(item, out);
    return out;
  }
  if (params && typeof params === 'object') {
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (key === 'align' && typeof value === 'string') out.push(value);
      else alignValues(value, out);
    }
  }
  return out;
}

/**
 * Що у цьому скрипті встановлений DesignCraft не виконає. Порожній масив —
 * скрипт можна запускати. Повідомлення призначені для журналу й автора, тому
 * називають крок і команду.
 *
 * `caps` можна не передавати: тоді перевіряються лише значення `align`
 * (вони від версії не залежать), а словник команд — ні.
 */
export function findUnsupportedScriptSteps(
  script: string,
  caps?: DesigncraftCapabilities | null
): string[] {
  const steps = parseScriptSteps(script);
  if (!steps) return [];

  const problems: string[] = [];
  for (const step of steps) {
    if (!step.id) {
      problems.push(`Крок ${step.index}: не вдалося визначити команду в рядку скрипта.`);
      continue;
    }
    if (caps && !caps.commandIds.has(step.id)) {
      problems.push(
        `Крок ${step.index} (${step.id}): встановлений DesignCraft не має такої команди ` +
          `(у ньому ${caps.commandCount} команд). Це розбіжність версій, не помилка книги.`
      );
    }
    for (const value of alignValues(step.params)) {
      // "$0.align" — посилання на результат попереднього кроку, його розв'язує сам рушій.
      if (value.startsWith('$')) continue;
      if (!DESIGNCRAFT_ALIGN_VALUES.has(value)) {
        problems.push(
          `Крок ${step.index} (${step.id}): align «${value}» рушій не приймає. ` +
            `Дозволені: ${[...DESIGNCRAFT_ALIGN_VALUES].join(', ')}.`
        );
      }
    }
  }
  return problems;
}
