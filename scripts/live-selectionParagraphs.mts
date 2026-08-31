/**
 * ЖИВИЙ димовий прогін «Абзац за виділеним фрагментом» — справжній запит до
 * моделі, без мокапів. Запуск: npm run live:selection
 *
 * Свідомо НЕ входить у `npm test`: тести мають бути детермінованими й
 * працювати без ключів і мережі, а тут і те, і те обовʼязкове. Це
 * інструмент перевірки «чи справді фіча дає текст», а не регресійний тест.
 *
 * Прохід повторює маршрут server.ts::/api/ai/generate-paragraphs-from-selection
 * крок у крок: шаблон із реєстру ядра → підстановка → той самий
 * generateText(), яким ходить решта сайту.
 */
const DIR = '/tmp/nova-live-selection';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import 'dotenv/config';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const { initStore } = await import('../server/store.ts');
const { resolveCoreTemplate, renderCoreTemplate } = await import('../server/coreAiRegistry.ts');
const { resolveModuleModelId, setCoreModuleModel } = await import('../server/coreModuleModels.ts');
const { generateText } = await import('../server/aiCore.ts');
const { resolveEngine: resolveChatEngine, engineConfigured, ENGINE_LABELS } = await import('../server/chatProviders.ts');

await initStore();

const SELECTION = [
  'Скляні куполи Верхнього Печерська відбивали перші промені холодного серпневого сонця,',
  'перетворюючи неоновий горизонт Нео-Києва на мерехтливу призму. Олена стояла біля панорамного',
  'вікна лабораторії на 84-му поверсі, спостерігаючи, як автоматичні вантажні аеродрони креслять',
  'білі лінії над куполами древніх соборів, закутих у захисні титанові саркофаги.',
].join(' ');

// Адмінська прив'язка модуля до моделі — та сама, що задається в панелі.
const wantedModel = process.argv[2] || 'claude-sonnet-5';
await setCoreModuleModel('selectionToParagraphs', wantedModel);

const modelId = (await resolveModuleModelId('selectionToParagraphs')) || '';
const engine = resolveChatEngine(modelId);

console.log(`\nМодуль: selectionToParagraphs`);
console.log(`Модель за прив'язкою адміна: ${modelId} (рушій ${engine} — ${ENGINE_LABELS[engine]})`);
console.log(`Ключ рушія налаштований: ${engineConfigured(engine) ? 'так' : 'НІ'}`);

if (!engineConfigured(engine)) {
  console.error('\nБез ключа цього рушія прогін неможливий. Додайте його в .env і повторіть.');
  process.exit(1);
}

const template = resolveCoreTemplate('selectionToParagraphs');
const rendered = renderCoreTemplate('selectionToParagraphs', template, {
  selection: SELECTION,
  language: 'uk',
  paragraphCount: '2',
  bookTitle: 'Тіні Нео-Києва',
  genre: 'кіберпанк',
  chapterTitle: 'Глава 1: Скляний світанок над Дніпром',
  contextAfter: 'Двері лабораторії рипнули за її спиною.',
});

console.log(`\nДовжина промту: ${rendered.user.length} символів`);
console.log('--- перші 300 символів промту ---');
console.log(rendered.user.slice(0, 300) + '…\n');

const started = Date.now();
const result = await generateText({
  engine,
  modelId,
  prompt: rendered.user,
  systemInstruction: rendered.system,
  label: 'Живий прогін: абзац за виділенням',
} as any);

const seconds = ((Date.now() - started) / 1000).toFixed(1);
const paragraphs = result.text.trim().split(/\n{2,}/).filter(Boolean);

console.log(`--- ВІДПОВІДЬ МОДЕЛІ (${seconds} с, ${result.inputTokens}→${result.outputTokens} токенів) ---\n`);
console.log(result.text.trim());

console.log('\n--- ПЕРЕВІРКИ ---');
const checks: [string, boolean][] = [
  ['текст непорожній', result.text.trim().length > 100],
  ['рівно 2 абзаци, як просив промт', paragraphs.length === 2],
  ['без службових заголовків', !/^#{1,6}\s/m.test(result.text)],
  ['без маркованих списків', !/^\s*[-*]\s/m.test(result.text)],
  ['не переказ виділення дослівно', !result.text.includes(SELECTION.slice(0, 60))],
  ['токени порахувались для обліку витрат', result.inputTokens > 0 && result.outputTokens > 0],
];
let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
}

console.log(`\nПідсумок: ${checks.length - bad} з ${checks.length} перевірок пройдено.`);
process.exit(bad > 0 ? 1 : 0);
