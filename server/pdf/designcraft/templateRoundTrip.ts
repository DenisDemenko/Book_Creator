/**
 * Копія шаблону для DesignCraft і повернення користувацького шаблону.
 *
 *   «Завантажити копію для DesignCraft» → `.designcraft`, зверстаний рушієм Студії з усіма стилями
 *   шаблону (Body, Heading 1/2 і всі смислові блоки) та зразком тексту для кожного. Автор відкриває
 *   файл у DesignCraft, правит СТИЛІ АБЗАЦІВ і зберігає його на диск.
 *   «Завантажити користувацький шаблон» → Студія читає стилі з цього файла (`templateImport.ts`).
 */
import express, { type Express, type Request, type Response } from 'express';
import { requireAuth } from '../../auth';
import {
  type BlockBackgrounds,
  type CustomBookDesignTheme,
  type DesignerEntityStyle,
  type DesignerThemeEntity,
} from '../../../src/data/customBookDesignTheme';
import { DEFAULT_LAYOUT_SPEC, type PdfBookInput } from '../pdfTypes';
import { renderWithEngine } from '../engines/registry';
import { PdfEngineError } from '../engines/types';
import {
  sanitizeBlockBackgrounds,
  sanitizeCustomDesignTheme,
  type CustomVisualsSnapshot,
} from './customThemeSanitize';
import { importDesigncraftTemplate, MAX_TEMPLATE_FILE_BYTES, TemplateImportError, TEMPLATE_STYLE_ENTITIES } from './templateImport';
import { getBookDesignTheme, isBookDesignThemeId, type BookDesignThemeId } from './themes';

/** Зразки тексту для кожного смислового стилю — щоб у DesignCraft було що правити «на око». */
const SAMPLE_TEXT: Record<string, string> = {
  Quote: 'Книга — це вікно, яке автор відчиняє для читача, і світло в ньому залежить від кожної дрібниці верстки.',
  Epigraph: 'Хто вміє слухати тишу, той почує початок історії. — Автор',
  Letter: 'Дорога Оксано! Пишу тобі з далекої дороги: тут пахне хвоєю й дощем, і я нарешті знову думаю ясно. Твій Андрій.',
  InnerThought: 'Чи не надто пізно щось змінювати? — подумала вона, і сама злякалась цієї думки.',
  ChatMessage: '— Ти вже на місці? — Так, чекаю біля входу. Не запізнюйся.',
  SceneBreak: '· · ·',
  Caption: 'Рис. 1. Підпис до ілюстрації — коротко й по суті.',
  LocationTime: 'Київ · ранок',
  SystemMessage: 'СИСТЕМА: з’єднання встановлено. Рівень доступу — 3.',
  Evidence: 'Доказ №7: знайдено в кишені пальта. Папір старий, чорнило свіже.',
  Lore: 'За легендою, першу браму міста збудували з каменю, який слухав пісні вітру.',
  CaseStudy: 'Приклад із практики: невелика студія подвоїла тираж, змінивши лише обкладинку й шрифт.',
  KeyIdea: 'Головна думка розділу: читабельність починається з ритму, а не з прикрас.',
  Footnote: '¹ Примітка внизу сторінки: джерело або пояснення.',
};

const BODY_SAMPLE = [
  'Звичайний абзац основного тексту. Саме за ним читач проводить більшість часу, тож його шрифт, розмір, відступ і міжрядковий інтервал — основа шаблону. Українська мова має багату систему словотворення, мелодійність і гнучкість.',
  'Другий абзац, щоб було видно відступ першого рядка та відстань між абзацами. Книга починається з думки, яка поступово перетворюється на історію.',
];

export const TEMPLATE_COPY_SPECIMEN_NOTE =
  'Правте стилі абзаців (Body, Heading 1, Heading 2, Quote, Letter…): шрифт, розмір, відступи, колір тексту, фон і рамку. Не перейменовуйте стилі й не видаляйте їх — Студія читає їх за назвами. Текст у файлі — лише зразок.';

/** Рукопис-зразок: усі стилі шаблону по одному абзацу. */
export function buildTemplateSpecimen(label: string): PdfBookInput {
  const blocks = TEMPLATE_STYLE_ENTITIES
    .filter((s) => s.style !== 'Body' && s.style !== 'Heading 1' && s.style !== 'Heading 2')
    .map((s) => `[STYLE:${s.style}]${SAMPLE_TEXT[s.style] || s.style}[/STYLE]`);
  return {
    title: `Шаблон Студії: ${label}`,
    subtitle: 'Копія для правки в DesignCraft',
    author: 'Book Creator Studio',
    chapters: [
      {
        id: 'template-specimen',
        title: 'Зразок шаблону',
        sections: [
          { id: 'specimen-body', title: 'Основний текст', content: BODY_SAMPLE.join('\n\n') },
          { id: 'specimen-blocks', title: 'Смислові блоки', content: blocks.join('\n\n') },
        ],
      },
    ],
    illustrations: [],
  } as PdfBookInput;
}

/** Щоб УСІ смислові стилі потрапили в документ, вмикаємо їх у візуалі копії (навіть якщо шаблон їх не використовує). */
function specimenVisuals(base: CustomVisualsSnapshot | null): CustomVisualsSnapshot {
  const entities: Partial<Record<DesignerThemeEntity, DesignerEntityStyle>> = { ...(base?.entities || {}) };
  for (const { entity } of TEMPLATE_STYLE_ENTITIES) {
    if (!entities[entity]) entities[entity] = { entity, enabled: true };
  }
  const fallback = {
    fonts: [],
    page: {
      pageBackground: { kind: 'color' as const, color: '#FFFFFF', opacity: 1 },
      textColor: '#1F2937',
      accentColor: '#0F766E',
      headerHeightMm: 8,
      footerHeightMm: 8,
      gutterMm: 4,
      mirroredMargins: true,
    },
  };
  return { fonts: base?.fonts || fallback.fonts, page: base?.page || fallback.page, entities };
}

function fail(res: Response, err: unknown) {
  if (err instanceof TemplateImportError) return res.status(400).json({ error: err.message, kind: 'bad_input' });
  if (err instanceof PdfEngineError) {
    const status = err.kind === 'timeout' ? 504 : err.kind === 'engine' ? 502 : err.kind === 'bad_input' ? 400 : 503;
    return res.status(status).json({ error: err.message, kind: err.kind });
  }
  console.error('[templateRoundTrip]', err);
  return res.status(500).json({ error: (err as Error)?.message || 'Не вдалося виконати операцію з шаблоном.', kind: 'engine' });
}

export interface TemplateCopyRequest {
  theme: BookDesignThemeId;
  label: string;
  visuals: CustomVisualsSnapshot;
  blockBackgrounds: BlockBackgrounds | null;
}

/** Розбір тіла запиту «копія шаблону»: вбудований шаблон або власний (на основі вбудованого). */
export function parseTemplateCopyRequest(body: any): TemplateCopyRequest {
  const custom = sanitizeCustomDesignTheme(body?.customTheme);
  const requested = typeof body?.theme === 'string' ? body.theme.trim() : '';
  const theme: BookDesignThemeId | null = custom ? custom.basedOn : isBookDesignThemeId(requested) ? requested : null;
  if (!theme) throw new TemplateImportError(`Невідомий шаблон: ${requested || 'порожньо'}.`);
  const builtin = getBookDesignTheme(theme)!;
  return {
    theme,
    label: custom ? custom.name : builtin.labelUk,
    visuals: specimenVisuals(custom?.visuals || null),
    blockBackgrounds: sanitizeBlockBackgrounds(body?.blockBackgrounds),
  };
}

export async function renderTemplateCopy(request: TemplateCopyRequest, principal: Request['principal']) {
  const spec = {
    ...DEFAULT_LAYOUT_SPEC,
    customThemeVisuals: request.visuals,
    // Без локальних шрифту/розміру в абзацах: інакше правка стилю в DesignCraft нічого не змінює.
    templateSpecimen: true,
    ...(request.blockBackgrounds ? { blockBackgrounds: request.blockBackgrounds } : {}),
  } as typeof DEFAULT_LAYOUT_SPEC;
  const rendered = await renderWithEngine('designcraft', {
    book: buildTemplateSpecimen(request.label),
    kind: 'book',
    spec,
    print: false,
    ownerId: (principal?.id as string) || null,
    ownerRole: (principal?.role as string) || null,
    theme: request.theme,
    keepDocument: true,
  });
  if (!rendered.document) {
    throw new PdfEngineError('designcraft', 'engine', 'DesignCraft зверстав зразок, але не повернув документ шаблону.');
  }
  return rendered;
}

export function registerDesigncraftTemplateRoundTripRoutes(app: Express): void {
  /** Копія шаблону для правки в DesignCraft. */
  app.post('/api/pdf/designcraft/template-copy', requireAuth, async (req: Request, res: Response) => {
    try {
      const request = parseTemplateCopyRequest(req.body);
      const rendered = await renderTemplateCopy(request, req.principal);
      res.setHeader('Content-Type', 'application/vnd.designcraft');
      res.setHeader('Content-Disposition', `attachment; filename="shablon-${request.theme}.designcraft"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Template-Note', encodeURIComponent(TEMPLATE_COPY_SPECIMEN_NOTE));
      return res.send(Buffer.from(rendered.document!.bytes));
    } catch (err) {
      return fail(res, err);
    }
  });

  /** Користувацький шаблон: `.designcraft`, збережений у DesignCraft → власна тема Студії. */
  app.post(
    '/api/pdf/designcraft/template-import',
    requireAuth,
    express.raw({ type: () => true, limit: MAX_TEMPLATE_FILE_BYTES }),
    async (req: Request, res: Response) => {
      try {
        const basedOn = String(req.query.basedOn || '');
        if (!isBookDesignThemeId(basedOn)) throw new TemplateImportError('Вкажіть базовий шаблон (basedOn).');
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const imported = await importDesigncraftTemplate(bytes, { basedOn, name: String(req.query.name || '') });
        return res.json({
          theme: imported.theme,
          importedStyles: imported.importedStyles,
          missingStyles: imported.missingStyles,
          notesUk: imported.notesUk,
        });
      } catch (err) {
        return fail(res, err);
      }
    }
  );
}
