import os from 'node:os';
import path from 'node:path';
const DIR = path.join(os.tmpdir(), 'nova-live-design');
process.env.DATA_DIR=DIR; process.env.DATABASE_PATH=`${DIR}/n.db`;
import fs from 'node:fs'; import 'dotenv/config';
fs.rmSync(DIR,{recursive:true,force:true}); fs.mkdirSync(DIR,{recursive:true});
const { initStore } = await import('../server/store');
const { resolveCoreTemplate, renderCoreTemplate } = await import('../server/coreAiRegistry');
const { clampDesignPatch, parseDesignResponse } = await import('../server/designLayoutPrompt');
const { generateText } = await import('../server/aiCore');
await initStore();
const FONTS=['Literata','PT Serif','Merriweather','Inter'];
const SAMPLE=`Скляні куполи Верхнього Печерська відбивали перші промені холодного серпневого сонця, перетворюючи неоновий горизонт Нео-Києва на мерехтливу призму. Олена стояла біля панорамного вікна лабораторії на 84-му поверсі.

— Готовність до синхронізації 98 відсотків, пані архітекторко, — спокійний, позбавлений обертонів голос Сварога продзвенів у слуховому імпланті.

Вона торкнулася пальцем холодного скла. Місто внизу жило власним ритмом, і цей ритм ніколи не збігався з її власним.`;
const tpl = resolveCoreTemplate('designLayout');
const rendered = renderCoreTemplate('designLayout', tpl, {
  bookTitle:'Тіні Нео-Києва', genre:'кіберпанк, детектив', audience:'дорослі 25+',
  pageFormat:'152×229 мм (6×9″), друк на кремовому папері',
  availableFonts:FONTS.join(', '), sampleText:SAMPLE,
});
const r = await generateText({engine:'claude', modelId:'claude-sonnet-5', prompt:rendered.user, systemInstruction:rendered.system, label:'Живий /design'} as any);
console.log('--- сира відповідь ---\n'+r.text.trim().slice(0,700));
const patch = clampDesignPatch(parseDesignResponse(r.text), FONTS);
console.log('\n--- ПІСЛЯ ПЕРЕВІРКИ НА ДРУКАРСЬКІ МЕЖІ ---');
console.log(JSON.stringify(patch, null, 2));
