/** Actual styled App plus controlled local image responses; no production credentials or AI. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { wizardHarness } from './lib/wizardHarness.mts';
import { buildStarterBook } from '../src/utils/starterBook';
const h = await wizardHarness();
const art = '/tmp/preview-media-ui'; await fs.mkdir(art, { recursive: true });
const users = await import('../server/store'), books = await import('../server/bookStore');
await users.saveUser({ id: 'writer', email: 'writer@example.test', name: 'Автор тесту', role: 'writer', createdAt: new Date().toISOString() });
const base = buildStarterBook({ bookId: 'media-ui-book', role: 'writer', title: 'Острів світла', author: 'Автор тесту', now: 0 });
const sectionId = base.chapters[0].sections[0].id;
const book = { ...base, illustrations: [{ id: 'photo', url: '/api/probe-media/portrait.svg', caption: 'Вежа біля моря', sectionId }], chapters: [{
  ...base.chapters[0], title: 'Біля вежі', sections: [{ ...base.chapters[0].sections[0], title: 'Берег', content: '[IMG: photo "Вежа біля моря" wrap=left width=42mm]\n\n' + ('Над морем сходило сонце. Кам’яна стежка вела до вежі. ').repeat(10) }],
}] };
Object.assign(book.layoutConfig.frontMatter, { showTitlePage: false, showCopyright: false, showDedication: false, showEpigraph: false, showTableOfContents: false });
await books.saveBook({ ownerId: 'writer', book: book as any });
h.app.get('/api/auth/me', (_q, r) => r.json({ user: { id: 'writer', email: 'writer@example.test', name: 'Автор тесту', role: 'writer', disabled: false, isGuest: false }, permissions: { canPublish: true, canEditContent: true, canUseAi: true }, firebaseEnabled: false }));
h.app.get('/api/core/onboarding/gate', (_q, r) => r.json({ enabled: false, required: false, sharedCourses: [] }));
h.app.get('/api/core/projects/:id/my-role', (q, r) => r.json({ projectId: q.params.id, projectType: 'book', isOwner: true, isAdmin: false, participant: null, roles: [], workspaces: [], activeWorkspace: null, aiAssistance: [], roleDetails: {}, pending: { role: null, access: null } }));
h.app.get('/api/probe-media/:file', async (q, r) => {
  const file = q.params.file;
  if (file === 'broken.svg') { r.status(404).end(); return; }
  const delay = file === 'slow.svg' ? 700 : file === 'late.svg' ? 1800 : 0;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  if (r.destroyed) return;
  r.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="550" viewBox="0 0 600 550"><rect width="600" height="550" fill="#a9d5dc"/><path d="M0 300Q150 240 300 300T600 300V550H0" fill="#148c9c"/><path d="M0 550L400 180 600 550" fill="#4c8b68"/><path d="M300 130h120v260H300z" fill="#d9c4a1"/><path d="M285 130L360 50 435 130" fill="#36495c"/><path d="M335 220h50v90h-50" fill="#243b50"/></svg>');
});
h.app.use('/api', (_q, r) => r.status(404).json({ error: 'Outside isolated preview test' }));
process.env.DISABLE_HMR = 'true';
const { createServer } = await import('vite');
const vite = await createServer({ base: '/studio/', server: { middlewareMode: { server: h.server }, hmr: { server: h.server } }, define: {
  'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify('visual-test-public-configuration'),
  'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify('localhost'),
  'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify('visual-fixture'),
} });
h.app.use(vite.middlewares);
const { launch } = await import('puppeteer-core');
const browser = await launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, protocolTimeout: 90000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const checks: string[] = [], errors: string[] = [], shots: string[] = [];
try {
  const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 1100 });
  await p.setRequestInterception(true);
  p.on('request', r => { const u = new URL(r.url()); if (u.origin === h.origin || ['data:', 'blob:'].includes(u.protocol)) void r.continue(); else void r.abort(); });
  p.on('pageerror', e => errors.push(String(e)));
  await p.evaluateOnNewDocument(b => {
    localStorage.setItem('nova_glass_book', JSON.stringify(b)); localStorage.setItem('nova_glass_user_role', 'writer');
    localStorage.setItem('nova_theme', 'dark'); localStorage.setItem('nova_guest_dismissed_login', '1');
    localStorage.setItem('nova_tour_disabled_writer', '1'); localStorage.setItem('nova_tour_disabled_anon', '1');
  }, book);
  await p.goto(h.origin + '/studio/projects/' + book.id + '/preview', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-book-preview]', { timeout: 90000 });
  await p.waitForFunction(() => document.querySelector('[data-preview-status]')?.textContent?.includes('Орієнтовна'));
  const probe = await p.evaluate(async () => {
    const m = await import(location.origin + '/studio/scripts/lib/previewMediaBrowser.ts');
    return m.previewMediaProbe();
  });
  checks.push(...probe);
  const images = await p.$$eval('[data-book-preview] img', es => es.map(e => ({ src: e.getAttribute('src'), loaded: (e as HTMLImageElement).naturalWidth > 0 })));
  assert.equal(images.filter(i => i.src?.includes('portrait.svg')).length, 1);
  assert.ok(images.every(i => i.loaded)); checks.push('Actual App renders a marker photo once, fully loaded');
  for (const width of [1440, 390]) {
    await p.setViewport({ width, height: 1100 });
    if (width < 600) {
      const collapse = await p.$('[aria-label="Згорнути меню"]');
      if (collapse) await collapse.click();
    }
    const layout = await p.evaluate(() => ({ shell: !!document.querySelector('.app-shell-root header'), backdrop: !!document.querySelector('.studio-backdrop'), width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(layout.shell && layout.backdrop); assert.ok(layout.scroll <= layout.width + 1, JSON.stringify(layout));
    const previewBounds = await p.$eval('[data-book-preview]', el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width }));
    assert.ok(previewBounds.width > 250 && previewBounds.right <= width + 1, JSON.stringify(previewBounds));
    await p.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('main').forEach(e => e.scrollTop = 0); });
    const name = 'spread-media-' + width + '.png';
    await p.screenshot({ path: path.join(art, name), fullPage: true }); shots.push(name);
    checks.push('Styled App at ' + width + 'px without document overflow');
  }
  assert.deepEqual(errors, []); checks.push('No browser JavaScript errors');
  await fs.writeFile(path.join(art, 'report.json'), JSON.stringify({ mode: 'Real App/CSS + controlled slow/broken image routes; identity fixture', productionAcceptance: false, checks, shots, errors }, null, 2));
  checks.forEach(c => console.log('✓ ' + c));
  console.log('Підсумок: ' + checks.length + ' перевірок, ' + shots.length + ' екрани.');
} catch (e) {
  for (const p of await browser.pages()) { try { await p.screenshot({ path: path.join(art, 'failure.png'), fullPage: true }); console.error((await p.evaluate(() => document.body.innerText)).slice(-2000)); } catch {} }
  console.error(errors); throw e;
} finally { await browser.close(); await vite.close(); await h.close(); }
