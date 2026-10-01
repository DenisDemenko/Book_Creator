/**
 * Запрошення й учасники на реєстрі ролей — API (Т6.1 В3, `PLAN_COLLABORATION.md`;
 * рішення власника §2 п.1). Запуск: npm run test:collab-routes
 * (з CORE_TEST_DATABASE_URL — ще й учасники в ядрі; схема ядра в цій базі
 * видаляється — лише тестова база!).
 *
 *   • `GET /api/collaboration/roles` — ролі запрошення й довідники з реєстру;
 *   • запрошення приймає лише запрошувану роль реєстру; старе `reader` — бета-рідер;
 *   • перегляд і прийняття запрошення — простір Студії + id і назва ролі;
 *     прийняте запрошення → учасник проєкту з роллю (джерело — запрошення);
 *   • права до книги не змінились: бета-рідер читає, ілюстратор пише як дизайнер;
 *   • учасники: перелік, мої ролі, призначення й відкликання власником, автор — 403.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = path.join(os.tmpdir(), 'nova-collab-routes');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova.db`;
const PG = process.env.CORE_TEST_DATABASE_URL?.trim();
if (PG) process.env.CORE_DATABASE_URL = PG;
else delete process.env.CORE_DATABASE_URL;

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const { initStore, listCollabInvitesForBook, getBookOwner, findCollabInviteByToken } = await import('../server/store');
await initStore();
if (PG) {
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: PG });
  await pool.query('DROP SCHEMA IF EXISTS fusion_core CASCADE');
  await pool.end();
}
const core = await import('../server/core/index');
const status = await core.initCore(() => {});
const { registerCollaborationRoutes } = await import('../server/collaborationRoutes');
const { registerParticipantRoutes } = await import('../server/core/collaboration/routes');
const { resolveRealtimeAccess } = await import('../server/realtimeAuth');

const PEOPLE: Record<string, { id: string; email: string; role: string; name: string }> = {
  owner: { id: 'u-owner', email: 'owner@test.ua', role: 'writer', name: 'Олена' },
  maria: { id: 'u-maria', email: 'maria@test.ua', role: 'writer', name: 'Марія' },
  ivan: { id: 'u-ivan', email: 'ivan@test.ua', role: 'writer', name: 'Іван' },
  admin: { id: 'u-admin', email: 'admin@test.ua', role: 'admin', name: 'Адмін' },
  stranger: { id: 'u-stranger', email: 'x@test.ua', role: 'writer', name: 'Хтось' },
};
const accessDeps = {
  async getBookOwnerId() {
    return null;
  },
  async getCollabOwnerId(bookId: string) {
    return (await getBookOwner(bookId))?.ownerUserId;
  },
  async listAcceptedInvites(bookId: string) {
    return (await listCollabInvitesForBook(bookId)).filter((i) => i.status === 'accepted').map((i) => ({ acceptedUserId: i.acceptedUserId, role: i.role }));
  },
};
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const who = PEOPLE[String(req.headers['x-who'] ?? '')];
  (req as any).principal = who ? { ...who, isGuest: false } : { id: null, role: 'guest', email: '', name: '', isGuest: true };
  next();
});
registerCollaborationRoutes(app);
registerParticipantRoutes(app, { repo: core.getCoreRepository, access: accessDeps });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, p: string, who: keyof typeof PEOPLE | 'guest', body?: unknown) => {
  const res = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json', 'x-who': who }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const BOOK = 'BK-COLLAB-1';

try {
  console.log('Реєстр ролей через API:');
  const roles = await call('GET', '/api/collaboration/roles', 'maria');
  t('ролі запрошення, усі ролі й довідники — з реєстру (Onboarding №4)', roles.status === 200 && roles.body.invitable.length >= 15 && roles.body.roles.length === 35 && roles.body.categories.length === 7 && roles.body.projectTypes.some((p: any) => p.id === 'course'));
  t('кожна роль запрошення — з назвою uk/en, описом і простором Студії', roles.body.invitable.every((r: any) => r.label.uk && r.label.en && r.description?.uk && ['designer', 'publisher', 'translator', 'reader'].includes(r.studioRole)));
  t('без входу — 401', (await call('GET', '/api/collaboration/roles', 'guest')).status === 401);

  console.log('\nЗапрошення з ролями реєстру:');
  const bad = await call('POST', '/api/collaboration/invite', 'owner', { bookId: BOOK, bookTitle: 'Маяк', email: 'maria@test.ua', role: 'co_author' });
  t('співавтора запросити не можна (у 1.0 запрошення не ширшає за дизайнера/видавця/перекладача/читача)', bad.status === 400 && /Доступні:/.test(bad.body.error), bad.body.error);
  t('невідома роль — 400', (await call('POST', '/api/collaboration/invite', 'owner', { bookId: BOOK, email: 'maria@test.ua', role: 'pirate' })).status === 400);
  const inv = await call('POST', '/api/collaboration/invite', 'owner', { bookId: BOOK, bookTitle: 'Маяк', email: 'maria@test.ua', role: 'illustrator' });
  t('ілюстратор — нова роль із реєстру — запрошується', inv.status === 200 && inv.body.invite.role === 'illustrator', inv.body.error);
  const old = await call('POST', '/api/collaboration/invite', 'owner', { bookId: BOOK, bookTitle: 'Маяк', email: 'ivan@test.ua', role: 'reader' });
  t('старе значення reader зберігається як beta_reader', old.status === 200 && old.body.invite.role === 'beta_reader');
  const list = await call('GET', `/api/collaboration/invites?bookId=${BOOK}`, 'owner');
  t('список запрошень — з назвами ролей з реєстру', list.body.invites?.some((i: any) => i.roleId === 'illustrator' && i.roleLabel?.uk === 'Ілюстратор') && list.body.invites?.some((i: any) => i.roleLabel?.uk === 'Читач (бета-рідер)'));

  const token = (await findCollabInviteByToken(inv.body.invite.token))!.token;
  const view = await call('GET', `/api/collaboration/invite/${token}`, 'guest');
  t('перегляд запрошення: простір Студії designer, id і назва ролі', view.body.role === 'designer' && view.body.roleId === 'illustrator' && view.body.roleLabel?.uk === 'Ілюстратор', JSON.stringify(view.body));
  const acc = await call('POST', `/api/collaboration/invite/${token}/accept`, 'maria');
  t('прийнято: простір designer, роль illustrator', acc.status === 200 && acc.body.role === 'designer' && acc.body.roleId === 'illustrator');
  const acc2 = await call('POST', `/api/collaboration/invite/${old.body.invite.token}/accept`, 'ivan');
  t('бета-рідер: простір reader', acc2.body.role === 'reader' && acc2.body.roleId === 'beta_reader');

  console.log('\nПрава до книги не змінились (роль ≠ дозвіл):');
  const ra = await resolveRealtimeAccess({ id: 'u-maria', role: 'writer', isGuest: false }, BOOK, accessDeps as any);
  const rb = await resolveRealtimeAccess({ id: 'u-ivan', role: 'writer', isGuest: false }, BOOK, accessDeps as any);
  t('ілюстраторка пише в кімнаті книги (як дизайнер раніше); бета-рідер — лише читає', ra?.shared === true && ra.canWrite === true && rb?.shared === true && rb.canWrite === false);

  if (status.state === 'ready') {
    console.log('\nУчасники проєкту (ядро):');
    t('прийняте запрошення → учасник із роллю, джерело — запрошення', acc.body.participant?.roleId === 'illustrator' && acc2.body.participant?.roleId === 'beta_reader', JSON.stringify(acc.body.participant));
    const part = await call('GET', `/api/core/projects/${BOOK}/participants`, 'maria');
    const m = part.body.participants?.find((p: any) => p.participant.userId === 'u-maria');
    t('учасники видно учасниці; її роль — «Ілюстратор», джерело — запрошення', part.status === 200 && m?.roles?.[0]?.label?.uk === 'Ілюстратор' && m?.participant?.source === 'invitation');
    t('чужому — 403', (await call('GET', `/api/core/projects/${BOOK}/participants`, 'stranger')).status === 403);
    const me = await call('GET', `/api/core/projects/${BOOK}/participants/me`, 'ivan');
    t('мої ролі: бета-рідер, без права писати', me.body.roles?.join() === 'beta_reader' && me.body.access?.canWrite === false);
    const add = await call('POST', `/api/core/projects/${BOOK}/participants/roles`, 'owner', { userId: 'u-maria', roleId: 'cover_designer' });
    t('власник додає Марії другу роль — 201', add.status === 201 && add.body.role.roleId === 'cover_designer' && add.body.participant.source === 'invitation');
    t('учасниця сама ролей не призначає — 403', (await call('POST', `/api/core/projects/${BOOK}/participants/roles`, 'maria', { userId: 'u-maria', roleId: 'author' })).status === 403);
    t('фрілансер без спеціалізації — 422', (await call('POST', `/api/core/projects/${BOOK}/participants/roles`, 'owner', { userId: 'u-free', roleId: 'freelancer' })).status === 422);
    const fr = await call('POST', `/api/core/projects/${BOOK}/participants/roles`, 'owner', { userId: 'u-free', roleId: 'freelancer', specialization: 'translator' });
    t('фрілансер + перекладач — 201, джерело «вручну»', fr.status === 201 && fr.body.participant.source === 'manual');
    const del = await call('DELETE', `/api/core/projects/${BOOK}/participants/roles/${add.body.role.id}`, 'owner');
    t('відкликання — 200', del.status === 200 && del.body.role.status === 'revoked');
    const ev = await call('GET', `/api/core/projects/${BOOK}/participants/events`, 'owner');
    t('журнал участі — від імені людей', ev.status === 200 && ev.body.events.some((e: any) => e.action === 'role_revoked' && e.actor === 'user:u-owner') && ev.body.events.some((e: any) => e.action === 'role_assigned' && e.actor === 'user:u-maria'));
    t('перенесення project_members — лише адмін', (await call('POST', `/api/core/projects/${BOOK}/participants/import-legacy`, 'owner')).status === 403 && (await call('POST', `/api/core/projects/${BOOK}/participants/import-legacy`, 'admin')).status === 200);
  } else {
    console.log(`\nУчасники в ядрі: пропущено (ядро — ${status.state})`);
    t('без ядра запрошення все одно приймається, учасника немає', acc.status === 200 && acc.body.participant === null);
    t('учасники без ядра — 503', (await call('GET', `/api/core/projects/${BOOK}/participants`, 'maria')).status === 503);
  }
} finally {
  server.close();
  await core.shutdownCore().catch(() => {});
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
