/**
 * Аудит шаблонів верстки: жодних двох різних шаблонів під однаковою назвою.
 *
 * ЧОМУ. Шаблони живуть у кількох місцях: «Верстка & Поля» (legacy designTheme рушія Студії),
 * каталог тем DesignCraft (клієнт і сервер), варіанти тем, навчальні шаблони. Раніше
 * «Classic» і «Editorial» існували двічі як РІЗНІ речі. Тепер колишні теми «Верстка & Поля»
 * стали окремими шаблонами Studio Classic / Studio Editorial, і цей тест не дає дублікатам
 * повернутися.
 */
import assert from 'node:assert/strict';
import {
  BOOK_DESIGN_THEME_CARDS,
  applyBookDesignTheme,
  studioThemeForLegacy,
  getBookDesignThemeCard,
} from '../src/data/bookDesignThemeCatalog';
import { listBookDesignThemes, BOOK_DESIGN_THEME_ORDER } from '../server/pdf/designcraft/themes';
import { EDUCATIONAL_PDF_TEMPLATES } from '../src/data/educationalPdfTemplates';
import { EDUCATIONAL_TEMPLATE_RENDER_PROFILES } from '../server/pdf/designcraft/educationalTemplates';
import { layoutView } from '../src/i18n/dictionaries/layoutView';

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const norm = (s: string) => s.normalize('NFKC').replace(/[‐-―‑]/g, '-').trim().toLocaleLowerCase('uk-UA');

t('каталог клієнта й теми сервера мають однакові id', () => {
  const client = BOOK_DESIGN_THEME_CARDS.map((c) => c.id).sort();
  const server = [...BOOK_DESIGN_THEME_ORDER].sort();
  assert.deepEqual(client, server);
  assert.deepEqual(listBookDesignThemes().map((x) => x.id).sort(), server);
});

t('назви каталогу клієнта збігаються з назвами тем сервера', () => {
  for (const theme of listBookDesignThemes()) {
    assert.equal(norm(getBookDesignThemeCard(theme.id).label), norm(theme.labelUk), theme.id);
  }
});

t('id шаблонів унікальні в усіх джерелах', () => {
  const ids = [
    ...BOOK_DESIGN_THEME_CARDS.map((c) => `theme:${c.id}`),
    ...EDUCATIONAL_PDF_TEMPLATES.map((e) => `edu:${e.id}`),
  ];
  const bare = ids.map((x) => x.split(':')[1]);
  const dup = bare.filter((x, i) => bare.indexOf(x) !== i);
  assert.deepEqual(dup, [], `однакові id: ${dup.join(', ')}`);
});

t('назви шаблонів, тем і варіантів не повторюються', () => {
  const variantLabels = new Map<string, string>();
  for (const theme of listBookDesignThemes()) for (const v of theme.variants) variantLabels.set(v.id, v.labelUk);
  const named: Array<{ who: string; label: string }> = [
    ...BOOK_DESIGN_THEME_CARDS.map((c) => ({ who: `тема ${c.id}`, label: c.label })),
    ...[...variantLabels].map(([id, label]) => ({ who: `варіант ${id}`, label })),
    ...EDUCATIONAL_PDF_TEMPLATES.map((e) => ({ who: `навчальний ${e.id}`, label: e.labelUk })),
  ];
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const { who, label } of named) {
    const key = norm(label);
    if (seen.has(key)) clashes.push(`«${label}»: ${seen.get(key)} і ${who}`);
    else seen.set(key, who);
  }
  assert.deepEqual(clashes, []);
});

t('теми «Верстка & Поля» не збігаються з ІНШИМИ шаблонами (лише зі своїм шаблоном Студії)', () => {
  const variantLabels = new Set(listBookDesignThemes().flatMap((x) => x.variants.map((v) => norm(v.labelUk))));
  for (const lang of ['uk', 'en'] as const) {
    const d = layoutView[lang];
    for (const [legacy, label] of [['classic', d.designThemeClassicLabel], ['editorial', d.designThemeEditorialLabel]] as const) {
      const own = getBookDesignThemeCard(studioThemeForLegacy(legacy));
      for (const card of BOOK_DESIGN_THEME_CARDS) {
        if (card.id === own.id) continue;
        assert.notEqual(norm(label), norm(card.label), `${lang}/${legacy}: «${label}» = тема ${card.id}`);
      }
      assert.ok(!variantLabels.has(norm(label)), `${lang}/${legacy}: «${label}» = назва варіанта`);
      assert.ok(norm(label).includes(norm(own.label)), `${lang}/${legacy}: «${label}» має називати свій шаблон ${own.label}`);
    }
  }
});

t('навчальні шаблони сервера спираються на існуючі теми', () => {
  const ids = new Set<string>(BOOK_DESIGN_THEME_ORDER);
  for (const p of EDUCATIONAL_TEMPLATE_RENDER_PROFILES) assert.ok(ids.has(p.rendererBaseTheme), p.id);
});

t('шаблон Студії перемикає й експорт Студії (designTheme); тема DesignCraft — ні', () => {
  const base = { designTheme: 'classic' as const, keep: 1 };
  const ed = applyBookDesignTheme(base, 'studio-editorial');
  assert.equal(ed.designTheme, 'editorial');
  assert.equal(ed.bookDesignThemeId, 'studio-editorial');
  assert.equal(ed.keep, 1);
  const cl = applyBookDesignTheme({ designTheme: 'editorial' as const }, 'studio-classic');
  assert.equal(cl.designTheme, 'classic');
  const sf = applyBookDesignTheme({ designTheme: 'editorial' as const }, 'sci-fi');
  assert.equal(sf.designTheme, 'editorial', 'тема DesignCraft не змінює оформлення експорту Студії');
  assert.equal(sf.bookDesignThemeId, 'sci-fi');
});

t('legacy designTheme однозначно відображається на шаблон Студії', () => {
  assert.equal(studioThemeForLegacy(undefined), 'studio-classic');
  assert.equal(studioThemeForLegacy('classic'), 'studio-classic');
  assert.equal(studioThemeForLegacy('editorial'), 'studio-editorial');
});

console.log(`Підсумок: ${passed} пройшло.`);
