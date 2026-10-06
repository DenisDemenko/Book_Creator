import fs from 'node:fs/promises';
import path from 'node:path';
import {BOOK_SKILLS} from '../server/ai/skills/index';
for(const name of BOOK_SKILLS){const dest=path.join('dist','ai-skills',name);await fs.mkdir(dest,{recursive:true});await fs.copyFile(path.join('server','ai','skills',name,'SKILL.md'),path.join(dest,'SKILL.md'));}
console.log(`Copied ${BOOK_SKILLS.length} book skills to dist/ai-skills.`);
