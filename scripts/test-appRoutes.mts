/**
 * Адреси вкладок і сторінок ядра — задача Т0.8 (журнал #251), рішення К3.
 * Чисті функції `src/utils/appRoutes.ts`: розбір і побудова адреси
 * `/projects/<книга>/<сторінка>` з префіксом і без.
 *
 * Запуск: npm run test:app-routes
 */
import { parseAppPath, buildAppPath, CORE_PAGES, isCorePageTab } from '../src/utils/appRoutes.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('\nОдинадцять сторінок ТЗ:');
t('рівно 11, адреси з ТЗ', CORE_PAGES.length === 11 &&
  ['search', 'story-graph', 'emotions', 'scenario-branches', 'timeline', 'visual-library', 'continuity', 'writer-mastery', 'collaboration', 'translation']
    .every((seg) => CORE_PAGES.some((p) => p.segment === seg)));
t('усі — вкладки core-*', CORE_PAGES.every((p) => isCorePageTab(p.tab) && p.tab.startsWith('core-')));
t('звичайні вкладки — не сторінки ядра', !isCorePageTab('editor') && !isCorePageTab('characters'));

console.log('\nРозбір адреси:');
t('сторінка ядра', eq(parseAppPath('/projects/BK-1/story-graph'), { projectId: 'BK-1', tab: 'core-story-graph' }));
t('з префіксом /studio', eq(parseAppPath('/studio/projects/BK-1/search', '/studio'), { projectId: 'BK-1', tab: 'core-search' }));
t('префікс із кінцевим слешем', eq(parseAppPath('/studio/projects/BK-1/search', '/studio/'), { projectId: 'BK-1', tab: 'core-search' }));
t('профіль персонажа — /characters/:id (як у ТЗ)', eq(parseAppPath('/projects/BK-1/characters/e-7'), { projectId: 'BK-1', tab: 'core-character', characterId: 'e-7' }));
t('/characters без id — вкладка «Персонажі»', eq(parseAppPath('/projects/BK-1/characters'), { projectId: 'BK-1', tab: 'characters' }));
t('профіль без героя — /character-profile', eq(parseAppPath('/projects/BK-1/character-profile'), { projectId: 'BK-1', tab: 'core-character' }));
t('звичайна вкладка', eq(parseAppPath('/projects/BK-1/editor'), { projectId: 'BK-1', tab: 'editor' }));
t('книга без сторінки — дашборд', eq(parseAppPath('/projects/BK-1'), { projectId: 'BK-1', tab: 'dashboard' }));
t('невідома сторінка — не наша адреса', parseAppPath('/projects/BK-1/nope') === null);
t('market — вікно, не адреса', parseAppPath('/projects/BK-1/market') === null);
t('корінь і лендінги — не наші', parseAppPath('/') === null && parseAppPath('/about') === null && parseAppPath('/studio/about', '/studio') === null);
t('чужий префікс — не наша адреса', parseAppPath('/other/projects/BK-1/search', '/studio') === null);
t('id книги з небезпечними символами відкидається', parseAppPath('/projects/..%2F..%2Fetc/search') === null && parseAppPath('/projects/a b/search') === null);
t('закодований id героя розкодовується', parseAppPath('/projects/BK-1/characters/%D0%9E%D0%BB%D0%B5%D0%BD%D0%B0')?.characterId === 'Олена');

console.log('\nПобудова адреси:');
t('сторінка ядра з префіксом', buildAppPath({ projectId: 'BK-1', tab: 'core-timeline' }, '/studio') === '/studio/projects/BK-1/timeline');
t('профіль героя', buildAppPath({ projectId: 'BK-1', tab: 'core-character', characterId: 'e 7' }) === '/projects/BK-1/characters/e%207');
t('профіль без героя', buildAppPath({ projectId: 'BK-1', tab: 'core-character' }) === '/projects/BK-1/character-profile');
t('звичайна вкладка', buildAppPath({ projectId: 'BK-1', tab: 'mindboard' }) === '/projects/BK-1/mindboard');
t('market — без адреси', buildAppPath({ projectId: 'BK-1', tab: 'market' }) === null);
const roundTrip = CORE_PAGES.every((p) => {
  const path = buildAppPath({ projectId: 'BK-2084-CYBER', tab: p.tab }, '/studio')!;
  return eq(parseAppPath(path, '/studio'), { projectId: 'BK-2084-CYBER', tab: p.tab });
});
t('туди й назад: кожна з 11 сторінок', roundTrip);
const tabs = ['express', 'dashboard', 'start', 'editor', 'mastery', 'scenario', 'characters', 'mindboard', 'toc', 'qr-footnotes', 'ai-studio',
  'illustrations', 'layout', 'preview', 'cover', 'media', 'changelog', 'export', 'admin', 'subscription', 'api-keys', 'kdp-format', 'courses',
  'course-studio', 'narration', 'pdf-editor', 'knowledge', 'trainers', 'diagn', 'structure', 'portfolio', 'publishing'] as const;
t('туди й назад: кожна звичайна вкладка', tabs.every((tab) => eq(parseAppPath(buildAppPath({ projectId: 'B', tab })!), { projectId: 'B', tab })));

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
