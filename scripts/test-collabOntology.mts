/**
 * Онтологія співпраці й реєстр ролей — визначення 1.0 і перевірка (Т6.1 В1,
 * `PLAN_COLLABORATION.md`; ТЗ Graph Studio §43–48, §59 №31–34, 48, 49;
 * Onboarding §5–7, §18, §29 №3–7, 25, 29). Запуск: npm run test:collab-ontology
 */
import {
  COLLAB_ONTOLOGY_ID,
  activeCollabLabel,
  applyCollabOntology,
  canonicalRoleId,
  diffCollabOntologies,
  factoryCollabOntology,
  invitableRoles,
  resetCollabOntology,
  roleById,
  storyTypesReferenced,
  studioRoleFor,
  validateCollabOntology,
  type CollabOntologyDefinition,
} from '../src/utils/collabOntology';
import { factoryOntology, canonicalJson } from '../src/utils/ontology';
import { isRegisteredEntityType } from '../src/utils/coreEntities';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const story = factoryOntology();
const codes = (d: CollabOntologyDefinition, s = story) => validateCollabOntology(d, { story: s }).errors.map((e) => e.code);

console.log('Fusion Collaboration Ontology 1.0:');
const c1 = factoryCollabOntology();
{
  const v = validateCollabOntology(c1, { story });
  t('проходить перевірку проти онтології твору 1.0, без помилок і попереджень', v.ok && v.warnings.length === 0, JSON.stringify([...v.errors, ...v.warnings].slice(0, 3)));
  t('окремий домен fusion-collab, свій формат (№31)', c1.id === COLLAB_ONTOLOGY_ID && c1.format === 'fusion-collab/1' && c1.id !== story.id);
  t('18 базових сутностей §45; реалізовані — PERSON, PARTICIPANT, ROLE, BOOK_PROJECT', c1.entityTypes.length === 18 && c1.entityTypes.filter((e) => e.implemented).map((e) => e.id).join() === 'PERSON,PARTICIPANT,ROLE,BOOK_PROJECT');
  t('типи співпраці — ВЕЛИКИМИ, жоден не збігається зі slug-ом твору (№32)', c1.entityTypes.every((e) => /^[A-Z_]+$/.test(e.id) && !isRegisteredEntityType(e.id)));
  t('PERSON — не тип твору: ядро не прийме сутність твору типу PERSON', !isRegisteredEntityType('PERSON') && !isRegisteredEntityType('person'));
  t('9 міждоменних зв\'язків §48, усі кваліфіковані collab → story', c1.crossDomainRelations.length === 9 && c1.crossDomainRelations.every((r) => r.from.every((x) => x.startsWith('collab:')) && r.to.every((x) => x.startsWith('story:'))));
  t('ролі: 35 = Onboarding §7 (34) + бета-рідер; 7 категорій', c1.roles.length === 35 && c1.roleCategories.length === 7, `${c1.roles.length} / ${c1.roleCategories.length}`);
  const v3 = ['project_owner', 'author', 'co_author', 'editor', 'literary_editor', 'proofreader', 'designer', 'illustrator', 'translator', 'book_manager', 'marketing_manager', 'sales_manager', 'publisher', 'freelancer', 'reviewer'];
  t('усі 15 базових ролей ТЗ v3 §46 є (OWNER → project_owner, SELLER → sales_manager)', v3.every((id) => c1.roles.some((r) => r.id === id)));
  t('кожна роль: мітки uk/en, категорія, типи проєктів, простір, можливості, AI-профіль, активна (Onboarding §18, №25)',
    c1.roles.every((r) => r.label.uk && r.label.en && r.category && r.projectTypes.length && r.defaultWorkspace && r.suggestedCapabilities.length && r.aiProfile && r.status === 'active'));
  t('типи проєктів — мінімум книга й курс (№3); мети входу, області, можливості — з реєстру', ['book', 'course'].every((p) => c1.projectTypes.some((x) => x.id === p)) && c1.entryIntents.length === 7 && c1.scopeTypes.length === 10 && c1.capabilities.length === 10);
  t('фрілансер вимагає спеціалізації (№5); спеціалізації — інші ролі', roleById('freelancer')!.requiresSpecialization && roleById('freelancer')!.specializations.includes('illustrator'));
  t('власник проєкту — одна людина (singleHolder)', roleById('project_owner')!.singleHolder && c1.roles.filter((r) => r.singleHolder).length === 1);
  t('ілюстратор пропонує можливості, а не доступ до всього рукопису: без edit і manage', !roleById('illustrator')!.suggestedCapabilities.includes('edit') && !roleById('illustrator')!.suggestedCapabilities.includes('manage'));
  t('менеджер книги — без edit (не має прав на канон, v3 №38 — у Т6.2)', !roleById('book_manager')!.suggestedCapabilities.includes('edit'));
}

console.log('\nСтарі ролі — на реєстрі (рішення власника §2 п.1):');
{
  t('reader → beta_reader, coauthor → co_author, owner → project_owner', canonicalRoleId('reader') === 'beta_reader' && canonicalRoleId('coauthor') === 'co_author' && canonicalRoleId('owner') === 'project_owner');
  t('designer, publisher, translator, editor — ті самі id', ['designer', 'publisher', 'translator', 'editor'].every((r) => canonicalRoleId(r) === r));
  t('усі 7 ролей project_members мають відповідник', ['owner', 'coauthor', 'editor', 'designer', 'publisher', 'translator', 'reader'].every((r) => !!canonicalRoleId(r)));
  t('простір Студії для чотирьох ролей запрошення — той самий, що був (designer / publisher / translator / reader)',
    studioRoleFor('designer') === 'designer' && studioRoleFor('publisher') === 'publisher' && studioRoleFor('translator') === 'translator' && studioRoleFor('reader') === 'reader' && studioRoleFor('beta_reader') === 'reader');
  const inv = invitableRoles().map((r) => r.id);
  t('запросити можна ролі, що не дають ширшого простору, ніж було: без автора, співавтора, власника, редактора', inv.includes('illustrator') && inv.includes('beta_reader') && !inv.some((r) => ['author', 'co_author', 'project_owner', 'editor'].includes(r)), inv.join(', '));
  t('кожна роль запрошення — у просторі designer / publisher / translator / reader (права до Т6.2 не ширшають)', invitableRoles().every((r) => ['designer', 'publisher', 'translator', 'reader'].includes(String(studioRoleFor(r.id)))));
  t('невідома роль — null', canonicalRoleId('pirate') === null && studioRoleFor('pirate') === null);
}

console.log('\nПеревірка ловить зламане (№49 — міждоменні зв\'язки):');
{
  const bad = (name: string, mutate: (d: CollabOntologyDefinition) => void, code: string, s = story) => {
    const d = clone(c1);
    mutate(d);
    const c = codes(d, s);
    t(name, c.includes(code), c.slice(0, 4).join(', ') || 'помилок немає');
  };
  bad('посилання без домену («character»)', (d) => ((d.crossDomainRelations[0].to as string[])[0] = 'character'), 'unqualified_ref');
  bad('міждоменний зв\'язок на тип твору, якого немає', (d) => ((d.crossDomainRelations[0].to as string[])[0] = 'story:dragon'), 'unknown_story_type');
  bad('зворотний напрям (story → collab)', (d) => ((d.crossDomainRelations[0].from as string[])[0] = 'story:character'), 'wrong_direction');
  bad('тип співпраці малими (person)', (d) => (d.entityTypes[0].id = 'person'), 'bad_id');
  bad('без PERSON', (d) => (d.entityTypes = d.entityTypes.filter((e) => e.id !== 'PERSON')), 'missing_core_type');
  bad('роль без англійської мітки (№25)', (d) => (d.roles[0].label.en = ''), 'missing_name');
  bad('роль з невідомою можливістю', (d) => d.roles[0].suggestedCapabilities.push('fly'), 'unknown_capability');
  bad('роль з невідомим типом проєкту', (d) => d.roles[0].projectTypes.push('movie'), 'unknown_project_type');
  bad('спеціалізація, якої немає', (d) => d.roles.find((r) => r.id === 'freelancer')!.specializations.push('astronaut'), 'unknown_role');
  bad('фрілансер без спеціалізацій', (d) => (d.roles.find((r) => r.id === 'freelancer')!.specializations = []), 'no_specializations');
  bad('старе значення веде на дві ролі', (d) => d.roles.find((r) => r.id === 'reviewer')!.legacyIds.push('reader'), 'legacy_conflict');
  bad('без ролі власника', (d) => (d.roles.find((r) => r.id === 'project_owner')!.singleHolder = false), 'no_owner_role');
  bad('без курсу серед типів проєктів (№3)', (d) => {
    d.projectTypes = d.projectTypes.filter((p) => p.id !== 'course');
    for (const r of d.roles) r.projectTypes = r.projectTypes.filter((p) => p !== 'course');
  }, 'missing_project_type');
  const story2 = clone(story);
  story2.entityTypes = story2.entityTypes.filter((e) => e.id !== 'scene');
  bad('онтологія твору без scene — зв\'язки співпраці на сцену ламаються', () => {}, 'unknown_story_type', story2);
  const story3 = clone(story);
  story3.entityTypes.find((e) => e.id === 'scene')!.status = 'deprecated';
  const w = validateCollabOntology(c1, { story: story3 });
  t('застарілий тип твору — попередження, не помилка', w.ok && w.warnings.some((x) => x.code === 'deprecated_story_type'));
}

console.log('\nНові ролі — без зміни онтології твору (№48):');
{
  const c2 = clone(c1);
  c2.roles.push({ id: 'audiobook_narrator', label: { en: 'Audiobook Narrator', uk: 'Диктор аудіокниги' }, category: 'language', projectTypes: ['book'], defaultWorkspace: 'translator', suggestedCapabilities: ['view', 'comment', 'upload'], aiProfile: 'translator_default', status: 'active', requiresSpecialization: false, specializations: [], singleHolder: false, combinable: true, invitable: true, legacyIds: [], order: 35 });
  c2.roles.find((r) => r.id === 'screenwriter')!.status = 'deprecated';
  const before = canonicalJson(story);
  t('нова роль проходить перевірку проти тієї самої онтології твору', validateCollabOntology(c2, { story }).ok);
  t('онтологія твору не змінилась', canonicalJson(story) === before);
  const d = diffCollabOntologies(c1, c2);
  t('різниця: додано audiobook_narrator, застаріла screenwriter', d.changed && d.roles.added.join() === 'audiobook_narrator' && d.roles.deprecated.join() === 'screenwriter');
  t('без змін — порожньо', !diffCollabOntologies(c1, clone(c1)).changed);
  applyCollabOntology(c2, 'fusion-collab@2');
  t('застосована версія: нова роль запрошується, позначка версії', invitableRoles().some((r) => r.id === 'audiobook_narrator') && activeCollabLabel() === 'fusion-collab@2' && studioRoleFor('audiobook_narrator') === 'translator');
  resetCollabOntology();
  t('скидання — 1.0', !roleById('audiobook_narrator') && activeCollabLabel() === 'factory');
}

console.log('\nПосилання на типи твору (для захисту онтології твору):');
{
  const refs = storyTypesReferenced(c1);
  t('character, scene, chapter, location — використовуються міждоменними зв\'язками', ['character', 'scene', 'chapter', 'location'].every((x) => refs.has(x)) && refs.get('scene')!.includes('ILLUSTRATED'));
  t('усі посилання — на наявні типи твору', [...refs.keys()].every((k) => story.entityTypes.some((e) => e.id === k)));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
