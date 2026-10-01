/**
 * Прогін набору якості «живих персонажів» на СПРАВЖНІХ моделях (Т2.8 В3,
 * `PLAN_QUALITY.md`, рішення власника §2 п.2) — вручну, з лімітом витрат.
 *
 * Ті самі моделі, що в Студії: голос — модуль «Ядра AI» `coreCharacterVoice`
 * (модель і шаблон адміна), запасний LLM рішень — модуль AI-2, Jev — ключ
 * TypeSafe платформи чи `TYPESAFE_API_KEY` (без ключа рішення й суддя йдуть
 * запасним LLM, і звіт це пише). Ключі моделей — як у сервера (`.env`,
 * ключі платформи в базі Студії).
 *
 *   npm run quality:living-characters -- [--budget 1] [--modes with_jev,without_jev] [--out reports/living-characters]
 *
 * Звіт — `<out>/<час>.md` і `.json` (без промптів і станів Jev). Якщо задано
 * `CORE_DATABASE_URL` — прогін ще й записується в журнал `quality_runs`
 * (його показує розділ «Якість персонажів» в адмінці).
 */
import fs from 'node:fs';
import path from 'node:path';
import { initStore } from '../server/store';
import { LIVING_CHARACTERS_SET } from '../server/core/quality/controlSet';
import { QUALITY_MODES, runLivingCharacters, type QualityMode } from '../server/core/quality/livingCharacters';
import { realQualityDeps } from '../server/core/quality/realDeps';
import { reportForStorage, startQualityRun, withBudget } from '../server/core/quality/qualityRuns';
import { renderQualityReport } from '../server/core/quality/qualityReport';
import { QUALITY_BUDGET_MAX_USD } from '../server/core/quality/qualityRoutes';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const budget = Number(arg('budget', '1'));
if (!(budget > 0) || budget > QUALITY_BUDGET_MAX_USD) {
  console.error(`--budget — від 0.01 до ${QUALITY_BUDGET_MAX_USD} (USD).`);
  process.exit(2);
}
const modes = arg('modes', QUALITY_MODES.join(',')).split(',').map((m) => m.trim()).filter((m): m is QualityMode => (QUALITY_MODES as string[]).includes(m));
const out = path.resolve(arg('out', 'reports/living-characters'));

await initStore();
const actor = 'system:quality-cli';
const { deps, models } = await realQualityDeps(actor);
console.log(`Набір «${LIVING_CHARACTERS_SET.id}» v${LIVING_CHARACTERS_SET.version}: ${LIVING_CHARACTERS_SET.cases.length} кейсів × ${modes.length} режим(и), бюджет $${budget}.`);
console.log(`Моделі: ${deps.label}`);

let report;
const url = process.env.CORE_DATABASE_URL?.trim();
if (url) {
  const { createCorePool } = await import('../server/core/index');
  const { PgCoreRepository } = await import('../server/core/pgRepository');
  const pool = createCorePool(url);
  try {
    const repo = new PgCoreRepository(pool);
    const { run, done } = await startQualityRun(repo, { set: LIVING_CHARACTERS_SET, deps, actor, budgetUsd: budget, modes, models, label: deps.label });
    console.log(`Прогін ${run.id} записується в журнал quality_runs…`);
    const finished = await done;
    console.log(`Статус: ${finished.status}; витрачено $${finished.costUsd}${finished.error ? `; ${finished.error}` : ''}`);
    report = finished.report;
  } finally {
    await pool.end();
  }
} else {
  const { deps: guarded, meter } = withBudget(deps, budget);
  const r = await runLivingCharacters(LIVING_CHARACTERS_SET, guarded, modes);
  console.log(`Витрачено $${meter.spent().toFixed(4)}${meter.exceeded() ? ' — бюджет вичерпано, звіт неповний' : ''}.`);
  report = reportForStorage(r);
}
if (!report) {
  console.error('Звіту немає (див. помилку вище).');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const md = renderQualityReport(report as any);
fs.writeFileSync(path.join(out, `${stamp}.md`), md);
fs.writeFileSync(path.join(out, `${stamp}.json`), JSON.stringify(report, null, 1));
console.log(`\n${md.split('\n## Ворота')[0]}\n\nЗвіт: ${path.join(out, `${stamp}.md`)}`);
process.exit((report as any).passed ? 0 : 1);
