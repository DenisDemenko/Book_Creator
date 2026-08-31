import {
  normalizeAspectRatio, resolveEngine, generateImage, saveGeneratedImage,
  IMAGE_ENGINES, listEngines, ImageGenerationError, GENERATED_DIR, seedreamConfig, seedreamTransportFor
} from '../server/imageGeneration';
import fs from 'node:fs/promises';

let pass=0, fail=0;
const t=(n:string,c:boolean,e='')=>{c?pass++:fail++;console.log(`${c?'  ✓':'  ✗'} ${n}${e?' — '+e:''}`);};

// 1×1 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

console.log('normalizeAspectRatio:');
t('16:9 → 16:9', normalizeAspectRatio('16:9')==='16:9');
t('порожнє → 1:1', normalizeAspectRatio(undefined)==='1:1');
t('1920x1080 → 16:9', normalizeAspectRatio('1920x1080')==='16:9');
t('2:3 → 3:4 (найближче)', normalizeAspectRatio('2:3')==='3:4', normalizeAspectRatio('2:3'));
t('сміття → 1:1', normalizeAspectRatio('абв')==='1:1');
t('21:9 → 16:9', normalizeAspectRatio('21:9')==='16:9', normalizeAspectRatio('21:9'));

console.log('\nresolveEngine:');
t('nano-banana-2', resolveEngine('nano-banana-2').id==='nano-banana-2');
t('nano-banana-pro', resolveEngine('nano-banana-pro').id==='nano-banana-pro');
t('nano-banana-2-lite', resolveEngine('nano-banana-2-lite').id==='nano-banana-2-lite');
t('старе "midjourney-v6" → двигун за замовчуванням', resolveEngine('midjourney-v6').id==='nano-banana-2');
t('старе "imagen-4" → двигун за замовчуванням', resolveEngine('imagen-4').id==='nano-banana-2');
t('старе "nano-banana" → двигун за замовчуванням', resolveEngine('nano-banana').id==='nano-banana-2');
t('модель Nano Banana 2 правильна', IMAGE_ENGINES['nano-banana-2'].modelId==='gemini-3.1-flash-image');
t('модель Nano Banana Pro правильна', IMAGE_ENGINES['nano-banana-pro'].modelId==='gemini-3-pro-image');
t('модель Lite правильна', IMAGE_ENGINES['nano-banana-2-lite'].modelId==='gemini-3.1-flash-lite-image');
t('seedream резолвиться', resolveEngine('seedream').id==='seedream');
t('seedream — провайдер bytedance', IMAGE_ENGINES['seedream'].provider==='bytedance');

console.log('\nбез ключа:');
try { await generateImage(null, {prompt:'кіт'}); t('кидає помилку', false); }
catch(e:any){ t('kind = no_key', e.kind==='no_key'); t('повідомлення українською', /GEMINI_API_KEY/.test(e.message), e.message.slice(0,60)+'…'); }

console.log('\nбез ключа — повідомлення називає ОБРАНИЙ двигун, не просто "Gemini" узагальнено:');
// Nano Banana технічно йде через Gemini API (той самий ключ), але автор,
// що явно обрав «Nano Banana 2» у списку, мав побачити цю саму назву в
// помилці — інакше читається так, ніби викликали зовсім інший двигун.
for (const engineId of ['nano-banana-2-lite', 'nano-banana-2', 'nano-banana-pro'] as const) {
  try { await generateImage(null, { prompt: 'кіт', engine: engineId }); t(`${engineId}: кидає помилку`, false); }
  catch (e: any) {
    t(`${engineId}: повідомлення згадує назву двигуна`, e.message.includes(IMAGE_ENGINES[engineId].label), e.message);
    t(`${engineId}: усе одно згадує GEMINI_API_KEY (ключ спільний для всіх Nano Banana)`, /GEMINI_API_KEY/.test(e.message));
  }
}

console.log('\nNano Banana 2 (підставний SDK):');
{
  let captured:any=null;
  const fakeAi:any={ interactions:{ create:async(a:any)=>{ captured=a; return { output_image:{data:PNG_B64, mime_type:'image/png', type:'image'} }; } } };
  const r=await generateImage(fakeAi,{prompt:'нічний Київ', engine:'nano-banana-2', aspectRatio:'16:9', negativePrompt:'blurry'});
  t('викликано правильну модель', captured.model==='gemini-3.1-flash-image', captured.model);
  t('передано aspect_ratio', captured.response_format.aspect_ratio==='16:9');
  t('передано image_size', captured.response_format.image_size==='2K');
  t('негативний промпт дописано', /Avoid: blurry/.test(captured.input));
  t('повернуто буфер PNG', Buffer.isBuffer(r.buffer) && r.buffer.subarray(1,4).toString()==='PNG');
  t('mimeType', r.mimeType==='image/png');
}

console.log('\nNano Banana Pro та Lite (підставний SDK):');
{
  let captured:any=null;
  const fakeAi:any={ interactions:{ create:async(a:any)=>{ captured=a; return { output_image:{data:PNG_B64, mime_type:'image/png'} }; } } };
  await generateImage(fakeAi,{prompt:'ліс', engine:'nano-banana-pro', aspectRatio:'3:4'});
  t('Pro → gemini-3-pro-image', captured.model==='gemini-3-pro-image', captured.model);
  t('Pro отримує 2K', captured.response_format.image_size==='2K');
  await generateImage(fakeAi,{prompt:'ліс', engine:'nano-banana-2-lite', imageSize:'2K'});
  t('Lite → gemini-3.1-flash-lite-image', captured.model==='gemini-3.1-flash-lite-image', captured.model);
  t('Lite примусово знижено до 1K', captured.response_format.image_size==='1K', captured.response_format.image_size);
}

console.log('\nпорожня відповідь моделі:');
{
  const fakeAi:any={ interactions:{ create:async()=>({}) } };
  try { await generateImage(fakeAi,{prompt:'x'}); t('кидає помилку', false); }
  catch(e:any){ t('kind = empty', e.kind==='empty', e.kind); }
}

console.log('\nSeedream без ключа:');
{
  const fakeAi:any={ interactions:{ create:async()=>{ throw new Error('should not be called'); } } };
  try { await generateImage(fakeAi, {prompt:'кіт', engine:'seedream'}); t('кидає помилку', false); }
  catch(e:any){ t('kind = no_key', e.kind==='no_key'); t('повідомлення про ARK_API_KEY', /ARK_API_KEY/.test(e.message), e.message.slice(0,60)+'…'); }
}

console.log('\nSeedream (підставний fetch):');
{
  const realFetch = global.fetch;
  seedreamConfig.apiKey = 'test-ark-key';
  let capturedUrl='', capturedInit:any=null;
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url:string, init:any) => {
    capturedUrl = url; capturedInit = init;
    return { ok:true, status:200, json: async()=>({ data:[{ b64_json: PNG_B64 }] }) };
  };
  try {
    const r = await generateImage(null, {prompt:'лаунж-крісло', engine:'seedream', aspectRatio:'3:4', negativePrompt:'blurry'});
    t('URL — images/generations на baseUrl', capturedUrl===`${seedreamConfig.baseUrl}/images/generations`, capturedUrl);
    t('Authorization Bearer з ключем', capturedInit.headers.Authorization==='Bearer test-ark-key');
    const body = JSON.parse(capturedInit.body);
    t('модель з IMAGE_ENGINES', body.model===IMAGE_ENGINES.seedream.modelId, body.model);
    t('response_format = b64_json', body.response_format==='b64_json');
    t('watermark вимкнено', body.watermark===false);
    t('size — точні пікселі під 3:4', body.size==='1536x2048', body.size);
    t('negative_prompt передано окремим полем (не дописано в prompt)', body.negative_prompt==='blurry' && !/Avoid:/.test(body.prompt));
    t('повернуто буфер PNG', Buffer.isBuffer(r.buffer) && r.buffer.subarray(1,4).toString()==='PNG');
    t('engine у результаті — seedream', r.engine.id==='seedream');
  } finally {
    global.fetch = realFetch;
  }
}

console.log('\nВибір транспорту за формою ключа:');
{
  const prev = process.env.SEEDREAM_TRANSPORT;
  delete process.env.SEEDREAM_TRANSPORT;
  t('ключ fal (id:secret) → fal', seedreamTransportFor('9a1b-c2d3:0f8e7d6c5b4a')==='fal');
  t('ключ Ark (суцільний токен) → ark', seedreamTransportFor('4b0f9e2a-77c1-4d3e-9a11-2f6b8c0d1e33')==='ark');
  t('порожній ключ → ark (нічого не ламає стару поведінку)', seedreamTransportFor('')==='ark');
  process.env.SEEDREAM_TRANSPORT = 'ark';
  t('SEEDREAM_TRANSPORT перекриває форму ключа', seedreamTransportFor('id:secret')==='ark');
  process.env.SEEDREAM_TRANSPORT = 'FAL';
  t('перемикач нечутливий до регістру', seedreamTransportFor('плаский-токен')==='fal');
  if (prev===undefined) delete process.env.SEEDREAM_TRANSPORT; else process.env.SEEDREAM_TRANSPORT = prev;
}

console.log('\nSeedream через fal.ai (підставний fetch):');
{
  const realFetch = global.fetch;
  const prevKey = seedreamConfig.apiKey;
  seedreamConfig.apiKey = 'falid-123:falsecret-456';
  const calls:any[] = [];
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url:string, init:any) => {
    calls.push({ url, init });
    if (calls.length===1) {
      return { ok:true, status:200, json: async()=>({
        images:[{ url:'https://v3.fal.media/files/x/out.png', content_type:'image/png' }], seed:7,
      }) };
    }
    return { ok:true, status:200, arrayBuffer: async()=>Buffer.from(PNG_B64,'base64') };
  };
  try {
    const r = await generateImage(null, {prompt:'лаунж-крісло', engine:'seedream', aspectRatio:'3:4'});
    t('URL — синхронний ендпоїнт fal з моделлю Seedream',
      calls[0].url==='https://fal.run/fal-ai/bytedance/seedream/v4/text-to-image', calls[0].url);
    t('Authorization — схема Key, а не Bearer',
      calls[0].init.headers.Authorization==='Key falid-123:falsecret-456', calls[0].init.headers.Authorization);
    const body = JSON.parse(calls[0].init.body);
    t('image_size — обʼєкт із пікселями під 3:4', body.image_size.width===1536 && body.image_size.height===2048,
      JSON.stringify(body.image_size));
    t('num_images = 1', body.num_images===1);
    t('модель не дублюється в тілі (вона в URL)', body.model===undefined);
    t('другим запитом забрано сам файл', calls.length===2 && calls[1].url==='https://v3.fal.media/files/x/out.png');
    t('повернуто буфер PNG', Buffer.isBuffer(r.buffer) && r.buffer.subarray(1,4).toString()==='PNG');
    t('engine у результаті — seedream', r.engine.id==='seedream');
  } finally {
    global.fetch = realFetch;
    seedreamConfig.apiKey = prevKey;
  }
}

console.log('\nfal.ai — помилки доходять до автора:');
{
  const realFetch = global.fetch;
  const prevKey = seedreamConfig.apiKey;
  seedreamConfig.apiKey = 'falid:falsecret';
  try {
    // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
    global.fetch = async () => ({ ok:false, status:401, json: async()=>({ detail:'Unauthorized' }) });
    try {
      await generateImage(null,{prompt:'x', engine:'seedream'});
      t('401 кидає помилку', false);
    } catch (e:any) {
      t('401 → no_key', e instanceof ImageGenerationError && e.kind==='no_key', e.kind);
      t('текст помилки називає fal, а не Ark', /fal/.test(e.message), e.message);
    }

    // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
    global.fetch = async () => ({ ok:false, status:422, json: async()=>({ detail:[{ msg:'prompt too long' }] }) });
    try {
      await generateImage(null,{prompt:'x', engine:'seedream'});
      t('422 кидає помилку', false);
    } catch (e:any) {
      t('detail-масив розгортається у читабельний текст', /prompt too long/.test(e.message), e.message);
    }

    // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
    global.fetch = async () => ({ ok:true, status:200, json: async()=>({ images:[] }) });
    try {
      await generateImage(null,{prompt:'x', engine:'seedream'});
      t('порожній список зображень кидає помилку', false);
    } catch (e:any) {
      t('порожня відповідь → empty', e.kind==='empty', e.kind);
    }
  } finally {
    global.fetch = realFetch;
    seedreamConfig.apiKey = prevKey;
  }
}

console.log('\nSeedream — класифікація HTTP-помилок:');
{
  const realFetch = global.fetch;
  seedreamConfig.apiKey = 'test-ark-key';
  for (const [status, message, kind] of [[401,'Unauthorized','no_key'],[403,'Forbidden','no_key'],[429,'Too Many Requests','quota'],[400,'Content blocked by moderation','safety'],[500,'Internal error','unknown']] as const) {
    // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
    global.fetch = async () => ({ ok:false, status, json: async()=>({ error:{ message } }) });
    try { await generateImage(null,{prompt:'x', engine:'seedream'}); t(`HTTP ${status}`, false); }
    catch(e:any){ t(`HTTP ${status} "${message}" → ${kind}`, e.kind===kind, e.kind); }
  }
  global.fetch = realFetch;
  seedreamConfig.apiKey = '';
}

console.log('\nкласифікація помилок провайдера:');
for (const [msg, kind] of [['API key not valid','no_key'],['403 Unexpected Status or Content-Type: Status 403','no_key'],['Status 401','no_key'],['Response blocked by safety filters','safety'],['429 RESOURCE_EXHAUSTED quota','quota'],['socket hang up','unknown']] as const){
  const fakeAi:any={ interactions:{ create:async()=>{ throw new Error(msg); } } };
  try { await generateImage(fakeAi,{prompt:'x'}); t(`"${msg}"`, false); }
  catch(e:any){ t(`"${msg}" → ${kind}`, e.kind===kind, e.kind); }
}

console.log('\nзбереження файлу:');
{
  const saved = await saveGeneratedImage(Buffer.from(PNG_B64,'base64'),'image/png','char-Ярослав «Спектр»');
  t('URL має префікс /generated/', saved.url.startsWith('/generated/'), saved.url);
  t('імʼя файлу безпечне (лише ASCII)', /^[a-zA-Z0-9_.-]+$/.test(saved.filename), saved.filename);
  t('розширення .png', saved.filename.endsWith('.png'));
  const stat = await fs.stat(`${GENERATED_DIR}/${saved.filename}`);
  t('файл справді на диску', stat.size===saved.bytes && stat.size>0, `${stat.size} байт`);
  await fs.unlink(`${GENERATED_DIR}/${saved.filename}`);
}

console.log('\nсписок двигунів для UI:');
{
  const list = listEngines({ google:false, bytedance:false });
  t('рівно 4 двигуни', list.length===4, list.map(e=>e.id).join(', '));
  t('без жодного ключа available=false для всіх', list.every(e=>!e.available));
  t('лише Google-ключ → доступні тільки 3 Nano Banana', (()=>{
    const l = listEngines({ google:true, bytedance:false });
    return l.filter(e=>e.provider==='google').every(e=>e.available) && !l.find(e=>e.id==='seedream')!.available;
  })());
  t('лише ByteDance-ключ → доступний тільки seedream', (()=>{
    const l = listEngines({ google:false, bytedance:true });
    return l.find(e=>e.id==='seedream')!.available && l.filter(e=>e.provider==='google').every(e=>!e.available);
  })());
  t('обидва ключі → усі доступні', listEngines({ google:true, bytedance:true }).every(e=>e.available));
  t('Midjourney відсутній', !JSON.stringify(list).toLowerCase().includes('midjourney'));
  t('DALL·E відсутній', !JSON.stringify(list).toLowerCase().includes('dall'));
  t('Imagen відсутній', !JSON.stringify(list).toLowerCase().includes('imagen'));
  t('Seedance (відео) відсутній серед двигунів зображень', !list.some(e=>e.id.toLowerCase()==='seedance'));
}

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail?1:0);
