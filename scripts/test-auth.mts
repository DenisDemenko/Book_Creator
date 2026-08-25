/** Тести автентифікації, тарифів і обліку витрат. Запуск: npm run test:auth */
process.env.DATA_DIR = '/tmp/nova-test-data';
import fs from 'node:fs';
fs.rmSync('/tmp/nova-test-data', { recursive: true, force: true });

// Імпорти динамічні: інакше ESM підняв би їх вище за присвоєння DATA_DIR,
// і тест писав би у бойову теку даних замість тимчасової.
const { hashPassword, verifyPassword, validatePassword, validateEmail, BASE_SERVER_PERMISSIONS } = await import('../server/auth');
const { priceForImage, priceForText, IMAGE_PRICING, pricingSnapshot } = await import('../server/pricing');
const { recordUsage, listUsage, saveUser, findUserByEmail, deleteUser, setRoleOverride, getRoleOverrides, resetRoleOverrides } = await import('../server/store');

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('Паролі:');
{
  const h = hashPassword('SuperSecret123');
  t('хеш має схему scrypt', h.startsWith('scrypt$'));
  t('пароль у хеші не зберігається у відкритому вигляді', !h.includes('SuperSecret123'));
  t('вірний пароль проходить', verifyPassword('SuperSecret123', h));
  t('невірний не проходить', !verifyPassword('SuperSecret124', h));
  t('порожній сховок не проходить', !verifyPassword('x', undefined));
  t('сміттєвий хеш не валить процес', !verifyPassword('x', 'garbage'));
  const h2 = hashPassword('SuperSecret123');
  t('однакові паролі дають різні хеші (сіль)', h !== h2);
  t('обидва хеші валідні', verifyPassword('SuperSecret123', h2));
}

console.log('\nВалідація:');
t('короткий пароль відхиляється', validatePassword('1234567') !== null);
t('8 символів приймається', validatePassword('12345678') === null);
t('пошта без @ відхиляється', validateEmail('abc') !== null);
t('нормальна пошта приймається', validateEmail('a@b.co') === null);

console.log('\nБазові дозволи:');
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

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
