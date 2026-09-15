/**
 * Контракт реєстру вузлів адмінпанелі та її сторінки. Запуск: npm run test:admin-os
 *
 * НАВІЩО. `adminOs/nodes.ts` — єдине місце, де перелічено розділи адмінки, і
 * саме тому воно вразливе: вузол, доданий тут, але не підтриманий на сторінці
 * (або навпаки), не ламає збірку — він просто не відкривається. Так уже було:
 * вузол «Промти ядра» роками вів у заглушку «відкривається в іншому місці»,
 * і жоден тест цього не бачив.
 *
 * Тут перевіряється саме контракт, без React: склад вузлів, розкладка карти,
 * відповідність дій тому, що сторінка вміє показати, і повнота смуги сутностей.
 * Частина перевірок читає вихідні файли як текст — це свідомо: екран без
 * DOM-інфраструктури (React-тестів у проєкті немає) інакше не перевірити.
 */
import fs from 'node:fs';
import path from 'node:path';

const { ADMIN_NODES, ENTITY_BAND, findNode } = await import('../src/components/adminOs/nodes');

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8');
const ADMIN_OS = read('src/components/adminOs/AdminOsView.tsx');
const ADMIN_PANEL = read('src/components/AdminPanelView.tsx');

// ---------------------------------------------------------------------------
console.log('Реєстр вузлів:');
{
  t('вузлів дванадцять — з «Управлінням товарами»', ADMIN_NODES.length === 12, String(ADMIN_NODES.length));

  const ids = ADMIN_NODES.map((n) => n.id);
  t('усі id унікальні', new Set(ids).size === ids.length, ids.join(', '));

  const incomplete = ADMIN_NODES.filter((n) => !n.title.trim() || !n.hint.trim() || !n.description.trim());
  t('у кожного вузла є назва, підпис і опис', incomplete.length === 0, incomplete.map((n) => n.id).join(', '));

  const top = ADMIN_NODES.filter((n) => n.slot === 'top');
  const left = ADMIN_NODES.filter((n) => n.slot === 'left');
  const right = ADMIN_NODES.filter((n) => n.slot === 'right');
  t('карта розкладена 3 / 5 / 4', top.length === 3 && left.length === 5 && right.length === 4,
    `${top.length} / ${left.length} / ${right.length}`);

  const danger = ADMIN_NODES.filter((n) => n.tone === 'danger');
  t('червоний тон рівно в одного вузла', danger.length === 1, danger.map((n) => n.id).join(', '));
  t('червоний тон — в «Історії комітів»', danger[0]?.id === 'git', String(danger[0]?.id));

  t('«Модерація» є окремим вузлом', ids.includes('moderation'));
  t('«Модерація» стоїть у бічній колонці', findNode('moderation')?.slot === 'left');
  t('«Управління товарами» є окремим вузлом', ids.includes('products'));
  t('«Управління товарами» веде на власну сторінку',
    (findNode('products')?.action as { kind: string; view?: string })?.view === 'products');
  t('findNode знаходить вузол за id', findNode('crm')?.title === 'CRM');
  t('findNode на невідомий id віддає undefined', findNode('нема-такого') === undefined);
}

// ---------------------------------------------------------------------------
console.log('\nДії вузлів відповідають тому, що сторінка вміє показати:');
{
  // Список вкладок беремо з самого типу AdminTab, а не з тексту — щоб
  // перевірка не «погоджувалась сама з собою».
  const tabTypeMatch = ADMIN_PANEL.match(/export type AdminTab =([^;]+);/);
  const declaredTabs = new Set((tabTypeMatch?.[1] ?? '').match(/'([a-z]+)'/g)?.map((s) => s.replace(/'/g, '')) ?? []);
  t('тип AdminTab знайдено у файлі панелі', declaredTabs.size > 0, [...declaredTabs].join(', '));

  const panelNodes = ADMIN_NODES.filter((n) => n.action.kind === 'panel');
  const unknownTabs = panelNodes.filter((n) => !declaredTabs.has((n.action as { tab: string }).tab));
  t('усі вкладки вузлів оголошені в AdminTab', unknownTabs.length === 0, unknownTabs.map((n) => n.id).join(', '));

  // Кожна вкладка, яку показує сторінка, має бути оголошена і в типі, і в
  // переліку кнопок — інакше розділ існує, але дійти до нього нема як.
  for (const tab of declaredTabs) {
    t(`вкладка «${tab}» є в переліку вкладок панелі`, ADMIN_PANEL.includes(`['${tab}',`));
  }

  const viewNodes = ADMIN_NODES.filter((n) => n.action.kind === 'view');
  const handled = new Set(['api-keys', 'core-ai', 'moderation', 'products']);
  const unknownViews = viewNodes.filter((n) => !handled.has((n.action as { view: string }).view));
  t('усі самостійні сторінки — з відомих чотирьох', unknownViews.length === 0, unknownViews.map((n) => n.id).join(', '));

  for (const view of handled) {
    t(`сторінка «${view}» має обробник на екрані`, ADMIN_OS.includes(`'${view}'`));
  }

  t('модальних дій у реєстрі більше немає', !ADMIN_OS.includes("kind: 'modal'") && !ADMIN_OS.includes('setModal'));
}

// ---------------------------------------------------------------------------
console.log('\nСторінка показує справжні екрани, а не заглушки:');
{
  t('вбудовує робочі вкладки (AdminPanelView, chromeless)', ADMIN_OS.includes('<AdminPanelView tab={active.action.tab} chromeless />'));
  t('імпортує «Ключі API»', ADMIN_OS.includes("from '../ApiKeysView'"));
  t('імпортує «Модерацію»', ADMIN_OS.includes("from '../AdminModerationView'"));
  t('імпортує «Управління товарами»', ADMIN_OS.includes("from '../AdminProductsView'"));
  t('імпортує конструктор промтів ядра', ADMIN_OS.includes("from '../QuickAiModal'"));
  // Повернення до мапінгу мусить бути в КОЖНОМУ розділі — і з шапки
  // сторінки, і над вмістом самого розділу.
  t('кнопка повернення до мапінгу є над вмістом розділу',
    ADMIN_OS.includes('Повернутися до мапінгу адмін панелі'));

  // Заглушка, знайдена в коді 14.09.2026: текст «відкривається в іншому місці»
  // замість редактора. Якщо він повернеться — цей тест має впасти.
  t('заглушки про «відкривається в іншому місці» немає',
    !ADMIN_OS.includes('відкривається кнопкою «Швидкий AI»'));

  // Вигадані числа інспектора (були «9» модулів і «6 на роль» без джерела).
  t('кількість модулів ядра береться з маршруту', ADMIN_OS.includes("stats.coreModules"));
  t('матриця прав бере кількість з коду прав', ADMIN_OS.includes('getRolePermissions'));
}

// ---------------------------------------------------------------------------
console.log('\nСмуга «Памʼять і сутності»:');
{
  t('плиток вісім — як у макеті', ENTITY_BAND.length === 8, String(ENTITY_BAND.length));
  const ids = ENTITY_BAND.map((e) => e.id);
  t('id плиток унікальні', new Set(ids).size === ids.length, ids.join(', '));
  for (const expected of ['users', 'books', 'subscriptions', 'payments', 'keys', 'prompts', 'usage', 'listings']) {
    t(`плитка «${expected}» має джерело даних на екрані`, new RegExp(`\\n\\s*${expected}: stats\\.`).test(ADMIN_OS));
  }
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
