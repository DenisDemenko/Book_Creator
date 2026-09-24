/**
 * Живий прогін доступу до WebSocket спільного редагування (Т0.1, журнал #242)
 * і права на маршрутах ШІ (Т0.2, журнал #243).
 * Запуск: npm run live:realtime-auth   (потрібен зібраний dist/server.mjs).
 *
 * Справжній сервер, справжні сокети, п'ять людей: власник книги, чужий
 * користувач, перекладач і читач за прийнятим запрошенням, гість без сесії.
 * Перевіряє те, що модульний тест бачити не може: що сервер реально закриває
 * з'єднання без квитка, що чужий не отримує книгу власника, що читач не може
 * її змінити, що повідомлення про іншу книгу ігноруються, що роль у
 * присутності не підробляється.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-realtime-auth');
const PORT = Number(process.env.REALTIME_AUTH_PORT || 34242);
const BASE = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}/ws`;
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { initStore, saveUser, createSession, createCollabInvite } = await import('../server/store');
const { saveBook } = await import('../server/bookStore');
await initStore();
const now = () => new Date().toISOString();
const tokens: Record<string, string> = {};
for (const [id, role] of [['u-owner', 'writer'], ['u-stranger', 'writer'], ['u-translator', 'writer'], ['u-reader', 'writer']] as const) {
  await saveUser({ id, email: `${id}@test.ua`, name: id, role, createdAt: now() } as any);
  tokens[id] = crypto.randomBytes(24).toString('hex');
  await createSession({ token: tokens[id], userId: id, createdAt: now(), expiresAt: new Date(Date.now() + 864e5).toISOString() });
}
const BOOK = 'BK-LIVE-RT';
await saveBook({ book: { id: BOOK, title: 'Книга власника', updatedAt: now(), chapters: [] }, ownerId: 'u-owner' });
for (const [uid, role] of [['u-translator', 'translator'], ['u-reader', 'reader']] as const) {
  await createCollabInvite({
    id: `inv-${uid}`, bookId: BOOK, bookTitle: 'Книга власника', inviterUserId: 'u-owner',
    inviteeEmail: `${uid}@test.ua`, role, token: `tok-${uid}`, status: 'accepted', emailSent: false,
    createdAt: now(), acceptedAt: now(), acceptedUserId: uid,
  } as any);
}

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => log.push(String(d)));
child.stderr.on('data', (d) => log.push(String(d)));
process.on('exit', () => { try { child.kill(); } catch { /* */ } });
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  try { up = (await fetch(`${BASE}/api/auth/status`)).ok; } catch { /* */ }
  if (!up) await sleep(500);
}
if (!up) { console.error(log.join('').slice(-2000)); process.exit(1); }

const ticket = async (uid: string | null, bookId = BOOK) => {
  const res = await fetch(`${BASE}/api/realtime/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: `nova_session=${tokens[uid]}` } : {}) },
    body: JSON.stringify({ bookId }),
  });
  return { status: res.status, body: res.ok ? await res.json() : null };
};

interface Client { ws: WebSocket; messages: any[]; closed: Promise<number>; }
const connect = (url: string): Promise<Client> => new Promise((resolve) => {
  const ws = new WebSocket(url);
  const messages: any[] = [];
  let closeResolve!: (c: number) => void;
  const closed = new Promise<number>((r) => { closeResolve = r; });
  ws.on('message', (d) => messages.push(JSON.parse(String(d))));
  ws.on('close', (code) => closeResolve(code));
  ws.on('open', () => resolve({ ws, messages, closed }));
  ws.on('error', () => resolve({ ws, messages, closed }));
});
const join = async (uid: string, extra: Record<string, unknown> = {}) => {
  const tk = await ticket(uid);
  const c = await connect(`${WS}?ticket=${encodeURIComponent(tk.body.ticket)}`);
  c.ws.send(JSON.stringify({ type: 'client:join', payload: { bookId: BOOK, user: { clientId: `c-${uid}`, userName: uid, role: 'admin' }, ...extra } }));
  await sleep(400);
  return c;
};
const last = (c: Client, type: string) => [...c.messages].reverse().find((m) => m.type === type);

console.log('\nБез квитка й без сесії:');
{
  const bare = await connect(WS);
  const code = await Promise.race([bare.closed, sleep(3000).then(() => -1)]);
  t('сокет без квитка сервер закриває (4401)', code === 4401, String(code));
  const guest = await ticket(null);
  t('гість не отримує квитка (401)', guest.status === 401, String(guest.status));
  const info = await fetch(`${BASE}/api/rooms/${BOOK}/info`);
  t('REST кімнати без сесії — 401', info.status === 401, String(info.status));
}

console.log('\nВласник і чужий користувач:');
const owner = await join('u-owner', { initialBook: { id: BOOK, title: 'Книга власника', updatedAt: now(), chapters: [] } });
t('власник у кімнаті отримує room:sync', !!last(owner, 'room:sync'));
const tkStranger = await ticket('u-stranger');
t('чужому дають лише приватну кімнату', tkStranger.body?.shared === false, JSON.stringify({ shared: tkStranger.body?.shared }));
const stranger = await join('u-stranger');
t('чужий НЕ бачить книги власника', last(stranger, 'room:sync')?.payload?.book == null);
t('чужого немає в присутності власника',
  !JSON.stringify(last(owner, 'presence:update')?.payload?.presenceList || []).includes('u-stranger'));

console.log('\nЗапрошені:');
const translator = await join('u-translator');
const syncT = last(translator, 'room:sync');
t('перекладач (запрошення) бачить книгу власника', syncT?.payload?.book?.title === 'Книга власника');
const me = (syncT?.payload?.presenceList || []).find((p: any) => p.userId === 'u-translator');
t('роль у присутності — із запрошення, а не з повідомлення (клієнт казав «admin»)', me?.role === 'translator', me?.role);

const reader = await join('u-reader');
t('читач бачить книгу', last(reader, 'room:sync')?.payload?.canWrite === false && !!last(reader, 'room:sync')?.payload?.book);
const before = owner.messages.length;
reader.ws.send(JSON.stringify({ type: 'book:update', payload: { bookId: BOOK, updatedBook: { id: BOOK, title: 'ЗЛАМАНО', updatedAt: new Date(Date.now() + 60_000).toISOString(), chapters: [] } } }));
reader.ws.send(JSON.stringify({ type: 'section:patch', payload: { bookId: BOOK, patch: { chapterId: 'c', sectionId: 's', content: 'x' } } }));
await sleep(500);
t('правки читача ніхто не отримує', !owner.messages.slice(before).some((m) => m.type === 'book:remote_update' || m.type === 'section:remote_patch'));

console.log('\nПовідомлення про іншу книгу:');
const beforeT = translator.messages.length;
owner.ws.send(JSON.stringify({ type: 'section:patch', payload: { bookId: 'BK-OTHER', patch: { chapterId: 'c', sectionId: 's', content: 'x' } } }));
owner.ws.send(JSON.stringify({ type: 'chat:send', payload: { bookId: 'BK-OTHER', text: 'привіт' } }));
await sleep(500);
t('правка й чат з чужим bookId ігноруються', !translator.messages.slice(beforeT).some((m) => m.type === 'section:remote_patch' || m.type === 'chat:message'));
owner.ws.send(JSON.stringify({ type: 'section:patch', payload: { bookId: BOOK, patch: { chapterId: 'c', sectionId: 's', content: 'x' } } }));
await sleep(500);
t('а своя правка доходить до перекладача', translator.messages.slice(beforeT).some((m) => m.type === 'section:remote_patch'));

console.log('\nКвиток і книга в join:');
{
  const tk = await ticket('u-owner');
  const a = await connect(`${WS}?ticket=${encodeURIComponent(tk.body.ticket)}`);
  const b = await connect(`${WS}?ticket=${encodeURIComponent(tk.body.ticket)}`);
  const codeB = await Promise.race([b.closed, sleep(3000).then(() => -1)]);
  t('той самий квиток удруге не пускає (4401)', codeB === 4401, String(codeB));
  a.ws.send(JSON.stringify({ type: 'client:join', payload: { bookId: 'BK-OTHER', user: { clientId: 'x' } } }));
  const codeA = await Promise.race([a.closed, sleep(3000).then(() => -1)]);
  t('вхід з іншим bookId, ніж у квитку, — закриття 4403', codeA === 4403, String(codeA));
}

console.log('\nМаршрути ШІ без права (Т0.2):');
for (const route of [
  'translate', 'coach-feedback', 'generate-exercise', 'analyze-emotional-arc',
  // решта 19, закритих за рішенням власника (журнал #243)
  'edit-text', 'check-grammar', 'analyze-scene', 'craft-character-prompt', 'generate-character',
  'elaborate-instruction-steps', 'generate-behavior-patterns', 'generate-skandhas', 'generate-skandha-cycle',
  'craft-illustration-prompt', 'generate-prompt', 'generate-cover', 'evaluate-skill-task', 'generate-blueprint',
  'knowledge-quote', 'evaluate-trainer', 'structure-suggest-title', 'assistant-chat', 'diagnostic-assessment',
]) {
  const guest = await fetch(`${BASE}/api/ai/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const writer = await fetch(`${BASE}/api/ai/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `nova_session=${tokens['u-owner']}` },
    body: '{}',
  });
  t(`/api/ai/${route}: гість — 403, автор — пропущено далі`, guest.status === 403 && writer.status !== 403, `${guest.status} / ${writer.status}`);
}

for (const c of [owner, stranger, translator, reader]) c.ws.close();
child.kill();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.error(log.join('').slice(-1500)); process.exit(1); }
