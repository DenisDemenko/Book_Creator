/**
 * Тести ролі «Менеджер сайту» (server/auth.ts: SUPPORT_AGENT_ROLES,
 * isSupportAgent, requireSupportAgent; src/utils/rbac.ts: canOpenAdminPanel,
 * allowedTabs; src/components/adminOs/nodes.ts: сам вузол CRM).
 * Запуск: npm run test:site-manager
 *
 * ЩО САМЕ ПЕРЕВІРЯЄТЬСЯ. Роль додає ДОСТУП (до чату підтримки), а головний
 * ризик такої зміни — протилежний: що вона МОВЧКИ додасть доступу більше,
 * ніж треба. Тому тут не «функція викликається», а дві межі нарізно:
 *   1. хто взагалі проходить requireSupportAgent (мають пройти рівно admin
 *      і site_manager, ніхто інший, включно з гостем);
 *   2. що бачить site_manager у клієнтському дереві дозволів — рівно один
 *      таб ('admin'), і саме тому canAccessTab('site_manager', X) хибне для
 *      будь-якого X, окрім 'admin'.
 * Друге ловить саме ту помилку, яку легко зробити: скопіювати шаблон ролі й
 * забути звузити allowedTabs — тоді нова роль тихо успадкує чужі вкладки.
 */

import { isSupportAgent, SUPPORT_AGENT_ROLES, type Principal } from '../server/auth.ts';
import { canAccessTab, canOpenAdminPanel, getRoleInfo, getDefaultTabForRole, ALL_ROLES } from '../src/utils/rbac.ts';
import { ADMIN_NODES } from '../src/components/adminOs/nodes.ts';
import type { UserRole, NavigationTab } from '../src/types.ts';

let pass = 0;
let fail = 0;
function t(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function principal(role: UserRole): Principal {
  return {
    id: 'u1',
    email: 'x@example.com',
    name: 'X',
    role,
    disabled: false,
    createdAt: '',
    isGuest: false,
  } as unknown as Principal;
}

const GUEST: Principal = { isGuest: true } as unknown as Principal;

console.log('\n── requireSupportAgent / isSupportAgent (сервер) ──');
{
  t('перелік — рівно admin і site_manager, у цьому порядку не важливо',
    new Set(SUPPORT_AGENT_ROLES).size === 2 &&
    SUPPORT_AGENT_ROLES.includes('admin') &&
    SUPPORT_AGENT_ROLES.includes('site_manager'),
    SUPPORT_AGENT_ROLES.join(','));

  t('admin проходить', isSupportAgent(principal('admin')));
  t('site_manager проходить', isSupportAgent(principal('site_manager')));

  const others: UserRole[] = ['writer', 'designer', 'translator', 'publisher', 'expert', 'teacher', 'reader', 'guest'];
  for (const role of others) {
    t(`${role} НЕ проходить`, !isSupportAgent(principal(role)));
  }
  t('гість (isGuest:true, без role) НЕ проходить', !isSupportAgent(GUEST));
  t('відсутній principal НЕ проходить', !isSupportAgent(undefined));
}

console.log('\n── canOpenAdminPanel (клієнт: чи взагалі відкривається AdminOsView) ──');
{
  t('admin відкриває', canOpenAdminPanel('admin'));
  t('site_manager відкриває', canOpenAdminPanel('site_manager'));
  const others: UserRole[] = ['writer', 'designer', 'translator', 'publisher', 'expert', 'teacher', 'reader', 'guest'];
  for (const role of others) {
    t(`${role} НЕ відкриває`, !canOpenAdminPanel(role));
  }
  t('порожня роль НЕ відкриває', !canOpenAdminPanel(undefined));
}

console.log('\n── Дозволи ролі site_manager (rbac.ts) ──');
{
  const info = getRoleInfo('site_manager');
  t('роль зареєстрована (не впала на admin-заглушку)', info.id === 'site_manager', info.id);
  t('лише одна вкладка в allowedTabs', info.permissions.allowedTabs.length === 1, JSON.stringify(info.permissions.allowedTabs));
  t('ця вкладка — admin', info.permissions.allowedTabs[0] === 'admin');
  t('isReadOnly', info.permissions.isReadOnly === true);

  // Жодного контентного/грошового права — рівно нуль винятків.
  const contentFlags = [
    'canEditContent', 'canEditTranslation', 'canEditVisuals', 'canEditLayout', 'canExport',
    'canImportBook', 'canManageCharacters', 'canManagePlot', 'canUseAi', 'canManageSettings',
    'canViewAuditLog', 'canManageRoles', 'canAuthorCourses', 'canGenerateImages', 'canPublish',
    'canPublishExternal', 'canManageApiKeys', 'canMarketIntel',
  ] as const;
  const leaked = contentFlags.filter((f) => (info.permissions as any)[f] === true);
  t('жодного контентного/адміністративного права не увімкнено', leaked.length === 0, leaked.join(','));

  // canAccessTab: єдиний прохідний таб — 'admin'.
  const someTabs: NavigationTab[] = ['editor', 'preview', 'cover', 'export', 'characters', 'market', 'admin'];
  for (const tab of someTabs) {
    const expected = tab === 'admin';
    t(`canAccessTab('site_manager', '${tab}') = ${expected}`, canAccessTab('site_manager', tab) === expected);
  }

  t("дефолтний таб — 'admin' (більше нікуди й не пускають)", getDefaultTabForRole('site_manager') === 'admin');

  t('роль присутня в ALL_ROLES рівно один раз', ALL_ROLES.filter((r) => r.id === 'site_manager').length === 1);
}

console.log('\n── Вузол CRM існує і доступний site_manager-у ──');
{
  const crm = ADMIN_NODES.find((n) => n.id === 'crm');
  t("вузол 'crm' є в реєстрі", !!crm);
  t("вузол 'crm' відкривається як панель (kind: 'panel', tab: 'crm')",
    !!crm && crm.action.kind === 'panel' && (crm.action as any).tab === 'crm');

  // Жоден ІНШИЙ вузол адмінки НЕ повинен мати tab: 'crm' — інакше обмеження
  // в AdminOsView (activeId === 'crm') відкривало б два різні розділи.
  const crmLike = ADMIN_NODES.filter((n) => n.action.kind === 'panel' && (n.action as any).tab === 'crm');
  t('рівно один вузол веде на вкладку crm', crmLike.length === 1, String(crmLike.length));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
