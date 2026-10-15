import { extractChatFileText, fileToBase64 } from './extractChatFileText';
import { wizardApi } from './expressDraftSession';
import type { WizardSource } from '../../shared/wizardScenarios';
export async function importWizardFile(file:File):Promise<WizardSource> {
 if(file.size>8*1024*1024)throw new Error('Один файл — до 8 МБ.');
 const id=crypto.randomUUID();
 if(['image/jpeg','image/png','image/webp'].includes(file.type)){
  const dataUrl='data:'+file.type+';base64,'+await fileToBase64(file);
  const {asset}=await wizardApi<{asset:{id:string;url:string}}>('/api/media/upload',{method:'POST',body:JSON.stringify({dataUrl,filename:file.name,kind:'upload'})});
  return {id,kind:'photo',title:file.name,text:'',approved:false,assetId:asset.id};
 }
 let text:string;
 if(/\.docx$/i.test(file.name)){
  const mammoth=await import('mammoth');
  text=(await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;
 }else text=await extractChatFileText(file);
 if(!text.trim())throw new Error('Файл не містить доступного тексту. Для скану використайте наявний OCR у Студії або додайте сторінки як фото.');
 if(text.length>100000)throw new Error('Оберіть фрагмент до 100 000 символів.');
 return {id,kind:'file',title:file.name,text,approved:false};
}
