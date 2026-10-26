/**
 * Власні шаблони й фони блоків: копія шаблону для DesignCraft → правка → імпорт → верстка.
 * Запуск: npm run test:designcraft-templates
 *
 * Без справжнього DesignCraft: документ `.designcraft` складається з тих самих визначень стилів, які
 * створює рушій Студії (`buildDesigncraftParagraphStyles`) — це і є «копія шаблону» у файлі, — далі
 * «автор» змінює стилі й повертає файл. Перевіряємо круговий шлях.
 */
import JSZip from 'jszip';
import { buildDesigncraftParagraphStyles } from '../server/pdf/designcraft/styleCommands';
import { BOOK_DESIGN_THEMES } from '../server/pdf/designcraft/themes';
import { DEFAULT_LAYOUT_SPEC } from '../server/pdf/pdfTypes';
import { designThemeFromBook, specFromBook } from '../server/pdf/pdfFromBook';
import { sanitizeBlockBackgrounds, sanitizeCustomDesignTheme } from '../server/pdf/designcraft/customThemeSanitize';
import { importDesigncraftTemplate, TEMPLATE_STYLE_ENTITIES, TemplateImportError } from '../server/pdf/designcraft/templateImport';
import { buildTemplateSpecimen, parseTemplateCopyRequest, renderTemplateCopy } from '../server/pdf/designcraft/templateRoundTrip';
import { buildDesigncraftRtf } from '../server/pdf/designcraft/rtf';
import { registerPdfEngine } from '../server/pdf/engines/registry';
import { BLOCK_BACKGROUND_PALETTE, BLOCK_BACKGROUND_TARGETS } from '../src/data/customBookDesignTheme';

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

const ALL = TEMPLATE_STYLE_ENTITIES.map((s) => s.style) as any[];
const hexToRgb = (hex: string) => ({ model: 'rgb', r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

/** Файл `.designcraft`, як його зберігає DesignCraft: ZIP з mimetype, meta.json, document.json. */
async function designcraftFile(styles: Array<{ name: string; para: any; chars: any }>, extra: Record<string, unknown> = {}): Promise<Buffer> {
  const hexes = new Set<string>();
  for (const s of styles) for (const n of [s.chars?.fill, s.para?.shadingColor, s.para?.borderColor]) if (typeof n === 'string' && n.startsWith('BookDesign ')) hexes.add('#' + n.slice(11));
  const doc = {
    title: 'Зразок',
    styles: { paragraph: [{ name: '[No Paragraph Style]', para: {}, chars: {} }, ...styles] },
    swatches: [
      { name: '[None]', value: { kind: 'none' }, locked: true },
      ...[...hexes].map((h) => ({ name: 'BookDesign ' + h.slice(1), value: { kind: 'color', color: hexToRgb(h), color_type: 'process' }, locked: false })),
    ],
    ...extra,
  };
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.designcraft+zip');
  zip.file('meta.json', JSON.stringify({ format: 'designcraft', version: 1 }));
  zip.file('document.json', JSON.stringify(doc));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

console.log('\nФон блоків «за опціями» в усіх шаблонах');
{
  const ids = Object.keys(BOOK_DESIGN_THEMES);
  let ok = 0;
  let none = 0;
  for (const id of ids) {
    const spec: any = { ...DEFAULT_LAYOUT_SPEC, themeId: id, blockBackgrounds: { Quote: { color: '#DDEBF7', opacity: 0.8 }, ChatMessage: { color: null } } };
    const styles = buildDesigncraftParagraphStyles(spec, ['Quote', 'ChatMessage']);
    const quote = styles.find((s) => s.name === 'Quote');
    const chat = styles.find((s) => s.name === 'ChatMessage');
    if (quote?.para.shadingOn && quote.para.shadingColor === 'BookDesign DDEBF7' && quote.para.shadingTint === 0.8 && quote.para.shadingOffsets) ok++;
    if (chat && !chat.para.shadingOn && !chat.para.shadingColor) none++;
  }
  t(`фон Цитати застосовується у всіх ${ids.length} шаблонах (колір, прозорість, відступ усередині)`, ok === ids.length, `${ok}/${ids.length}`);
  t('«без фону» прибирає фон, який давав шаблон (sci-fi мав фон у чату)', none === ids.length, `${none}/${ids.length}`);
  const noOption = buildDesigncraftParagraphStyles({ ...DEFAULT_LAYOUT_SPEC, themeId: 'sci-fi' } as any, ['ChatMessage']).find((s) => s.name === 'ChatMessage')!;
  t('без опції верстка шаблону не змінюється (немає фону)', !noOption.para.shadingOn);
  const evil = sanitizeBlockBackgrounds({ Quote: { color: 'red; drop' }, Hack: { color: '#112233' }, Letter: { color: '#abcdef', opacity: 9 } });
  t('сміття відсіюється: лише відомі блоки й #RRGGBB, прозорість у межах', !!evil && Object.keys(evil).join() === 'Letter' && evil.Letter!.color === '#ABCDEF' && evil.Letter!.opacity === 1, JSON.stringify(evil));
  t('палітра: 8 світлих кольорів; блоків для фону 13', BLOCK_BACKGROUND_PALETTE.length === 8 && BLOCK_BACKGROUND_TARGETS.length === 13 && BLOCK_BACKGROUND_PALETTE.every((p) => /^#[0-9A-F]{6}$/.test(p.color)));
}

console.log('\nШаблон у книзі → справжня верстка');
{
  const base: any = { title: 'К', author: 'А', chapters: [], layoutConfig: { bookDesignThemeId: 'sci-fi', typography: { bodyFont: 'Georgia', headingsFont: 'Georgia', fontSizePt: 11 }, margins: {} } };
  const plain = specFromBook(structuredClone(base));
  t('книга без власного шаблону й фонів: спека без нових ключів', !('customThemeVisuals' in plain) && !('blockBackgrounds' in plain));
  const withBg: any = structuredClone(base);
  withBg.layoutConfig.blockBackgrounds = { Quote: { color: '#F8E3E6' } };
  withBg.layoutConfig.customDesignTheme = { id: 'custom-x', name: 'Мій', basedOn: 'fantasy', entities: { body: { entity: 'body', enabled: true, fontSizePt: 13, spaceAfterPt: 9, firstLineIndentPt: 20 } }, fonts: [], page: {} };
  const spec: any = specFromBook(withBg);
  t('власний шаблон і фони потрапляють у спеку', spec.customThemeVisuals?.entities?.body?.fontSizePt === 13 && spec.blockBackgrounds?.Quote?.color === '#F8E3E6');
  t('рушій бере за основу вбудований шаблон власного (fantasy, а не sci-fi)', designThemeFromBook(withBg) === 'fantasy');
  const body = buildDesigncraftParagraphStyles({ ...spec, themeId: 'fantasy' }, []).find((s) => s.name === 'Body')!;
  t('стиль Body бере розмір, відступ першого рядка й інтервал із власного шаблону', body.chars.size === 13 && body.para.firstLineIndent === 20 && body.para.spaceAfter === 9, JSON.stringify(body.para));
  t('завеликий або без основи шаблон відкидається', sanitizeCustomDesignTheme({ id: 'c', name: 'x', basedOn: 'nope' }) === null && sanitizeCustomDesignTheme({ id: 'c', name: 'x', basedOn: 'classic', entities: { body: { fontSizePt: 1e9, textColor: 'url(x)' } } })!.visuals.entities.body!.fontSizePt === 72);
}

console.log('\nКопія шаблону для DesignCraft');
{
  const specimen = buildTemplateSpecimen('Classic');
  const text = specimen.chapters.flatMap((c) => c.sections.map((s) => s.content)).join('\n');
  const markers = new Set([...text.matchAll(/\[STYLE:([^\]]+)\]/g)].map((m) => m[1]));
  const wanted = ALL.filter((n) => !['Body', 'Heading 1', 'Heading 2'].includes(n));
  t('у зразку є абзац для кожного смислового стилю (14)', wanted.every((n) => markers.has(n)) && wanted.length === 14, `${markers.size}`);

  let seen: any = null;
  registerPdfEngine({
    id: 'designcraft', label: 'fake', strengthUk: '', limitUk: '', supportsPrint: false, supportsCompanions: false,
    available: async () => ({ ok: true }),
    render: async (req) => {
      seen = req;
      return { bytes: new Uint8Array([1]), pageCount: 1, engineId: 'designcraft', honoredSpec: true, notesUk: [], document: { bytes: new Uint8Array([9, 9]), extension: 'designcraft' } };
    },
  } as any);
  const request = parseTemplateCopyRequest({ theme: 'classic', blockBackgrounds: { Quote: { color: '#DFF1E6' } } });
  const rendered = await renderTemplateCopy(request, { id: 'u1', role: 'user' } as any);
  const ents = Object.keys(seen.spec.customThemeVisuals.entities);
  t('копія верстається тим самим рушієм з keepDocument і шаблоном classic', seen.keepDocument === true && seen.theme === 'classic' && rendered.document!.bytes.length === 2);
  t('у копії ввімкнено ВСІ стилі шаблону (навіть ті, що тема не використовує)', TEMPLATE_STYLE_ENTITIES.every((s) => ents.includes(s.entity)), `${ents.length}`);
  t('поточні фони блоків потрапляють у копію', seen.spec.blockBackgrounds?.Quote?.color === '#DFF1E6');
  let threw = '';
  try { parseTemplateCopyRequest({ theme: 'nope' }); } catch (e) { threw = (e as Error).message; }
  t('невідомий шаблон — зрозуміла відмова', /Невідомий шаблон/.test(threw), threw);
  const custom = parseTemplateCopyRequest({ customTheme: { id: 'custom-1', name: 'Мій шаблон', basedOn: 'noir-detective', entities: { quote: { enabled: true, fontSizePt: 14 } }, fonts: [], page: {} } });
  t('власний шаблон → копія на його основі з його назвою', custom.theme === 'noir-detective' && custom.label === 'Мій шаблон' && custom.visuals.entities.quote?.fontSizePt === 14);
}

console.log('\nІмпорт користувацького шаблону з .designcraft');
{
  // «Копія шаблону»: стилі, які рушій створює для classic.
  const spec: any = { ...DEFAULT_LAYOUT_SPEC, themeId: 'classic', customThemeVisuals: { fonts: [], page: { textColor: '#222222', accentColor: '#0F766E' }, entities: Object.fromEntries(TEMPLATE_STYLE_ENTITIES.map((s) => [s.entity, { entity: s.entity, enabled: true }])) } };
  const copy = buildDesigncraftParagraphStyles(spec, ALL);
  t('копія містить усі стилі шаблону', ALL.every((n) => copy.some((s) => s.name === n)), `${copy.length}`);

  // «Автор правит у DesignCraft»: Body 12.5 pt, відступ 18, Quote 14 pt курсив із м'ятним фоном і рамкою, Heading 1 — з іншим шрифтом.
  const edited = structuredClone(copy) as any[];
  const by = (n: string) => edited.find((s) => s.name === n)!;
  by('Body').chars.size = 12.5; by('Body').para.firstLineIndent = 18; by('Body').para.spaceAfter = 7; by('Body').chars.leading = { kind: 'points', value: 17 };
  by('Quote').chars.size = 14; by('Quote').chars.fontStyle = 'Bold Italic';
  Object.assign(by('Quote').para, { shadingOn: true, shadingColor: 'BookDesign DFF1E6', shadingTint: 0.7, shadingOffsets: [6, 10, 6, 10], borderOn: true, borderColor: 'BookDesign 0F766E', borderWeights: [0, 2, 0, 0], borderOffsets: [6, 10, 6, 10] });
  by('Heading 1').chars.fontFamily = 'Source Serif 4';
  by('Letter').chars.fontFamily = 'Courier New';
  by('Heading 2').chars.fill = 'BookDesign 112233';
  const file = await designcraftFile(edited);

  const out = await importDesigncraftTemplate(file, { basedOn: 'classic', name: 'Мій книжковий' });
  const e = out.theme.entities as any;
  t('назва, основа, перенесені стилі', out.theme.name === 'Мій книжковий' && out.theme.basedOn === 'classic' && out.importedStyles.length === ALL.length && out.missingStyles.length === 0, `${out.importedStyles.length}`);
  t('Body: розмір, відступ, інтервал, міжрядковий (17/12.5)', e.body.fontSizePt === 12.5 && e.body.firstLineIndentPt === 18 && e.body.spaceAfterPt === 7 && Math.abs(e.body.lineHeight - 1.36) < 0.01, JSON.stringify(e.body));
  t('Quote: розмір, жирний курсив', e.quote.fontSizePt === 14 && e.quote.italic === true && e.quote.fontWeight === 700);
  t('Quote: фон (колір з палітри DesignCraft, прозорість) і відступ усередині в мм', e.quote.background?.color === '#DFF1E6' && e.quote.background.opacity === 0.7 && Math.abs(e.quote.paddingMm.left - 3.53) < 0.02, JSON.stringify(e.quote.background) + JSON.stringify(e.quote.paddingMm));
  t('Quote: рамка лише ліва, 2 pt, колір', e.quote.border?.color === '#0F766E' && e.quote.border.widthPt === 2 && e.quote.border.sides.join() === 'left', JSON.stringify(e.quote.border));
  t('колір тексту заголовка читається з іменованого кольору', e['heading-2'].textColor === '#112233');
  t('чужий шрифт замінено на доступний із чесним попередженням', e['heading-1'].fontSlot === 'body' && e.letter.fontSlot === 'mono' && out.notesUk.some((n) => /Source Serif 4/.test(n)) && out.notesUk.some((n) => /Courier New/.test(n)), out.notesUk.join(' | '));
  t('імпортований шаблон проходить ту саму перевірку, що й збережений у книзі', sanitizeCustomDesignTheme(out.theme)?.basedOn === 'classic');

  // Круговий шлях: імпортований шаблон → верстка → ті самі значення в стилях рушія.
  const again = buildDesigncraftParagraphStyles({ ...DEFAULT_LAYOUT_SPEC, themeId: 'classic', customThemeVisuals: sanitizeCustomDesignTheme(out.theme)!.visuals } as any, ALL);
  const body2 = again.find((s) => s.name === 'Body')!;
  const quote2 = again.find((s) => s.name === 'Quote')!;
  t('круговий шлях: рушій Студії видає стилі, які автор зробив у DesignCraft', body2.chars.size === 12.5 && body2.para.firstLineIndent === 18 && quote2.chars.size === 14 && quote2.para.shadingColor === 'BookDesign DFF1E6' && quote2.para.borderOn === true, JSON.stringify(quote2.para).slice(0, 160));

  // CMYK-колір і неповний файл
  const cmyk = structuredClone(copy) as any[];
  cmyk.find((s) => s.name === 'Body').chars.fill = 'C=0 M=100 Y=100 K=0';
  const cmykFile = await designcraftFile(cmyk);
  const zip = await JSZip.loadAsync(cmykFile);
  const doc = JSON.parse(await zip.file('document.json')!.async('string'));
  doc.swatches.push({ name: 'C=0 M=100 Y=100 K=0', value: { kind: 'color', color: { model: 'cmyk', c: 0, m: 1, y: 1, k: 0 } } });
  zip.file('document.json', JSON.stringify(doc));
  const cm = await importDesigncraftTemplate(await zip.generateAsync({ type: 'nodebuffer' }), { basedOn: 'classic' });
  t('CMYK-колір перетворюється на HEX', cm.theme.entities.body?.textColor === '#FF0000', String(cm.theme.entities.body?.textColor));

  const partial = await importDesigncraftTemplate(await designcraftFile(copy.filter((s) => ['Body', 'Heading 1'].includes(s.name))), { basedOn: 'classic' });
  t('частковий файл: імпорт стилів, що є, і пояснення про решту', partial.importedStyles.length === 2 && partial.missingStyles.length === ALL.length - 2 && partial.notesUk.some((n) => /Не знайдено стилів/.test(n)));
}

console.log('\nПомилки імпорту — зрозумілі');
{
  const expectErr = async (label: string, bytes: Buffer, re: RegExp) => {
    let msg = '';
    try { await importDesigncraftTemplate(bytes, { basedOn: 'classic' }); } catch (e) { msg = e instanceof TemplateImportError ? e.message : 'НЕ TemplateImportError: ' + (e as Error).message; }
    t(label, re.test(msg), msg);
  };
  await expectErr('порожній файл', Buffer.alloc(0), /порожній/i);
  await expectErr('не ZIP', Buffer.from('hello world, not a zip'), /не файл DesignCraft/);
  const noDoc = new JSZip();
  noDoc.file('x.txt', 'x');
  await expectErr('ZIP без document.json', await noDoc.generateAsync({ type: 'nodebuffer' }), /document\.json/);
  const wrongMime = new JSZip();
  wrongMime.file('mimetype', 'application/epub+zip');
  wrongMime.file('document.json', '{}');
  await expectErr('чужий mimetype (EPUB)', await wrongMime.generateAsync({ type: 'nodebuffer' }), /не документ DesignCraft/);
  const badJson = new JSZip();
  badJson.file('document.json', '{oops');
  await expectErr('пошкоджений JSON', await badJson.generateAsync({ type: 'nodebuffer' }), /пошкоджено/);
  await expectErr('немає стилів абзаців', await designcraftFile([], { styles: {} }), /немає стилів абзаців/);
  await expectErr('є стилі, але не Студії (Heading X)', await designcraftFile([{ name: 'Мій стиль', para: {}, chars: { size: 10 } }]), /жодного стилю Студії/);
}

console.log('\nТекст для DesignCraft: локальні перекриття не глушать стилі');
{
  const specimenBook = buildTemplateSpecimen('Зразок');
  const copyReq = parseTemplateCopyRequest({ theme: 'classic' });
  const specimenSpec: any = { ...DEFAULT_LAYOUT_SPEC, themeId: 'classic', customThemeVisuals: copyReq.visuals, templateSpecimen: true };
  const sp = buildDesigncraftRtf(specimenBook as any, specimenSpec);
  const spText = String((sp as any).text ?? (sp as any).rtf ?? JSON.stringify(sp));
  t('копія шаблону: абзаци без локальних <cSize>/<cFont>/<cTypeface>', !/<cSize:|<cFont:|<cTypeface:/.test(spText), spText.match(/<c(Size|Font|Typeface):[^>]*>/)?.[0] || '');
  const used = new Set([...spText.matchAll(/<ParaStyle:([^>]+)>/g)].map((m) => m[1]));
  t('копія шаблону: є абзаци всіх 14 смислових стилів', ALL.filter((s) => s !== 'Body' && s !== 'Heading 1' && s !== 'Heading 2').every((s) => used.has(s)), [...used].join(','));

  const bookBook: any = buildTemplateSpecimen('Книга');
  const real = buildDesigncraftRtf(bookBook, { ...DEFAULT_LAYOUT_SPEC, themeId: 'classic' } as any);
  const realText = String((real as any).text ?? (real as any).rtf ?? JSON.stringify(real));
  t('звичайна книга: локальні розміри лишаються (як було)', /<cSize:/.test(realText));

  const custom = sanitizeCustomDesignTheme({ id: 'x', name: 'X', basedOn: 'classic', visuals: { entities: { body: { enabled: true, fontSizePt: 13 } } } })!;
  const withCustom = buildDesigncraftRtf(bookBook, { ...DEFAULT_LAYOUT_SPEC, themeId: 'classic', customThemeVisuals: custom.visuals } as any);
  const cText = String((withCustom as any).text ?? (withCustom as any).rtf ?? JSON.stringify(withCustom));
  t('власний шаблон: розмір Body із шаблону потрапляє в локальні теги', /<cSize:13>/.test(cText), cText.match(/<cSize:[^>]*>/)?.[0] || '');
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало.`);
if (fail) process.exit(1);
