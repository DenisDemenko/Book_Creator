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
  parseProjectEntry,
  STUDIO_ENTRY_PARAMS,
  studioEntrySection,
  parseCourseLinkPath,
  parseExpressDraftPath,
  TECHNICAL_DRAFT_STORAGE_KEY,
} from '../src/utils/studioEntry.ts';
import fs from 'node:fs';
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
t('Т6.3: «Відкрити у Студії» книгу з замовленням', eq(parseProjectEntry('?project=book-17&order=ord-9'), { projectId: 'book-17', orderId: 'ord-9' }));
t('Т6.3: курс без замовлення', eq(parseProjectEntry('?project=course-1f2e'), { projectId: 'course-1f2e' }));
t('Т6.3: сміття замість id — не намір', parseProjectEntry('?project=a%20b%3Ac') === null && parseProjectEntry('?order=ord-1') === null);
t('Т6.3: проблемне замовлення відкидається, проєкт лишається', eq(parseProjectEntry('?project=b1&order=%3Cscript%3E'), { projectId: 'b1' }));
t('Т6.3: project і order прибираються з адреси', STUDIO_ENTRY_PARAMS.includes('project') && STUDIO_ENTRY_PARAMS.includes('order'));
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

console.log('\nПосилання GrabFusion на інструкцію: /express/<id> (04.11.2026):');
{
  const id = '5f918eea-15a8-426b-b00e-15445441afbe';
  t('розбирає /express/<uuid>', eq(parseExpressDraftPath(`/express/${id}`), { draftId: id }));
  t('і з префіксом /studio, і з кінцевою скісною', eq(parseExpressDraftPath(`/studio/express/${id}/`), { draftId: id }));
  t('без id чи зі зламаним id — null', parseExpressDraftPath('/express/') === null && parseExpressDraftPath('/express') === null && parseExpressDraftPath('/express/abc') === null);
  t('глибший шлях, підйом і чужі адреси — null', parseExpressDraftPath(`/express/${id}/x`) === null && parseExpressDraftPath('/express/../projects/b/editor') === null && parseExpressDraftPath('/projects/BK-1/express') === null);
  t('символи поза [A-Za-z0-9-] відхиляються', parseExpressDraftPath('/express/5f918eea_15a8%2f..') === null);
  t('порожній і нерядковий вхід не падають', parseExpressDraftPath('') === null);

  // Ключ сховища — спільний із майстром: розходження дало б посилання, що відкриває порожній майстер.
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const wizard = read('../src/components/TechnicalInstructionWizard.tsx');
  t('майстер інструкцій бере чернетку з того самого ключа', wizard.includes('useWizardDraft(TECHNICAL_DRAFT_STORAGE_KEY,') && TECHNICAL_DRAFT_STORAGE_KEY === 'nova_technical_instruction_draft');
  const app = read('../src/App.tsx');
  t('App кладе id у сховище й веде в майстер інструкцій', app.includes('INITIAL_EXPRESS_DRAFT') && app.includes("track: 'technical_instruction'") && app.includes('localStorage.setItem(TECHNICAL_DRAFT_STORAGE_KEY, pendingEntry.draftId)'));
  t('адресу з /express/<id> прибирають після входу', app.includes("replace(/\\/express\\/[^/]+\\/?$/, '/')"));
}

console.log('\nПосилання GrabFusion на курс: /courses/<id> (13.11.2026):');
{
  const id = 'CRS-9f1a2b';
  t('розбирає /courses/<id>', eq(parseCourseLinkPath(`/courses/${id}`), { courseId: id }));
  t('і з префіксом /studio, і з кінцевою скісною', eq(parseCourseLinkPath(`/studio/courses/${id}/`), { courseId: id }));
  t('без id — null', parseCourseLinkPath('/courses/') === null && parseCourseLinkPath('/courses') === null);
  t('глибший шлях, підйом і чужі адреси — null', parseCourseLinkPath(`/courses/${id}/lessons`) === null && parseCourseLinkPath('/courses/../projects/b/editor') === null && parseCourseLinkPath('/projects/BK-1/courses') === null);
  t('символи поза [A-Za-z0-9._-] відхиляються', parseCourseLinkPath('/courses/a%2fb') === null && parseCourseLinkPath('/courses/a b') === null);
  t('порожній вхід не падає', parseCourseLinkPath('') === null);

  // Та сама пастка, що з /express/<id>: маршрутизатор знає лише /projects/..., тож
  // без цього розбору посилання відкривало дашборд книг, а не надісланий курс.
  t('маршрутизатор сам такого шляху не знає', parseAppPath(`/courses/${id}`) === null && parseAppPath(`/studio/courses/${id}`, '/studio') === null);

  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const app = read('../src/App.tsx');
  t('App веде курс у «Створити курс», а не на дашборд', app.includes('INITIAL_COURSE_LINK') && app.includes("tab: 'course-studio', courseId: INITIAL_COURSE_LINK.courseId"));
  t('курс відкривається саме той', app.includes('if (pendingEntry.courseId) setInitialCourseId(pendingEntry.courseId)'));
  t('адресу з /courses/<id> прибирають після входу', app.includes("replace(/\\/courses\\/[^/]+\\/?$/, '/')"));

  // Другий бік прохання власника: надісланий курс видно окремим блоком, а не серед усіх.
  const legacy = read('../src/components/CourseStudioLegacy.tsx');
  t('у «Створити курс» є блок розпочатих курсів', legacy.includes('data-course-started') && legacy.includes('Розпочаті курси — продовжити роботу'));
  t('у блоці — лише чернетки, найсвіжіші перші', legacy.includes(".filter((c) => c.status === 'draft')") && legacy.includes("localeCompare(String(a.updatedAt"));
  t('курс із GrabFusion у блоці підписаний', legacy.includes('data-course-started-item') && legacy.includes('Створено за фото'));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
