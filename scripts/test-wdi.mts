/**
 * Тести фундаменту WDI (server/wdi.ts + server/wdiStore.ts).
 * Запуск: npm run test:wdi
 *
 * Перевіряється не «функції щось повертають», а чотири обіцянки моделі:
 *
 *  1. **Порядок сили доказів.** Порада ШІ рейтинг не підвищує, а transfer
 *     важить більше за revision loop, той — більше за тест, і так далі.
 *     Це головний принцип власника, і він мусить бути видний у числах.
 *  2. **Ідемпотентність.** Той самий `sourceId` не накручує бал — і це
 *     тримає БАЗА, тож перевіряємо на справжньому SQLite.
 *  3. **Бал = проєкція журналу.** Однакові журнали дають однакові бали, і
 *     жоден бал не зберігається окремо.
 *  4. **Дерево узгоджене зі `skillsData.ts`.** Категорії, на які
 *     посилається дерево, справді існують у продукті — інакше зведення
 *     двох моделей розійшлося б тихо.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Типи — статичним import type: із динамічного імпорту простір імен для
// типів не дістати, а сам модуль підвантажуємо динамічно вже ПІСЛЯ того,
// як виставлено DATA_DIR (інакше база відкриється не там, де треба).
import type { EvidenceEvent, EvidenceType } from '../server/wdi.ts';

let pass = 0, fail = 0;
function t(name: string, cond: boolean, extra = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail += 1; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wdi-'));
process.env.DATA_DIR = tmp;
process.env.DATABASE_PATH = path.join(tmp, 'test.db');

const W = await import('../server/wdi.ts');
const {
  WDI_SKILLS, WDI_SKILL_IDS, EVIDENCE_WEIGHT, BASE_SCORE, CATEGORIES_WITHOUT_WDI,
  projectSkill, projectAll, wdiScore, wdiLevelUk, wdiStatus, masteryFor,
  weakestSkill, nextToProbe, skillsForCategory, COACH_PROBLEM_TO_SKILL,
} = W;
type Ev = EvidenceEvent;

let n = 0;
const ev = (over: Partial<Ev> = {}): Ev => ({
  id: `e${++n}`, userId: 'u1', bookId: null, skill: 'scene_craft',
  type: 'TEXT_ANALYSIS', outcome: 1, confidence: 1, independence: 50,
  summary: '', sourceId: `s${n}`, createdAt: new Date().toISOString(), ...over,
});

console.log('\n── Дерево на два рівні ──');
{
  t('десять компетенцій', WDI_SKILL_IDS.length === 10);
  t('id унікальні', new Set(WDI_SKILL_IDS).size === 10);
  t('у кожної є українська назва', WDI_SKILLS.every((s) => s.labelUk.length > 3));
  t('«Майстерність письма» має чотири компетенції',
    skillsForCategory('craft').length === 4,
    skillsForCategory('craft').map((s) => s.id).join(','));
  t('writer_development — мета-рівень, без категорії',
    WDI_SKILLS.find((s) => s.id === 'writer_development')?.category === null);
  t('рівно одна компетенція без категорії',
    WDI_SKILLS.filter((s) => s.category === null).length === 1);
  // П'ять категорій свідомо без бала — і жодна з них не має компетенцій.
  t('категорії без WDI справді порожні',
    CATEGORIES_WITHOUT_WDI.every((c) => skillsForCategory(c).length === 0),
    CATEGORIES_WITHOUT_WDI.join(','));

  // Дерево мусить посилатися на СПРАВЖНІ категорії продукту.
  const data = fs.readFileSync('src/data/skillsData.ts', 'utf8');
  const real = new Set([...data.matchAll(/id: '([a-z_]+)',\s*titleUk:/g)].map((m) => m[1]));
  const referenced = WDI_SKILLS.map((s) => s.category).filter(Boolean) as string[];
  t('усі категорії з дерева існують у skillsData.ts',
    referenced.every((c) => real.has(c)),
    referenced.filter((c) => !real.has(c)).join(',') || 'усі є');
  t('категорії без WDI теж справжні',
    CATEGORIES_WITHOUT_WDI.every((c) => real.has(c)));
  t('дерево покриває всі десять категорій продукту',
    new Set([...referenced, ...CATEGORIES_WITHOUT_WDI]).size === real.size,
    `${new Set([...referenced, ...CATEGORIES_WITHOUT_WDI]).size} проти ${real.size}`);
}

console.log('\n── Порядок сили доказів (головний принцип) ──');
{
  const order: EvidenceType[] = ['TEXT_ANALYSIS','KNOWLEDGE_TEST','PRACTICAL_TASK','REVISION_LOOP','VERIFIED_GROWTH','TRANSFER'];
  let ok = true;
  for (let i = 1; i < order.length; i++) {
    if (EVIDENCE_WEIGHT[order[i]] <= EVIDENCE_WEIGHT[order[i - 1]]) ok = false;
  }
  t('вага зростає від аналізу тексту до transfer', ok,
    order.map((o) => `${o}:${EVIDENCE_WEIGHT[o]}`).join(' < '));
  t('transfer щонайменше вчетверо важчий за аналіз тексту',
    EVIDENCE_WEIGHT.TRANSFER >= EVIDENCE_WEIGHT.TEXT_ANALYSIS * 4);

  // Один transfer мусить дати більше, ніж три аналізи тексту — інакше
  // «накрути аналізів» було б вигіднішою стратегією за справжній ріст.
  const threeAnalyses = projectSkill('scene_craft', [
    ev({ type: 'TEXT_ANALYSIS' }), ev({ type: 'TEXT_ANALYSIS' }), ev({ type: 'TEXT_ANALYSIS' }),
  ]).score;
  const oneTransfer = projectSkill('scene_craft', [ev({ type: 'TRANSFER' })]).score;
  t('один transfer > трьох аналізів тексту', oneTransfer > threeAnalyses,
    `${oneTransfer} проти ${threeAnalyses}`);

  // Порада ШІ як тип доказу не існує взагалі — це і є «порада не підвищує».
  t('типу доказу «порада ШІ» в моделі немає',
    !Object.keys(EVIDENCE_WEIGHT).some((k) => /ADVICE|SUGGESTION|HINT/i.test(k)),
    Object.keys(EVIDENCE_WEIGHT).join(','));
}

console.log('\n── Проєкція: бал згортається з журналу ──');
{
  t('порожній журнал → базовий бал', projectSkill('scene_craft', []).score === BASE_SCORE);
  t('порожній журнал → нуль упевненості', projectSkill('scene_craft', []).confidence === 0);
  t('порожній журнал → UNOBSERVED', masteryFor(projectSkill('scene_craft', [])) === 'UNOBSERVED');

  const neg = projectSkill('scene_craft', [ev({ type: 'REVISION_LOOP', outcome: -1 })]);
  t('негативний доказ знижує бал', neg.score < BASE_SCORE, `${neg.score}`);
  t('негативний доказ теж додає впевненості', neg.confidence > 0,
    'знати про слабкість — теж знання');

  // Впевненість спостереження масштабує зсув.
  const sure = projectSkill('scene_craft', [ev({ type: 'REVISION_LOOP', confidence: 1 })]).score;
  const unsure = projectSkill('scene_craft', [ev({ type: 'REVISION_LOOP', confidence: 0.25 })]).score;
  t('низька впевненість зсуває менше', sure > unsure, `${sure} проти ${unsure}`);

  t('бал не виходить за 0…100',
    projectSkill('scene_craft', Array.from({ length: 200 }, () => ev({ type: 'TRANSFER' }))).score === 100);
  t('бал не падає нижче нуля',
    projectSkill('scene_craft', Array.from({ length: 200 }, () => ev({ type: 'TRANSFER', outcome: -1 }))).score === 0);

  // Детермінованість: та сама історія — той самий бал.
  const hist = [ev({ type: 'REVISION_LOOP' }), ev({ type: 'KNOWLEDGE_TEST' }), ev({ type: 'TRANSFER' })];
  t('однакові журнали дають однаковий бал',
    projectSkill('scene_craft', hist).score === projectSkill('scene_craft', [...hist]).score);

  // Докази іншої навички не впливають.
  t('докази чужої навички не зсувають бал',
    projectSkill('pov_narration', [ev({ skill: 'scene_craft', type: 'TRANSFER' })]).score === BASE_SCORE);
}

console.log('\n── WDI 1000 і статус ──');
{
  const empty = projectAll([]);
  t('порожній профіль = 500 зі 1000', wdiScore(empty) === 500, `${wdiScore(empty)}`);
  t('рівень на 500 названий українською', /[А-Яа-яІіЇїЄєҐґ]/.test(wdiLevelUk(500)), wdiLevelUk(500));
  t('нижній рівень — Фундамент', wdiLevelUk(0) === 'Фундамент');
  t('верхній — Майстерність', wdiLevelUk(1000) === 'Майстерність');

  t('мало доказів → INSUFFICIENT_DATA', wdiStatus([ev(), ev()]) === 'INSUFFICIENT_DATA');
  // Багато слабких доказів по трьох навичках — усе одно не STABLE.
  const manyWeak = Array.from({ length: 40 }, (_, i) =>
    ev({ type: 'TEXT_ANALYSIS', skill: (['scene_craft','pov_narration','language_style'] as const)[i % 3] }));
  t('сорок аналізів тексту не дають STABLE',
    ['INSUFFICIENT_DATA','PROVISIONAL'].includes(wdiStatus(manyWeak)), wdiStatus(manyWeak));
  // А різноманітні сильні — дають.
  const strong = WDI_SKILL_IDS.flatMap((s) => [
    ev({ skill: s, type: 'REVISION_LOOP' }), ev({ skill: s, type: 'TRANSFER' }),
  ]);
  t('різноманітні сильні докази дають HIGH_CONFIDENCE',
    wdiStatus(strong) === 'HIGH_CONFIDENCE', wdiStatus(strong));
}

console.log('\n── Стани опанування ──');
{
  // Стан ВИВОДИТЬСЯ, тож розсинхронізуватися нічому — саме цього бракувало
  // в макеті (правки №2 і №3 власника).
  t('один доказ → INTRODUCED', masteryFor(projectSkill('scene_craft', [ev()])) === 'INTRODUCED');

  const strong = Array.from({ length: 12 }, () =>
    ev({ type: 'TRANSFER', independence: 90, confidence: 1 }));
  const st = masteryFor(projectSkill('scene_craft', strong));
  t('багато transfer з високою незалежністю → MASTERED', st === 'MASTERED', st);

  // Без незалежності MASTERED не дається, хоч бал і високий.
  const dependent = Array.from({ length: 12 }, () =>
    ev({ type: 'TRANSFER', independence: 10, confidence: 1 }));
  const dst = masteryFor(projectSkill('scene_craft', dependent));
  t('без незалежності MASTERED не дається', dst !== 'MASTERED', dst);
  t('порядок станів оголошений повністю', W.MASTERY_ORDER.length === 7);
}

console.log('\n── Куди вести автора далі ──');
{
  const events = [
    ...Array.from({ length: 10 }, () => ev({ skill: 'scene_craft', type: 'TRANSFER' })),
    ev({ skill: 'world_continuity', type: 'REVISION_LOOP', outcome: -1 }),
  ];
  const proj = projectAll(events);
  t('найслабша серед НАМІРЯНИХ — та, де негативний доказ',
    weakestSkill(proj) === 'world_continuity', weakestSkill(proj));
  t('не обирає найсильнішу', weakestSkill(proj) !== 'scene_craft');
  // Незміряну навичку слабкою не називаємо — її треба промірити, і це
  // окреме питання. Саме на цьому перша версія моделі й хибила.
  t('незміряну навичку не подає як слабкість',
    projectAll(events)[weakestSkill(proj)].events > 0);
  t('nextToProbe віддає навичку без доказів',
    proj[nextToProbe(proj)].events === 0, nextToProbe(proj));
  t('nextToProbe і weakestSkill відповідають на різні питання',
    nextToProbe(proj) !== weakestSkill(proj));
  // Коли не намірено нічого — вести все одно треба, тож щось віддається.
  const blank = projectAll([]);
  t('на порожньому профілі weakestSkill усе одно відповідає',
    (WDI_SKILL_IDS as string[]).includes(weakestSkill(blank)));
}

console.log('\n── Мапа проблем коуча ──');
{
  const vals = Object.values(COACH_PROBLEM_TO_SKILL) as string[];
  t('усі цілі мапи — справжні компетенції',
    vals.every((v) => (WDI_SKILL_IDS as string[]).includes(v)),
    vals.filter((v) => !(WDI_SKILL_IDS as string[]).includes(v)).join(',') || 'усі справжні');
  // Дев'ять показників «здоров'я сцени» коуча мусять бути покриті.
  for (const k of ['goal','conflict','stakes','choice','emotional_change','pov','rhythm','sensory','intent']) {
    t(`показник коуча «${k}» має компетенцію`, !!COACH_PROBLEM_TO_SKILL[k]);
  }
}

console.log('\n── Сховище: ідемпотентність тримає БАЗА ──');
{
  const db = await import('../server/db.ts');
  const ready = await db.initDb();
  if (!ready) {
    console.log('  (SQLite недоступний — перевірки сховища пропускаємо)');
  } else {
    const store = await import('../server/wdiStore.ts');
    store.__clearEvidenceForTests('u_test');

    t('перший запис проходить',
      store.recordEvidence({ userId:'u_test', skill:'scene_craft', type:'REVISION_LOOP',
        outcome:1, confidence:.9, independence:80, sourceId:'scene:abc:goal' }) === true);
    t('той самий sourceId вдруге НЕ проходить',
      store.recordEvidence({ userId:'u_test', skill:'scene_craft', type:'REVISION_LOOP',
        outcome:1, confidence:.9, independence:80, sourceId:'scene:abc:goal' }) === false);
    t('у журналі один запис, не два', store.countEvidence('u_test') === 1);

    // Той самий ключ в ІНШОГО автора — інша подія, має пройти.
    t('той самий ключ в іншого автора проходить',
      store.recordEvidence({ userId:'u_other', skill:'scene_craft', type:'REVISION_LOOP',
        outcome:1, confidence:.9, independence:80, sourceId:'scene:abc:goal' }) === true);

    let threw = false;
    try {
      store.recordEvidence({ userId:'u_test', skill:'scene_craft', type:'REVISION_LOOP',
        outcome:1, confidence:.9, independence:80, sourceId:'  ' });
    } catch { threw = true; }
    t('доказ без sourceId відкинуто', threw, 'інакше він накручував би бал');

    let threwSkill = false;
    try {
      store.recordEvidence({ userId:'u_test', skill:'нема_такої' as any, type:'REVISION_LOOP',
        outcome:1, confidence:.9, independence:80, sourceId:'x1' });
    } catch { threwSkill = true; }
    t('невідома компетенція відкинута', threwSkill);

    // Значення затискаються при записі, а не тільки при читанні.
    store.recordEvidence({ userId:'u_test', skill:'pov_narration', type:'TRANSFER',
      outcome: 99, confidence: 5, independence: 900, sourceId:'clamp:1' });
    const clamped = store.listEvidenceForSkill('u_test', 'pov_narration', 5)[0];
    t('outcome затиснуто в −1…1', clamped.outcome === 1, `${clamped.outcome}`);
    t('confidence затиснуто в 0…1', clamped.confidence === 1, `${clamped.confidence}`);
    t('independence затиснуто в 0…100', clamped.independence === 100, `${clamped.independence}`);

    // recordMany: один поганий не валить решту.
    const added = store.recordMany([
      { userId:'u_test', skill:'language_style', type:'KNOWLEDGE_TEST', outcome:1, confidence:.8, independence:70, sourceId:'m1' },
      { userId:'u_test', skill:'погана' as any, type:'KNOWLEDGE_TEST', outcome:1, confidence:.8, independence:70, sourceId:'m2' },
      { userId:'u_test', skill:'emotion_reader_impact', type:'KNOWLEDGE_TEST', outcome:1, confidence:.8, independence:70, sourceId:'m3' },
    ]);
    t('recordMany додав два з трьох', added === 2, `${added}`);

    // Проєкція з БАЗИ має збігатися з проєкцією тих самих подій у пам'яті.
    const fromDb = store.listEvidence('u_test');
    const pr = projectSkill('scene_craft', fromDb);
    t('бал із бази обчислюється', pr.events === 1 && pr.score > BASE_SCORE, `${pr.score}`);
    t('докази іншого автора не змішалися',
      store.listEvidence('u_test').every((e) => e.userId === 'u_test'));

    store.__clearEvidenceForTests('u_test');
    store.__clearEvidenceForTests('u_other');
    t('очищення працює', store.countEvidence('u_test') === 0);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
