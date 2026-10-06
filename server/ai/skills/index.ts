/** Trusted server loader: fixed assets only; never exposed as an agent filesystem tool. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const BOOK_SKILLS = ['character-arc','dialogue-craft','emotion-dynamics','interrogation','mystery-foreshadowing','author-style','continuity-check'] as const;
export type BookSkill = typeof BOOK_SKILLS[number];
const cache = new Map<BookSkill,string>();
export function skillInstructions(names: readonly BookSkill[]): string {
 return names.map(name=>{
  if(!BOOK_SKILLS.includes(name))throw new Error('Unknown book skill');
  if(!cache.has(name)){
   const base=path.dirname(fileURLToPath(import.meta.url));
   const roots=[path.join(base,'ai-skills'),base];
   const source=roots.map(root=>path.join(root,name,'SKILL.md')).find(file=>fs.existsSync(file));
   if(!source)throw new Error(`Missing skill asset: ${name}`);
   const value=fs.readFileSync(source,'utf8');if(Buffer.byteLength(value)>16384)throw new Error('Skill asset exceeds 16 KiB');cache.set(name,value);
  }
  return cache.get(name)!;
 }).join('\n\n');
}
