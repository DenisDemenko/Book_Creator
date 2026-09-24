/**
 * Доступ до WebSocket спільного редагування — правила кімнат і квиток
 * (`server/realtimeAuth.ts`, задача Т0.1, журнал #242).
 *
 * Живий прогін із справжнім сервером і сокетами — `live:realtime-auth`.
 * Запуск: npm run test:realtime-auth
 */
import {
  resolveRealtimeAccess,
  issueRealtimeTicket,
  verifyRealtimeTicket,
  ticketFromUrl,
  isValidBookId,
  TICKET_TTL_MS,
  type RealtimeAccessDeps,
} from '../server/realtimeAuth.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const deps = (o: { bookOwner?: string | null; collabOwner?: string; invites?: { acceptedUserId?: string; role: string }[] }): RealtimeAccessDeps => ({
  getBookOwnerId: async () => o.bookOwner ?? null,
  getCollabOwnerId: async () => o.collabOwner,
  listAcceptedInvites: async () => o.invites ?? [],
});
const user = (id: string, role = 'writer') => ({ id, role, isGuest: false });

console.log('\nХто в якій кімнаті:');
{
  t('гість — без доступу', (await resolveRealtimeAccess({ id: null, role: 'guest', isGuest: true }, 'BK-1', deps({}))) === null);
  t('некоректний id книги — без доступу', (await resolveRealtimeAccess(user('a'), 'bad id:1', deps({}))) === null);

  const owner = await resolveRealtimeAccess(user('a'), 'BK-1', deps({ bookOwner: 'a' }));
  t('власник серверної копії — спільна кімната, пише', owner?.roomKey === 'book:BK-1' && owner.canWrite && owner.shared);

  const stranger = await resolveRealtimeAccess(user('b'), 'BK-1', deps({ bookOwner: 'a' }));
  t('чужий користувач — лише приватна кімната', stranger?.roomKey === 'private:b:BK-1' && !stranger.shared);

  const demoA = await resolveRealtimeAccess(user('a'), 'BK-2084-CYBER', deps({ bookOwner: 'a', collabOwner: 'c' }));
  const demoC = await resolveRealtimeAccess(user('c'), 'BK-2084-CYBER', deps({ bookOwner: 'a', collabOwner: 'c' }));
  t('два «власники» однакового id (демо) не потрапляють в одну кімнату',
    demoA?.roomKey !== demoC?.roomKey && demoC?.roomKey === 'book:BK-2084-CYBER', `${demoA?.roomKey} / ${demoC?.roomKey}`);

  const invited = await resolveRealtimeAccess(user('d', 'writer'), 'BK-1', deps({ bookOwner: 'a', invites: [{ acceptedUserId: 'd', role: 'translator' }] }));
  t('прийняте запрошення — спільна кімната, роль із запрошення', invited?.roomKey === 'book:BK-1' && invited.role === 'translator' && invited.canWrite);

  const reader = await resolveRealtimeAccess(user('r'), 'BK-1', deps({ bookOwner: 'a', invites: [{ acceptedUserId: 'r', role: 'reader' }] }));
  t('читач — у спільній кімнаті, але без права писати', reader?.shared === true && reader.canWrite === false);

  const clientRole = await resolveRealtimeAccess(user('r', 'admin'), 'BK-1', deps({ bookOwner: 'a', invites: [{ acceptedUserId: 'r', role: 'reader' }] }));
  t('роль у кімнаті — із запрошення, а не з акаунта чи клієнта', clientRole?.role === 'reader' && clientRole.canWrite === false);

  const noOwner = await resolveRealtimeAccess(user('a'), 'BK-NEW', deps({}));
  t('книга без власника на сервері — приватна кімната автора', noOwner?.roomKey === 'private:a:BK-NEW');
}

console.log('\nКвиток:');
{
  const access = (await resolveRealtimeAccess(user('a'), 'BK-1', deps({ bookOwner: 'a' })))!;
  const ticket = issueRealtimeTicket(access);
  const first = verifyRealtimeTicket(ticket);
  t('чинний квиток приймається й несе доступ', first?.roomKey === 'book:BK-1' && first.userId === 'a');
  t('той самий квиток удруге — ні', verifyRealtimeTicket(ticket) === null);

  const tampered = issueRealtimeTicket(access);
  const [body, mac] = tampered.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), roomKey: 'book:BK-OTHER', bookId: 'BK-OTHER' })).toString('base64url');
  t('підмінений вміст із старим підписом — ні', verifyRealtimeTicket(`${forged}.${mac}`) === null);

  const old = issueRealtimeTicket(access, Date.now() - TICKET_TTL_MS - 1000);
  t('прострочений — ні', verifyRealtimeTicket(old) === null);
  t('сміття — ні', verifyRealtimeTicket('abc') === null && verifyRealtimeTicket(undefined) === null);

  t('квиток з адреси', ticketFromUrl('/ws?ticket=abc.def') === 'abc.def' && ticketFromUrl('/ws') === null);
  t('перевірка id книги', isValidBookId('BK-2084-CYBER') && !isValidBookId('') && !isValidBookId('a b') && !isValidBookId('x'.repeat(300)));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
