/**
 * Тести вибору ролей галочками при реєстрації (журнал #539).
 * Запуск: npm run test:role-choice
 *
 *  1. Чисті правила: перелік, головна роль, хто може обирати.
 *  2. Справжній маршрут POST /api/auth/roles з підставним принципалом і справжньою базою.
 *  3. Збереження ролей у SQLite (колонки roles / roles_chosen_at, повторне читання).
 */
const DIR = '/tmp/nova-role-choice-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const rc = await import('../server/roleChoice');
const store = await import('../server/store');
const auth = await import('../server/auth');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

console.log('\nПравила');
t('перелік без адміністратора й службових ролей', !(rc.REGISTRATION_ROLES as readonly string[]).includes('admin') && rc.REGISTRATION_ROLES.length === 5);
t('нормалізація: дублі прибираються, порядок за пріоритетом', JSON.stringify(rc.normalizeRegistrationRoles(['reader', 'writer', 'reader'])) === '["writer","reader"]');
t('порожньо, не масив, зайва роль — відмова', rc.normalizeRegistrationRoles([]) === null && rc.normalizeRegistrationRoles('writer') === null && rc.normalizeRegistrationRoles(['writer', 'admin']) === null && rc.normalizeRegistrationRoles(['seller']) === null && rc.normalizeRegistrationRoles([1]) === null);
t('головна роль — перша за пріоритетом', rc.primaryRegistrationRole(['publisher', 'designer'] as any) === 'publisher' && rc.primaryRegistrationRole(['designer', 'reader'] as any) === 'designer');
const now = Date.now();
const fresh = { role: 'writer', createdAt: new Date(now - 60_000).toISOString() } as any;
t('щойно створений із типовою роллю — можна', rc.canChooseRoles(fresh, now).ok === true);
t('уже обирав — ні', rc.canChooseRoles({ ...fresh, rolesChosenAt: new Date().toISOString() }, now).reason === 'already_chosen');
t('адмін — ні', rc.canChooseRoles({ ...fresh, role: 'admin' }, now).reason === 'admin');
t('роль не типова (видана маркетплейсом: reader) — ні', rc.canChooseRoles({ ...fresh, role: 'reader' }, now).reason === 'not_new');
t('обліковий запис старший за годину — ні', rc.canChooseRoles({ ...fresh, createdAt: new Date(now - 2 * 3600_000).toISOString() }, now).reason === 'not_new');

console.log('\nМаршрут POST /api/auth/roles');
const mk = async (id: string, over: Record<string, unknown> = {}) => {
  const u = { id, email: `${id}@test.ua`, name: id, role: 'writer', createdAt: new Date().toISOString(), ...over } as any;
  await store.saveUser(u);
  return u;
};
await mk('u-new');
await mk('u-old', { createdAt: new Date(Date.now() - 5 * 3600_000).toISOString() });
await mk('u-market', { role: 'reader' });
await mk('u-adm', { role: 'admin' });
const app = express();
app.use(express.json());
app.use(async (req: any, _res, next) => {
  const id = req.headers['x-test-user'];
  const u = typeof id === 'string' ? await store.findUserById(id) : null;
  req.principal = u ? { ...u, isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
auth.registerAuthRoutes(app);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const post = async (user: string | null, body: unknown) => {
  const res = await fetch(`${base}/api/auth/roles`, { method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json()) as any };
};

t('гість — 401', (await post(null, { roles: ['writer'] })).status === 401);
t('порожній вибір — 400', (await post('u-new', { roles: [] })).status === 400);
t('admin у переліку — 400 (ролі адміна не видаються)', (await post('u-new', { roles: ['admin'] })).status === 400);
const ok = await post('u-new', { roles: ['designer', 'translator'] });
t('щойно створений: 200, головна роль — дизайнер, ролі збережено', ok.status === 200 && ok.data.user.role === 'designer' && JSON.stringify(ok.data.user.roles) === '["designer","translator"]' && ok.data.user.rolesChosen === true, JSON.stringify(ok.data).slice(0, 200));
t('права відповідають новій ролі (дизайнер не редагує текст)', ok.data.permissions.canEditContent === false && ok.data.permissions.canGenerateImages === true);
const again = await post('u-new', { roles: ['writer'] });
t('вдруге — 409 already_chosen', again.status === 409 && again.data.kind === 'already_chosen');
const reread = await store.findUserById('u-new');
t('у базі: роль, ролі, час вибору', reread?.role === 'designer' && JSON.stringify(reread.roles) === '["designer","translator"]' && !!reread.rolesChosenAt);
t('старий обліковий запис — 409 not_new', (await post('u-old', { roles: ['writer'] })).data.kind === 'not_new');
const m = await post('u-market', { roles: ['publisher'] });
t('роль від маркетплейсу змінити не можна (не підвищити reader → publisher)', m.status === 409 && (await store.findUserById('u-market'))?.role === 'reader');
t('адмін — 409 admin, роль лишилась', (await post('u-adm', { roles: ['reader'] })).data.kind === 'admin' && (await store.findUserById('u-adm'))?.role === 'admin');
t('publicUser віддає roles і rolesChosen', (() => { const p = auth.publicUser(reread as any) as any; return Array.isArray(p.roles) && p.rolesChosen === true; })());
t('користувач без вибору: roles [] і rolesChosen false', (() => { const p = auth.publicUser({ id: 'x', email: 'x', name: 'x', role: 'writer', createdAt: '' } as any) as any; return p.roles.length === 0 && p.rolesChosen === false; })());

// З'єднання закриваємо до виходу: інакше на Windows процес часом падає на libuv-перевірці при завершенні.
(server as any).closeAllConnections?.();
await new Promise((r) => server.close(r));
db.closeDb();
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exitCode = fail ? 1 : 0;
