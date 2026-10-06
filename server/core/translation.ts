import { createHash, randomUUID } from 'node:crypto';
import type { CoreRepository, ParagraphRow } from './types';
import type { TranslationWorkspace, TranslationVersion, GlossaryEntry } from './translationTypes';
import { CoreRuleError } from './rules';

export const translationLanguage = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) throw new CoreRuleError('bad_input', 'Потрібен код мови: uk, en, de…');
  return value.toLowerCase();
};
export const glossaryHash = (state: TranslationWorkspace, language: string) => createHash('sha256').update(JSON.stringify(state.glossary.filter(e => e.language === language).sort((a,b) => a.id.localeCompare(b.id)))).digest('hex');
export const translationTags = (text: string) => [...text.matchAll(/\[\/([^:\]\s]+):([^\]]*)\]/g)].map(m => ({ key: m[1], value: m[2], raw: m[0] }));
export function validateTranslation(source: string, translated: string, entries: GlossaryEntry[]) {
  const a = translationTags(source), b = translationTags(translated);
  if (a.length !== b.length || a.some((t,i) => t.key !== b[i].key)) throw new CoreRuleError('bad_input', 'Переклад має зберігати кількість, порядок і ключі тегів.');
  for (let i=0;i<a.length;i++) {
    const entry = entries.find(e => e.source === a[i].value);
    if (b[i].value !== (entry?.target ?? a[i].value)) throw new CoreRuleError('bad_input', `Значення /${a[i].key} має відповідати глосарію.`);
  }
}
export function translationView(state: TranslationWorkspace, paragraph: ParagraphRow, language: string) {
  const record = state.records.find(r => r.paragraphId === paragraph.id && r.language === language);
  const current = record?.versions.at(-1);
  return { paragraphId: paragraph.id, documentId: paragraph.documentId, order: paragraph.order, original: paragraph.text, sourceHash: paragraph.textHash,
    glossaryHash: glossaryHash(state, language), sourceLanguage: record?.sourceLanguage ?? 'uk', language,
    current: current ?? null, versions: record?.versions ?? [],
    needsUpdate: !!current && (current.sourceHash !== paragraph.textHash || current.glossaryHash !== glossaryHash(state, language)) };
}
export async function saveTranslation(repo: CoreRepository, projectId: string, input: {
  paragraphId: string; language: string; sourceLanguage: string; text: string; status: 'draft'|'approved';
  expectedRevision: number; sourceHash: string; glossaryHash: string;
}, actor: string) {
  const state = await repo.getTranslationWorkspace(projectId);
  if (state.revision !== input.expectedRevision) throw new CoreRuleError('conflict', 'Переклад уже змінили. Оновіть сторінку.');
  const p = await repo.getParagraph(projectId, input.paragraphId);
  if (!p || p.deletedAt || p.kind === 'draft') throw new CoreRuleError('not_found', 'Абзац не знайдено.');
  const language = translationLanguage(input.language), sourceLanguage = translationLanguage(input.sourceLanguage);
  if (language === sourceLanguage) throw new CoreRuleError('bad_input', 'Вихідна та цільова мови мають відрізнятись.');
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 100000 || !['draft','approved'].includes(input.status)) throw new CoreRuleError('bad_input', 'Потрібен текст перекладу й правильний статус.');
  if (p.textHash !== input.sourceHash || glossaryHash(state, language) !== input.glossaryHash) throw new CoreRuleError('conflict', 'Оригінал або глосарій змінилися. Оновіть переклад.');
  validateTranslation(p.text, input.text, state.glossary.filter(e => e.language === language));
  let record = state.records.find(r => r.paragraphId === p.id && r.language === language);
  if (!record) { record = { paragraphId: p.id, sourceLanguage, language, versions: [] }; state.records.push(record); }
  if (record.sourceLanguage !== sourceLanguage) throw new CoreRuleError('bad_input', 'Мова оригіналу не збігається з попередніми версіями.');
  const version: TranslationVersion = { version: (record.versions.at(-1)?.version ?? 0)+1, text: input.text, status: input.status, sourceHash: p.textHash, glossaryHash: input.glossaryHash, actor, createdAt: new Date().toISOString() };
  record.versions.push(version);
  const expected = state.revision++; await repo.saveTranslationWorkspace(projectId, state, expected);
  return { revision: state.revision, version };
}
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function renameTranslatedTerm(text: string, old: string, next: string): string {
  // Split tags so the entity key can never be changed by a terminology update.
  return text.split(/(\[\/[^:\]\s]+:[^\]]*\])/g).map(part => {
    if (/^\[\//.test(part)) return part.replace(/:(.*?)\]$/, (_match, value) => `:${value === old ? next : value}]`);
    return part.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(old)}(?![\\p{L}\\p{N}_])`, 'gu'), () => next);
  }).join('');
}
export async function updateGlossary(repo: CoreRepository, projectId: string, input: {
  id?: string; language: string; source: string; target: string; entityId?: string|null; expectedRevision: number;
}) {
  const state = await repo.getTranslationWorkspace(projectId);
  if (state.revision !== input.expectedRevision) throw new CoreRuleError('conflict', 'Глосарій уже змінили. Оновіть сторінку.');
  const language = translationLanguage(input.language);
  if (typeof input.source !== 'string' || typeof input.target !== 'string' || !input.source.trim() || !input.target.trim() || input.source.length > 200 || input.target.length > 200 || /[\[\]\r\n]/.test(input.source+input.target)) throw new CoreRuleError('bad_input', 'Потрібні короткі ім’я або термін без тегових дужок.');
  const old = input.id ? state.glossary.find(e => e.id === input.id && e.language === language) : null;
  if (input.id && !old) throw new CoreRuleError('not_found', 'Запис глосарія не знайдено.');
  const referenceId = input.entityId || old?.entityId;
  const matching = !referenceId ? (await repo.listEntities(projectId)).filter(e => e.status === 'confirmed' && e.name === input.source.trim()) : [];
  const entity = referenceId ? await repo.getEntity(projectId, referenceId) : matching.length === 1 ? matching[0] : null;
  if (referenceId && (!entity || entity.status !== 'confirmed')) throw new CoreRuleError('not_found', 'Сутність не належить затвердженому канону.');
  if (old && old.source !== input.source.trim()) throw new CoreRuleError('bad_input', 'Зміну вихідного терміна додайте новим записом.');
  if (state.glossary.some(e => e.id !== old?.id && e.language === language && e.source === input.source.trim())) throw new CoreRuleError('conflict', 'Термін уже є у глосарії цієї мови.');
  const entry: GlossaryEntry = { id: old?.id ?? randomUUID(), language, source: input.source.trim(), target: input.target.trim(), entityId: entity?.id ?? old?.entityId ?? null };
  entry.previousTargets = [...new Set([...(old?.previousTargets ?? []), ...(old && old.target !== entry.target ? [old.target] : [])])].filter(t => t !== entry.target);
  const proposals = old && old.target !== entry.target ? state.records.filter(r => r.language === language).flatMap(r => {
    const current = r.versions.at(-1); if (!current) return [];
    // Also catch versions whose earlier rename was never accepted.
    let text = current.text;
    for (const term of entry.previousTargets ?? []) text = renameTranslatedTerm(text, term, entry.target);
    return text === current.text ? [] : [{ paragraphId: r.paragraphId, before: current.text, text, version: current.version }];
  }) : [];
  if (old) state.glossary[state.glossary.indexOf(old)] = entry; else state.glossary.push(entry);
  // Translated tag values resolve to the original entity, including old versions.
  if (entity) {
    const existingAlias = await repo.resolveAlias(projectId, entity.type, entry.target);
    if (existingAlias && existingAlias !== entity.id) throw new CoreRuleError('conflict', 'Перекладене ім’я вже належить іншій сутності.');
  }
  const expected = state.revision++; await repo.saveTranslationWorkspace(projectId, state, expected, entity ? [{entityId:entity.id,alias:entry.target}] : []);
  return { revision: state.revision, entry, proposals };
}
