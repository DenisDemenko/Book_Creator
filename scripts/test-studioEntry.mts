/**
 * Намір, з яким людина прийшла в Студію з маркетплейсу (Т0.9) — чиста
 * функція `src/utils/studioEntry.ts`.
 *
 * Перевіряється не лише розбір, а й **контракт із маркетплейсом**: кожен
 * слаг мусить вести на вкладку, у якої справді є адреса (`appRoutes.ts`),
 * інакше кнопка на головній маркетплейсу обіцяє розділ, якого не існує.
 *
 * Запуск: npm run test:studio-entry
 */
import {
  ENTRY_IDEA_MAX,
  STUDIO_ENTRY_SECTIONS,
  parseStudioEntry,
  studioEntrySection,
} from '../src/utils/studioEntry.ts';
import { buildAppPath, parseAppPath } from '../src/utils/appRoutes.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('\nСписок розділів:');
t('слаги унікальні', new Set(STUDIO_ENTRY_SECTIONS.map((s) => s.slug)).size === STUDIO_ENTRY_SECTIONS.length);
t('вкладки унікальні', new Set(STUDIO_ENTRY_SECTIONS.map((s) => s.tab)).size === STUDIO_ENTRY_SECTIONS.length);
t('слаги — латиниця в нижньому регістрі', STUDIO_ENTRY_SECTIONS.every((s) => /^[a-z][a-z0-9-]*$/.test(s.slug)));
t('у кожного розділу є назва', STUDIO_ENTRY_SECTIONS.every((s) => s.titleUk.trim().length > 3));

console.log('\nКожен слаг веде на наявну сторінку Студії:');
for (const section of STUDIO_ENTRY_SECTIONS) {
  const path = buildAppPath({ projectId: 'BK-2084-CYBER', tab: section.tab }, '/studio');
  const back = path ? parseAppPath(path, '/studio') : null;
  t(
    `${section.slug} → ${section.tab} (${path ?? 'без адреси'})`,
    !!path && eq(back, { projectId: 'BK-2084-CYBER', tab: section.tab }),
  );
}

console.log('\nРозбір адреси:');
t('кожен слаг розпізнається', STUDIO_ENTRY_SECTIONS.every((s) => parseStudioEntry(`?open=${s.slug}`)?.tab === s.tab));
t('слаг з великими літерами й пробілами', parseStudioEntry('?open=%20Characters%20')?.tab === 'characters');
t('без провідного знака питання', eq(parseStudioEntry('open=editor'), { tab: 'editor' }));
t('порожній рядок — не намір', parseStudioEntry('') === null);
t('адреса без параметрів — не намір', parseStudioEntry('?utm_source=mail') === null);
t('порожній open — не намір', parseStudioEntry('?open=') === null && parseStudioEntry('?open=%20') === null);
t('невідомий слаг — не намір', parseStudioEntry('?open=nope') === null);
t('слаг вкладки замість розділу не приймається', parseStudioEntry('?open=core-story-graph') === null);
t('create=book лишається робочим (давня адреса кнопки)', eq(parseStudioEntry('?create=book'), { tab: 'express' }));
t('create=<інше> — не намір', parseStudioEntry('?create=course') === null);
t('open має пріоритет над невідомим create', parseStudioEntry('?create=course&open=characters')?.tab === 'characters');

console.log('\nЗадум книги:');
const long = 'я'.repeat(ENTRY_IDEA_MAX + 50);
t('задум обрізається до стелі майстра', parseStudioEntry(`?open=express&idea=${long}`)?.idea?.length === ENTRY_IDEA_MAX);
t('задум обрізається і в давній адресі', parseStudioEntry(`?create=book&idea=${long}`)?.idea?.length === ENTRY_IDEA_MAX);
t('пробіли навколо обрізаються', parseStudioEntry('?open=express&idea=%20%20Драма%20%20')?.idea === 'Драма');
t('порожній задум не додається', parseStudioEntry('?open=express&idea=%20')?.idea === undefined);
t('кирилиця й лапки доходять цілими', parseStudioEntry(`?open=express&idea=${encodeURIComponent('«Архів памʼяті» — детектив')}`)?.idea === '«Архів памʼяті» — детектив');
t('розділ без майстра задум не тягне', parseStudioEntry('?open=characters&idea=Драма')?.idea === undefined);
t('create=book із задумом — майстер', eq(parseStudioEntry('?create=book&idea=%D0%94%D1%80%D0%B0%D0%BC%D0%B0'), { tab: 'express', idea: 'Драма' }));

console.log('\nПошук розділу:');
t('за слагом', studioEntrySection('visuals')?.tab === 'illustrations');
t('невідомий — undefined', studioEntrySection('story-graph') === undefined);

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
