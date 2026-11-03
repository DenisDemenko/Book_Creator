/**
 * Кнопка Jev на сервері: `POST /api/projects/:id/ai/jev-tags` із толерантністю 70–100%
 * і повтором для непроставлених (постановка власника 03.11.2026).
 *
 * ЧОМУ ЧЕРЕЗ HTTP. Правило порогу перевірено в `test-jevTags`; тут — те, що бачить
 * панель: що приймає й відхиляє маршрут, що повертає про вартість і як повтор із
 * нижчим порогом бере відповіді з пам'яті, а не платить удруге.
 *
 * Запуск: npm run test:jev-tags-route
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { registerProjectRoutes } from '../server/core/projectRoutes.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { MENTION_SUGGESTION } from '../server/core/ai/mentions.ts';
import { sharedJevAnswerCache } from '../server/core/ai/jevTags.ts';
import { decidedFromResponse } from '../src/utils/jevTolerance.ts';
import type { JevAdapter, JevRawAnswer } from '../server/ai/adapters/jev/index.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const repo = new MemoryCoreRepository();
await repo.upsertProject({ id: 'B1', ownerId: 'u-owner', title: 'Книга' });
await repo.upsertDocument({ projectId: 'B1', id: 's1', kind: 'section', order: 0 });
const PROBS: Record<string, number> = { Страх: 0.97, Радість: 0.88, Гнів: 0.74, Сумнів: 0.6 };
const TYPES: Record<string, string> = { Страх: 'emotion', Радість: 'emotion2', Гнів: 'emotion3', Сумнів: 'emotion4' };
for (const [i, text] of ['Перший абзац про страх.', 'Другий абзац.'].entries()) {
  await repo.upsertParagraph({ projectId: 'B1', id: `p${i + 1}`, documentId: 's1', order: i, kind: 'paragraph', text, editorPid: `pid${i + 1}` }, 'system:core_sync');
}
const findingIds: Record<string, string> = {};
for (const name of Object.keys(PROBS)) {
  const f = await repo.addFinding({
    projectId: 'B1',
    kind: MENTION_SUGGESTION,
    payload: { tag: `[/${TYPES[name]}:${name}]`, entityType: TYPES[name], entityName: name },
    sourceParagraphIds: ['p1'],
    createdBy: 'ai:AI-1',
  });
  findingIds[name] = f.id;
}

const calls: string[][] = [];
const adapter: JevAdapter = {
  name: 'mock',
  evaluate: async () => { throw new Error('не потрібне'); },
  askState: async (_state, questions): Promise<JevRawAnswer> => {
    calls.push(questions.map((q) => q.id));
    return {
      answers: Object.fromEntries(questions.map((q) => {
        const name = String(q.instructions).match(/«([^»]+)»/)?.[1] ?? '';
        return [q.id, { type: 'noul', noul: PROBS[name] ?? 0.1 }];
      })),
      model: 'jev-1.13.0',
      usage: { input_tokens: 2000, output_tokens: 0 },
      latency_ms: 1,
    };
  },
};

const access = {
  async getBookOwnerId(id: string) { return id === 'B1' ? 'u-owner' : null; },
  async getCollabOwnerId() { return undefined; },
  async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
};
const PRINCIPALS: Record<string, any> = {
  owner: { id: 'u-owner', role: 'writer', isGuest: false },
  reader: { id: 'u-reader', role: 'reader', isGuest: false },
};
const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as any).principal = PRINCIPALS[String(req.headers['x-test-user'] || 'owner')]; next(); });
let jevOn = true;
registerProjectRoutes(app, {
  access,
  repo: () => repo,
  coreState: () => 'ready',
  flc: { jev: async () => (jevOn ? adapter : null), llm: (() => async () => ({})) as any },
});
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const post = async (path: string, body: unknown, who = 'owner') => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': who }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const jev = (body: unknown, who?: string) => post('/api/projects/B1/ai/jev-tags', body, who);

console.log('\nТолерантність у запиті:');
sharedJevAnswerCache.clear();
{
  const bad = await jev({ sectionId: 's1', threshold: 0.4 });
  t('0,40 → 400 bad_threshold з межами', bad.status === 400 && bad.body.kind === 'bad_threshold' && bad.body.min === 0.7 && bad.body.max === 1, JSON.stringify(bad.body));
  t('до Jev при цьому не зверталися', calls.length === 0);
  t('1,5 → 400', (await jev({ sectionId: 's1', threshold: 1.5 })).status === 400);
  t('рядок замість числа → 400', (await jev({ sectionId: 's1', threshold: '0.9' })).status === 400);
  t('читач не може запускати', (await jev({ sectionId: 's1' }, 'reader')).status === 403);
  jevOn = false;
  t('без ключа Jev — 503', (await jev({ sectionId: 's1' })).status === 503);
  jevOn = true;
}

console.log('\nПрогін за 95% і повтор за нижчим порогом:');
{
  const first = await jev({ sectionId: 's1' });
  t('без threshold — типові 95%', first.status === 200 && first.body.threshold === 0.95, String(first.body.threshold));
  t('поставлено лише «Страх» (0,97)', first.body.tags.length === 1 && first.body.tags[0].entityName === 'Страх');
  const below = first.body.skipped.filter((x: any) => x.reason === 'below_threshold');
  t('решта три — below_threshold і з ймовірностями (для повтору в панелі)', below.length === 3 && below.every((x: any) => typeof x.probability === 'number'));
  t('4 питання до Jev, 0 з пам’яті', first.body.asked === 4 && first.body.fromCache === 0);
  t('вартість у відповіді: токени, $ за ставкою 0,042, бали-еквівалент, не списано',
    first.body.usage.inputTokens === 2000 && first.body.usage.usdPerMTok === 0.042 && Math.abs(first.body.usage.usd - 0.000084) < 1e-9 &&
    first.body.usage.creditsEquivalent === 1 && first.body.usage.charged === false, JSON.stringify(first.body.usage));

  // Панель читає відповідь тією самою функцією: з #493 вона шукала `d.id`, якого немає, і не підтверджувала нічого.
  const decided = decidedFromResponse(first.body);
  t('клієнт бере id висновку з findingId справжньої відповіді', decided.length === 1 && decided[0].id === findingIds['Страх'] && decided[0].tag === '[/emotion:Страх]' && decided[0].editorPid === 'pid1', JSON.stringify(decided));
  t('відповідь без тегів чи сміття — порожній список, а не виняток', decidedFromResponse(null).length === 0 && decidedFromResponse({ tags: 'x' }).length === 0 && decidedFromResponse({ tags: [{ id: 'old-shape' }] }).length === 0);

  // Автор підтверджує поставлене — як це робить панель.
  const conf = await post(`/api/projects/B1/suggestions/${decided[0].id}/confirm`, {});
  t('підтвердження поставленого тега', conf.status === 200, String(conf.status));

  const callsBefore = calls.length;
  const retry = await jev({ sectionId: 's1', threshold: 0.8 });
  t('повтор за 80%: у розгляді лише непроставлені (3), а Страх уже не питається', retry.body.paragraphs === 1 && retry.body.fromCache === 3 && retry.body.asked === 0, `${retry.body.asked}/${retry.body.fromCache}`);
  t('повтор не звертався до Jev і не рахує токенів', calls.length === callsBefore && retry.body.inputTokens === 0 && retry.body.usage.usd === 0 && retry.body.usage.creditsEquivalent === 0);
  t('за 80% додався «Радість» (0,88); «Гнів» 0,74 і «Сумнів» 0,6 лишились', retry.body.tags.length === 1 && retry.body.tags[0].entityName === 'Радість');

  const conf2 = await post(`/api/projects/B1/suggestions/${retry.body.tags[0].findingId}/confirm`, {});
  const retry70 = await jev({ sectionId: 's1', threshold: 0.7 });
  t('повтор за 70%: «Гнів» (0,74) проставляється, «Сумнів» (0,6) — ні', conf2.status === 200 && retry70.body.tags.length === 1 && retry70.body.tags[0].entityName === 'Гнів' && retry70.body.skipped.length === 1 && retry70.body.skipped[0].entityName === 'Сумнів');
  t('усе це без жодного нового запиту до Jev', calls.length === callsBefore);
}

server.close();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
