/** Тести автентифікації, тарифів і обліку витрат. Запуск: npm run test:auth */
process.env.DATA_DIR = '/tmp/nova-test-data';
import fs from 'node:fs';
fs.rmSync('/tmp/nova-test-data', { recursive: true, force: true });

// Імпорти динамічні: інакше ESM підняв би їх вище за присвоєння DATA_DIR,
// і тест писав би у бойову теку даних замість тимчасової.
const { BASE_SERVER_PERMISSIONS, findOrCreateFromFirebase, ADMIN_EMAIL, novaRoleForMarketplaceRole } = await import('../server/auth');
const { priceForImage, priceForText, IMAGE_PRICING, pricingSnapshot } = await import('../server/pricing');
const { recordUsage, listUsage, saveUser, findUserByEmail, findUserByFirebaseUid, deleteUser, setRoleOverride, getRoleOverrides, resetRoleOverrides } = await import('../server/store');

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('Базові дозволи:');
t('гість не генерує', BASE_SERVER_PERMISSIONS.guest.canGenerateImages === false);
t('читач не генерує', BASE_SERVER_PERMISSIONS.reader.canGenerateImages === false);
t('письменник генерує', BASE_SERVER_PERMISSIONS.writer.canGenerateImages === true);
t('адмін генерує', BASE_SERVER_PERMISSIONS.admin.canGenerateImages === true);

console.log('\nТарифи (звірка з опублікованими цінами Google):');
t('Lite 1K = $0.0336', priceForImage('nano-banana-2-lite', '1K') === 0.0336);
t('Nano Banana 2, 1K = $0.067', priceForImage('nano-banana-2', '1K') === 0.067);
t('Nano Banana 2, 2K = $0.101', priceForImage('nano-banana-2', '2K') === 0.101);
t('Nano Banana 2, 4K = $0.151', priceForImage('nano-banana-2', '4K') === 0.151);
t('Pro 2K = $0.134', priceForImage('nano-banana-pro', '2K') === 0.134);
t('Pro 4K = $0.24', priceForImage('nano-banana-pro', '4K') === 0.24);
t('Lite при запиті 2K падає на єдиний наявний тариф', priceForImage('nano-banana-2-lite', '2K') === 0.0336);
t('невідомий двигун → 0, а не NaN', priceForImage('midjourney', '2K') === 0);
t('текст: 1 млн вх + 1 млн вих', Math.abs(priceForText(1e6, 1e6) - 4.5) < 1e-9, String(priceForText(1e6, 1e6)));
t('прайс містить 4 двигуни (+ Seedream)', pricingSnapshot().images.length === 4);
t('Seedream 1K = $0.03', priceForImage('seedream', '1K') === 0.03);
t('Seedream без тарифу на 4K падає на єдиний наявний (1K)', priceForImage('seedream', '4K') === 0.03);

console.log('\nЖурнал витрат і агрегація:');
{
  const mk = (email: string, engine: string, size: string, ok: boolean) => ({
    id: `u-${Math.random()}`, timestamp: new Date().toISOString(),
    userId: email, userEmail: email, role: 'writer' as const, kind: 'image' as const,
    engineId: engine, modelId: IMAGE_PRICING[engine]?.modelId || '?', imageSize: size,
    costUsd: ok ? priceForImage(engine, size) : 0, success: ok,
  });
  await recordUsage(mk('a@x.com', 'nano-banana-2', '2K', true));
  await recordUsage(mk('a@x.com', 'nano-banana-2', '2K', true));
  await recordUsage(mk('b@x.com', 'nano-banana-pro', '4K', true));
  await recordUsage(mk('b@x.com', 'nano-banana-pro', '4K', false));

  const all = await listUsage();
  t('записалося 4 факти', all.length === 4, String(all.length));
  const total = all.filter(r => r.success).reduce((s, r) => s + r.costUsd, 0);
  t('сума = 0.101*2 + 0.24 = 0.442', Math.abs(total - 0.442) < 1e-9, total.toFixed(4));
  t('невдала спроба коштує 0', all.find(r => !r.success)!.costUsd === 0);
  const aCost = all.filter(r => r.userEmail === 'a@x.com' && r.success).reduce((s, r) => s + r.costUsd, 0);
  t('витрати a@x.com = 0.202', Math.abs(aCost - 0.202) < 1e-9, aCost.toFixed(4));
}

console.log('\nПерсистентність користувачів:');
{
  const u = { id: 'u1', email: 'p@x.com', name: 'П', role: 'writer' as const, createdAt: new Date().toISOString() };
  await saveUser(u);
  t('знайдено за поштою', (await findUserByEmail('p@x.com'))?.id === 'u1');
  t('пошук нечутливий до регістру', (await findUserByEmail('P@X.COM'))?.id === 'u1');
  await saveUser({ ...u, role: 'designer' });
  t('оновлення не дублює запис', (await findUserByEmail('p@x.com'))?.role === 'designer');
  t('видалення працює', (await deleteUser('u1')) === true);
  t('після видалення не знаходиться', (await findUserByEmail('p@x.com')) === undefined);
}

console.log('\nПеревизначення ролей:');
{
  await setRoleOverride('guest', { canGenerateImages: true });
  t('перевизначення збережено', (await getRoleOverrides()).guest?.canGenerateImages === true);
  await resetRoleOverrides('guest');
  t('скидання прибирає перевизначення', (await getRoleOverrides()).guest === undefined);
}

// docs/migration-plan.md Фаза G1: Firebase замінила власні паролі. Ці тести
// не торкаються справжнього Firebase (verifyFirebaseIdToken лишається
// неперевіреним тут — йому потрібен живий проєкт) — вони перевіряють саме
// логіку findOrCreateFromFirebase, тобто те, як уже ВЕРИФІКОВАНИЙ токен
// перетворюється на локального користувача, включно з межею безпеки
// навколо привʼязки за поштою.
console.log('\nFirebase → локальний користувач:');
{
  const fakeToken = (overrides: Partial<{ uid: string; email: string; emailVerified: boolean; name?: string }>) => ({
    uid: 'uid-1', email: 'nova-user@x.com', emailVerified: true, ...overrides,
  });

  const created = await findOrCreateFromFirebase(fakeToken({}));
  t('новий користувач створюється', !!created.user);
  t('нового користувача записано з firebaseUid', created.user?.firebaseUid === 'uid-1');
  t('роль за замовчуванням — writer', created.user?.role === 'writer');

  const again = await findOrCreateFromFirebase(fakeToken({}));
  t('повторний вхід тим самим uid знаходить того самого користувача', again.user?.id === created.user?.id);

  const otherUidSameEmail = await findOrCreateFromFirebase(
    fakeToken({ uid: 'uid-2', emailVerified: false })
  );
  t(
    'інший uid з тією самою поштою, але БЕЗ verified — відмова, не тихе злиття',
    !!otherUidSameEmail.error
  );

  await saveUser({
    id: 'legacy-1', email: 'legacy@x.com', name: 'Старий', role: 'designer',
    passwordHash: 'scrypt$deadbeef$deadbeef', createdAt: new Date().toISOString(),
  });
  const linked = await findOrCreateFromFirebase(
    fakeToken({ uid: 'uid-legacy', email: 'legacy@x.com', emailVerified: true })
  );
  t('верифікована пошта привʼязує наявний доFirebase акаунт', linked.user?.id === 'legacy-1');
  t('привʼязка успадковує роль наявного акаунту', linked.user?.role === 'designer');
  t('привʼязка записує firebaseUid у наявний рядок', (await findUserByFirebaseUid('uid-legacy'))?.id === 'legacy-1');

  const hijackAttempt = await findOrCreateFromFirebase(
    fakeToken({ uid: 'uid-attacker', email: 'legacy@x.com', emailVerified: false })
  );
  t(
    'непідтверджена пошта не краде вже привʼязаний акаунт',
    !!hijackAttempt.error
  );

  await saveUser({
    id: 'admin-seed', email: ADMIN_EMAIL, name: 'Адмін', role: 'writer',
    createdAt: new Date().toISOString(),
  });
  const adminLink = await findOrCreateFromFirebase(
    fakeToken({ uid: 'uid-admin', email: ADMIN_EMAIL, emailVerified: true })
  );
  t('вхід поштою адміна підвищує роль до admin', adminLink.user?.role === 'admin');
}

console.log('\nВідповідність ролей маркетплейс → Nova (H5.1):');
{
  const map = novaRoleForMarketplaceRole;

  t('письменник лишається письменником', map('writer') === 'writer');
  t('адмін лишається адміном', map('admin') === 'admin');
  t('менеджер продажів → видавець', map('sales_manager') === 'publisher');
  t('інженер інструкцій → письменник', map('instruction_engineer') === 'writer');
  t('студент → письменник', map('student') === 'writer');

  // Головне, заради чого мапа й зʼявилась: до неї кожен ставав письменником.
  t('покупець → читач, а не письменник', map('buyer') === 'reader');
  t('продавець → читач', map('seller') === 'reader');
  t('експерт → читач', map('expert') === 'reader');

  // Роль, якої Nova не знає, має вести на найменші права, а не на найбільші —
  // інакше нова роль у маркетплейсі мовчки отримає доступ до всього.
  t('невідома роль → читач', map('ceo') === 'reader');

  t('роль не вказана → дефолтна', map(null) === 'writer');
}

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
