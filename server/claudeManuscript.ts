/**
 * «Форматування готового файлу під Amazon KDP» — окремий інструмент від
 * решти книги: письменник приносить уже готовий рукопис (не обов'язково
 * створений у NOVA STUDIO), а Claude (Anthropic API) виступає літературним
 * верстальником-редактором: розбиває текст на глави, прибирає артефакти
 * форматування (подвійні порожні рядки, символи табуляції, криві лапки),
 * зберігаючи авторський текст — нічого не додає й не переписує зміст.
 * Результат — структурований JSON, який фронтенд рендерить у HTML з
 * коректними полями/обрізним форматом Amazon KDP (server/../utils/kdpHelpers.ts)
 * і друкує в PDF тим самим механізмом «print → Save as PDF», що й решта
 * експортів книги (без жодних серверних PDF-бібліотек).
 *
 * Доступно лише підписникам Pro/Ultra (server/subscriptions.ts, requirePlanAtLeast).
 */

import { buildClaudeManuscriptPrompt } from './claudeManuscriptPrompt';

export type ClaudeManuscriptErrorKind = 'no_key' | 'safety' | 'quota' | 'bad_input' | 'too_long' | 'unknown';

export class ClaudeManuscriptError extends Error {
  kind: ClaudeManuscriptErrorKind;
  constructor(kind: ClaudeManuscriptErrorKind, message: string) {
    super(message);
    this.name = 'ClaudeManuscriptError';
    this.kind = kind;
  }
}

/** Дуже довгий рукопис краще попросити розділити — один виклик без чанкування, щоб не «зшивати» глави різними проходами. */
export const MAX_MANUSCRIPT_CHARS = 400_000;

export interface FormattedChapter {
  title: string;
  /** Очищений текст глави, абзаци розділені порожнім рядком (\n\n). */
  text: string;
}

export interface FormatManuscriptResult {
  chapters: FormattedChapter[];
  notes: string[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface FormatManuscriptOptions {
  text: string;
  bookTitle?: string;
  author?: string;
  genre?: string;
}

export const anthropicConfig = {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  get enabled(): boolean {
    return !!this.apiKey;
  },
};

/**
 * Побудова промту винесена в server/claudeManuscriptPrompt.ts — чистий
 * файл без роутів/стану (за принципом manuscriptImagePrompt.ts), щоб
 * «Ядро AI» могло показувати й редагувати той самий текст, що реально йде
 * в модель (крім JSON-схеми відповіді — вона лишається жорсткою).
 */
function buildPrompt(opts: FormatManuscriptOptions): { system: string; user: string } {
  return buildClaudeManuscriptPrompt({
    bookTitle: opts.bookTitle,
    author: opts.author,
    genre: opts.genre,
    manuscriptText: opts.text,
  });
}

interface AnthropicMessageResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
  error?: { type?: string; message?: string };
  type?: string;
}

function classifyHttpError(status: number, message: string): ClaudeManuscriptErrorKind {
  if (status === 401 || status === 403) return 'no_key';
  if (status === 429) return 'quota';
  const m = message.toLowerCase();
  if (m.includes('safety') || m.includes('blocked') || m.includes('content')) return 'safety';
  return 'unknown';
}

/** Витягує JSON-об'єкт із відповіді моделі — на випадок, якщо навколо є зайвий текст попри інструкцію. */
function extractJson(raw: string): { chapters: unknown; notes: unknown } {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* впаде нижче */
      }
    }
    throw new ClaudeManuscriptError('unknown', 'Claude повернув відповідь у форматі, який не вдалося розпізнати як JSON.');
  }
}

export async function formatManuscriptWithClaude(opts: FormatManuscriptOptions): Promise<FormatManuscriptResult> {
  // Валідацію вхідних даних робимо ДО перевірки ключа: порожній чи завеликий
  // текст — це проблема запиту, а не сервера, і користувач має побачити
  // саме її, а не загальне «немає ключа», навіть якщо ключ справді відсутній.
  if (!opts.text || !opts.text.trim()) {
    throw new ClaudeManuscriptError('bad_input', 'Порожній текст — нема що форматувати.');
  }
  if (opts.text.length > MAX_MANUSCRIPT_CHARS) {
    throw new ClaudeManuscriptError(
      'too_long',
      `Рукопис завеликий для одного проходу (${opts.text.length.toLocaleString('uk-UA')} символів, ` +
        `максимум ${MAX_MANUSCRIPT_CHARS.toLocaleString('uk-UA')}). Розділіть файл на частини (наприклад, по томах) і обробіть окремо.`
    );
  }
  if (!anthropicConfig.enabled) {
    throw new ClaudeManuscriptError('no_key', 'Ключ Anthropic не налаштований (ANTHROPIC_API_KEY).');
  }

  const { system, user } = buildPrompt(opts);

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicConfig.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: anthropicConfig.model,
        max_tokens: 16000,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
  } catch (err) {
    throw new ClaudeManuscriptError('unknown', `Claude API недоступний: ${(err as Error).message}`);
  }

  const json = (await res.json().catch(() => null)) as AnthropicMessageResponse | null;

  if (!res.ok) {
    const message = json?.error?.message || `HTTP ${res.status}`;
    throw new ClaudeManuscriptError(classifyHttpError(res.status, message), `Claude: ${message}`);
  }

  const textBlock = json?.content?.find((c) => c.type === 'text');
  if (!textBlock?.text) {
    throw new ClaudeManuscriptError('unknown', 'Claude повернув порожню відповідь.');
  }

  const parsed = extractJson(textBlock.text) as { chapters?: FormattedChapter[]; notes?: string[] };
  const chapters = Array.isArray(parsed.chapters)
    ? parsed.chapters
        .filter((c) => c && typeof c.text === 'string')
        .map((c) => ({ title: (c.title || 'Без назви').toString().trim(), text: c.text.toString().trim() }))
    : [];

  if (chapters.length === 0) {
    throw new ClaudeManuscriptError('unknown', 'Claude не зміг виділити жодної глави в тексті.');
  }

  return {
    chapters,
    notes: Array.isArray(parsed.notes) ? parsed.notes.map((n) => String(n)) : [],
    usage: {
      inputTokens: json?.usage?.input_tokens || 0,
      outputTokens: json?.usage?.output_tokens || 0,
    },
    model: anthropicConfig.model,
  };
}
