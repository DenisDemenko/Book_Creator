import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from 'playwright-core';

const baseUrl = process.env.BOOK_ACCEPTANCE_BASE_URL || 'http://127.0.0.1:3000';
const bookId = process.env.BOOK_ACCEPTANCE_BOOK_ID || 'BK-2084-CYBER';
const targetUrl = `${baseUrl}/projects/${encodeURIComponent(bookId)}/dashboard`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve('acceptance', `${bookId}-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

function browserExecutable() {
  const candidates = [
    process.env.BOOK_ACCEPTANCE_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const executablePath = browserExecutable();
if (!executablePath) {
  throw new Error('Не знайдено Edge/Chrome. Встановіть BOOK_ACCEPTANCE_BROWSER з повним шляхом до браузера.');
}

const profileDir = process.env.BOOK_ACCEPTANCE_PROFILE || path.join(os.tmpdir(), 'book-creator-acceptance-profile');
const context = await chromium.launchPersistentContext(profileDir, {
  executablePath,
  headless: false,
  viewport: { width: 1600, height: 1000 },
  args: ['--start-maximized'],
});
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(15_000);

const report = {
  startedAt: new Date().toISOString(),
  baseUrl,
  bookId,
  targetUrl,
  browserExecutable: executablePath,
  checks: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  api: {},
  stages: [],
};

const addCheck = (name, ok, details = {}) => report.checks.push({ name, ok, ...details });
const stage = (name, details = {}) => {
  const entry = { at: new Date().toISOString(), name, ...details };
  report.stages.push(entry);
  console.log('[acceptance]', name, JSON.stringify(details));
};
async function navigate(url) {
  stage('navigate-start', { url });
  try {
    const response = await page.goto(url, { waitUntil: 'commit', timeout: 20_000 });
    stage('navigate-committed', { status: response?.status(), url: page.url() });
  } catch (error) {
    stage('navigate-failed', { message: String(error), url: page.url() });
    const response = await page.request.get(url, { timeout: 15_000 }).catch(() => null);
    stage('http-probe', { status: response?.status() ?? null });
    if (!page.url().startsWith(baseUrl)) throw error;
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 25_000 }).catch((error) => {
    stage('domcontentloaded-timeout', { message: String(error), url: page.url() });
  });
  stage('navigate-ready', { url: page.url() });
}
page.on('console', (msg) => {
  if (msg.type() === 'error') report.consoleErrors.push(msg.text());
});
page.on('pageerror', (error) => report.pageErrors.push(String(error?.stack || error)));
page.on('requestfailed', (request) => {
  const url = request.url();
  if (!url.startsWith(baseUrl)) return;
  report.failedRequests.push({ url, method: request.method(), failure: request.failure()?.errorText || 'unknown' });
});
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('/api/pdf/author-preview/pagination')) {
    try {
      report.api.pagination = {
        status: response.status(),
        body: await response.json(),
      };
    } catch (error) {
      report.api.pagination = { status: response.status(), parseError: String(error) };
    }
  } else if (url.endsWith('/api/pdf/author-preview')) {
    report.api.pdfPreview = {
      status: response.status(),
      contentType: response.headers()['content-type'] || '',
      pages: response.headers()['x-pdf-pages'] || '',
      engine: response.headers()['x-pdf-engine'] || '',
      mappingLevel: response.headers()['x-pdf-mapping-level'] || '',
      authoritative: response.headers()['x-pdf-authoritative'] || '',
    };
  }
});

async function screenshot(name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true }).catch(() => {});
}

async function clickSection(names) {
  for (const name of names) {
    const candidates = [
      page.getByRole('button', { name: new RegExp(name, 'i') }),
      page.getByRole('link', { name: new RegExp(name, 'i') }),
      page.getByText(new RegExp(name, 'i'), { exact: false }),
      page.locator(`[aria-label*="${name}" i], [title*="${name}" i]`),
    ];
    for (const locator of candidates) {
      const first = locator.first();
      if (await first.count().catch(() => 0)) {
        try {
          await first.scrollIntoViewIfNeeded();
          await first.click({ timeout: 4_000 });
          await page.waitForTimeout(900);
          return { ok: true, label: name };
        } catch {}
      }
    }
  }
  return { ok: false, labels: names };
}

async function brokenImages() {
  return page.locator('img').evaluateAll((imgs) => imgs
    .filter((img) => !img.complete || img.naturalWidth === 0)
    .map((img) => ({ src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '' })));
}

try {
  await navigate(targetUrl);
  await page.waitForTimeout(2500);
  stage('dashboard-capture');
  await screenshot('00-dashboard-initial');

  const loginFormVisible = async () => {
    const passwordInputs = await page.locator('input[type="password"]').count();
    const loginButtons = await page.getByRole('button', { name: /Увійти|Продовжити з Google|Sign in|Log in/i }).count();
    return passwordInputs > 0 || loginButtons > 0;
  };
  const onBook = page.url().includes(`/projects/${bookId}/`) && !(await loginFormVisible());
  stage('auth-check', { url: page.url(), loginFormVisible: await loginFormVisible(), onBook });
  if (!onBook) {
    const rl = readline.createInterface({ input, output });
    console.log(`\nБраузер відкрито на: ${page.url()}`);
    console.log('Зараз відкрита сторінка авторизації. Авторизуйтеся в тестовому браузері вручну.');
    console.log('Не вводьте пароль у PowerShell і не надсилайте його разом зі звітом.');
    await rl.question('Коли побачите сторінку самої книги (а не форму входу), натисніть Enter... ');
    rl.close();
    if (await loginFormVisible()) {
      stage('auth-still-required');
      addCheck('authenticated-book-dashboard', false, { reason: 'Сторінка входу все ще відкрита.' });
      throw new Error('AUTH_REQUIRED: тест зупинено до перевірок Studio; повторіть після успішного входу.');
    }
    if (!page.url().includes(`/projects/${bookId}/`)) {
      await navigate(targetUrl);
      await page.waitForTimeout(2500);
    }
    if (await loginFormVisible()) {
      addCheck('authenticated-book-dashboard', false, { reason: 'Перехід до книги повернув на авторизацію.' });
      throw new Error('AUTH_REQUIRED: перехід до книги повернув на форму входу.');
    }
  }
  addCheck('project-route', page.url().includes(`/projects/${bookId}/`), { finalUrl: page.url() });
  addCheck('authenticated-book-dashboard', !(await loginFormVisible()), { url: page.url() });

  // PDF layout + authoritative export preview.
  stage('pdf-layout-start');
  const pdfNav = await clickSection(['Верстка PDF', 'PDF']);
  addCheck('navigate-pdf-layout', pdfNav.ok, pdfNav);
  await screenshot('10-pdf-layout');

  const authoritativeSurface = page.locator('[data-authoritative-pdf-preview]');
  addCheck('authoritative-preview-surface', await authoritativeSurface.count() > 0);

  const zoomValues = await page.locator('select').evaluateAll((selects) => selects.map((select) =>
    Array.from(select.options).map((option) => (option.textContent || '').trim())
  ).filter((options) => options.some((text) => text.includes('%'))));
  const expectedZoom = Array.from({ length: 15 }, (_, index) => `${(index + 1) * 10}%`);
  const matchingZoom = zoomValues.find((options) => expectedZoom.every((value) => options.includes(value)));
  addCheck('layout-zoom-10-150-step-10', Boolean(matchingZoom), { found: matchingZoom || zoomValues });

  const renderButton = page.getByRole('button', { name: /Створити точний PDF|Оновити точний PDF/i }).first();
  if (await renderButton.count()) {
    await renderButton.click();
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline && !report.api.pdfPreview) await page.waitForTimeout(500);
    while (Date.now() < deadline && !report.api.pagination) await page.waitForTimeout(500);
    const pdf = report.api.pdfPreview;
    addCheck('real-pdf-preview-http', Boolean(pdf && pdf.status === 200 && /application\/pdf/i.test(pdf.contentType)), { pdf });
    addCheck('real-pdf-preview-authoritative', pdf?.authoritative === '1', { pdf });
    const pagination = report.api.pagination;
    const p = pagination?.body?.pagination;
    addCheck('pagination-result', Boolean(pagination?.status === 200 && Array.isArray(p?.pageMap) && p?.totalPages > 0), {
      status: pagination?.status,
      totalPages: p?.totalPages,
      mappingLevel: p?.mappingLevel,
      exportAuthoritative: p?.exportAuthoritative,
    });
    if (pdf?.pages && p?.totalPages) {
      addCheck('pdf-pagination-pagecount-parity', Number(pdf.pages) === Number(p.totalPages), {
        pdfPages: Number(pdf.pages), paginationPages: Number(p.totalPages),
      });
    }
    if (Array.isArray(p?.pageMap) && p.pageMap.length >= 73) {
      const page73 = p.pageMap[72];
      addCheck('canonical-page-73', page73?.pageIndex === 72 && page73?.pageNumber === 73, { page73 });
    }
  } else {
    addCheck('real-pdf-preview-http', false, { reason: 'Кнопку точного PDF не знайдено.' });
  }
  await screenshot('11-pdf-authoritative-preview');

  // Book spread.
  stage('spread-start');
  const spreadNav = await clickSection(['Розворот книги', 'Розворот']);
  addCheck('navigate-book-spread', spreadNav.ok, spreadNav);
  await page.waitForTimeout(1200);
  const imgs = await page.locator('img').count();
  const broken = await brokenImages();
  addCheck('spread-images-not-broken', broken.length === 0, { imageCount: imgs, broken });
  const rangeCount = await page.locator('input[type="range"]').count();
  addCheck('spread-page-slider-present', rangeCount > 0, { rangeCount });
  await screenshot('20-book-spread');

  // Cover.
  stage('cover-start');
  const coverNav = await clickSection(['Обкладинка']);
  addCheck('navigate-cover', coverNav.ok, coverNav);
  await page.waitForTimeout(1000);
  const coverText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  addCheck('cover-physical-dimensions-visible', /(мм|cm|см|×|x)/i.test(coverText) && /обкладин/i.test(coverText));
  addCheck('cover-material-control-visible', /(матеріал|material|папер|paper)/i.test(coverText));
  addCheck('cover-back-front-spine-visible', /(BACK|задн)/i.test(coverText) && /(FRONT|передн)/i.test(coverText) && /(SPINE|корінец|корін)/i.test(coverText));
  const coverBroken = await brokenImages();
  addCheck('cover-images-not-broken', coverBroken.length === 0, { broken: coverBroken });
  await screenshot('30-cover');

  // Main text area, to ensure integration did not destroy authoring surface.
  stage('book-text-start');
  const textNav = await clickSection(['Книга та текст', 'Текст']);
  addCheck('navigate-book-text', textNav.ok, textNav);
  await page.waitForTimeout(800);
  const editableCount = await page.locator('textarea, [contenteditable="true"], input[type="text"]').count();
  addCheck('book-text-editing-surface-present', editableCount > 0, { editableCount });
  await screenshot('40-book-text');

} catch (error) {
  stage('fatal', { message: String(error) });
  report.fatalError = String(error?.stack || error);
  await screenshot('99-fatal');
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter((check) => check.ok).length,
    failed: report.checks.filter((check) => !check.ok).length,
    total: report.checks.length,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'FAILED.txt'), report.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${JSON.stringify(check)}`).join('\n'), 'utf8');
  console.log(`\nAcceptance report: ${path.join(outDir, 'report.json')}`);
  console.log(`PASS ${report.summary.passed}/${report.summary.total}; FAIL ${report.summary.failed}`);
  if (report.consoleErrors.length) console.log(`Console errors: ${report.consoleErrors.length}`);
  if (report.pageErrors.length) console.log(`Page errors: ${report.pageErrors.length}`);
  if (report.failedRequests.length) console.log(`Failed local requests: ${report.failedRequests.length}`);
  await context.close();
}
