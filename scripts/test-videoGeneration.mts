import {
  resolveVideoEngine,
  generateVideo,
  VIDEO_ENGINES,
  listVideoEngines,
  VideoGenerationError,
  humanVideoMessage,
  engineModelId,
  type V1VideoEngineInfo,
  type V2VideoEngineInfo,
} from '../server/videoGeneration';
import { leonardoConfig } from '../server/imageGeneration';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const MP4_BYTES = Buffer.from('00000018667479706d703432', 'hex'); // фейкові байти — тесту байдужий реальний контейнер, лише довжина > 0.

/** Тестові .mts не проходять контроль типів так суворо, як конкретний рушій зі свого id — звузити один раз тут зручніше, ніж на кожному рядку. */
const asV1 = (id: string) => VIDEO_ENGINES[id as keyof typeof VIDEO_ENGINES] as V1VideoEngineInfo;
const asV2 = (id: string) => VIDEO_ENGINES[id as keyof typeof VIDEO_ENGINES] as V2VideoEngineInfo;

console.log('resolveVideoEngine:');
t('leonardo-motion2 резолвиться', resolveVideoEngine('leonardo-motion2').id === 'leonardo-motion2');
t('leonardo-veo3 резолвиться', resolveVideoEngine('leonardo-veo3').id === 'leonardo-veo3');
t('leonardo-veo3-fast резолвиться', resolveVideoEngine('leonardo-veo3-fast').id === 'leonardo-veo3-fast');
t('leonardo-kling2-1 резолвиться', resolveVideoEngine('leonardo-kling2-1').id === 'leonardo-kling2-1');
t('leonardo-kling2-5 резолвиться', resolveVideoEngine('leonardo-kling2-5').id === 'leonardo-kling2-5');
t('leonardo-seedance-2-5 резолвиться', resolveVideoEngine('leonardo-seedance-2-5').id === 'leonardo-seedance-2-5');
t('leonardo-wan-3 резолвиться', resolveVideoEngine('leonardo-wan-3').id === 'leonardo-wan-3');
t('leonardo-kling-o3 резолвиться', resolveVideoEngine('leonardo-kling-o3').id === 'leonardo-kling-o3');
t('leonardo-flux-3-video резолвиться', resolveVideoEngine('leonardo-flux-3-video').id === 'leonardo-flux-3-video');
t('невідомий рядок → двигун за замовчуванням', resolveVideoEngine('щось-невідоме').id === 'leonardo-motion2');
t('без аргументу → двигун за замовчуванням', resolveVideoEngine(undefined).id === 'leonardo-motion2');

console.log('\nVIDEO_ENGINES v1 — точні рядки моделі Leonardo (звірено з docs.leonardo.ai, вересень 2026):');
t('MOTION2', asV1('leonardo-motion2').leonardoModel === 'MOTION2');
t('MOTION2FAST', asV1('leonardo-motion2-fast').leonardoModel === 'MOTION2FAST');
t('VEO3', asV1('leonardo-veo3').leonardoModel === 'VEO3');
t('VEO3FAST', asV1('leonardo-veo3-fast').leonardoModel === 'VEO3FAST');
t('KLING2_1', asV1('leonardo-kling2-1').leonardoModel === 'KLING2_1');
t('KLING2_5', asV1('leonardo-kling2-5').leonardoModel === 'KLING2_5');
t('усі v1-двигуни позначені apiVersion=v1', ['leonardo-motion2', 'leonardo-motion2-fast', 'leonardo-veo3', 'leonardo-veo3-fast', 'leonardo-kling2-1', 'leonardo-kling2-5'].every((id) => VIDEO_ENGINES[id as keyof typeof VIDEO_ENGINES].apiVersion === 'v1'));

t('Motion 2.0 не пропонує тривалість (недокументовано)', asV1('leonardo-motion2').durationsSec === null);
t('Veo3 — 4/6/8с', JSON.stringify(asV1('leonardo-veo3').durationsSec) === '[4,6,8]');
t('Kling 2.5 — 5/10с', JSON.stringify(asV1('leonardo-kling2-5').durationsSec) === '[5,10]');
t('Kling 2.5 єдина з перших шести з 1:1 (1440×1440 підтверджено документацією)', VIDEO_ENGINES['leonardo-kling2-5'].aspectRatios.includes('1:1'));
t('Veo3 без 1:1 (не підтверджено)', !VIDEO_ENGINES['leonardo-veo3'].aspectRatios.includes('1:1'));

console.log('\nVIDEO_ENGINES v2 — точні рядки моделі й полів роздільності (задача #202, звірено з docs.leonardo.ai + прикладами власника):');
t('bytedance/seedance-2.5', asV2('leonardo-seedance-2-5').modelSlug === 'bytedance/seedance-2.5');
t('alibaba/wan-3.0', asV2('leonardo-wan-3').modelSlug === 'alibaba/wan-3.0');
t('kling-video-o-3', asV2('leonardo-kling-o3').modelSlug === 'kling-video-o-3');
t('bfl/flux-3-video', asV2('leonardo-flux-3-video').modelSlug === 'bfl/flux-3-video');
t('усі v2-двигуни позначені apiVersion=v2', ['leonardo-seedance-2-5', 'leonardo-wan-3', 'leonardo-kling-o3', 'leonardo-flux-3-video'].every((id) => VIDEO_ENGINES[id as keyof typeof VIDEO_ENGINES].apiVersion === 'v2'));

t('Seedance 2.5: 4–30с (docs.leonardo.ai/docs/seedance-25)', asV2('leonardo-seedance-2-5').durationMinSec === 4 && asV2('leonardo-seedance-2-5').durationMaxSec === 30);
t('Seedance 2.5: без поля роздільності (лише width/height)', asV2('leonardo-seedance-2-5').resolutionField === null);
t('Wan 3.0: 2–30с (docs.leonardo.ai/docs/wan-30)', asV2('leonardo-wan-3').durationMinSec === 2 && asV2('leonardo-wan-3').durationMaxSec === 30);
t('Wan 3.0: поле "resolution" у форматі "720p"', asV2('leonardo-wan-3').resolutionField?.key === 'resolution' && asV2('leonardo-wan-3').resolutionField!.format('720') === '720p');
t('Kling O3: 3–15с (docs.leonardo.ai/docs/kling-o3)', asV2('leonardo-kling-o3').durationMinSec === 3 && asV2('leonardo-kling-o3').durationMaxSec === 15);
t('Kling O3: поле "mode" у форматі "RESOLUTION_1080"', asV2('leonardo-kling-o3').resolutionField?.key === 'mode' && asV2('leonardo-kling-o3').resolutionField!.format('1080') === 'RESOLUTION_1080');
t('FLUX 3 Video: 5–20с (docs.leonardo.ai/docs/flux-3-video)', asV2('leonardo-flux-3-video').durationMinSec === 5 && asV2('leonardo-flux-3-video').durationMaxSec === 20);
t('FLUX 3 Video: поле "resolution" у форматі "1080p"', asV2('leonardo-flux-3-video').resolutionField?.key === 'resolution' && asV2('leonardo-flux-3-video').resolutionField!.format('1080') === '1080p');

console.log('\nengineModelId — одна назва поля незалежно від покоління API:');
t('v1 → leonardoModel', engineModelId(VIDEO_ENGINES['leonardo-veo3']) === 'VEO3');
t('v2 → modelSlug', engineModelId(VIDEO_ENGINES['leonardo-wan-3']) === 'alibaba/wan-3.0');

console.log('\nlistVideoEngines:');
{
  const list = listVideoEngines({ leonardo: true });
  t('рівно 10 двигунів (6 v1 + 4 v2, задача #202)', list.length === 10, String(list.length));
  t('усі доступні, коли ключ є', list.every((e) => e.available === true));
  const listNoKey = listVideoEngines({ leonardo: false });
  t('жоден недоступний без ключа', listNoKey.every((e) => e.available === false));
  const seedance = list.find((e) => e.id === 'leonardo-seedance-2-5');
  t('v2-двигун віддає durationMinSec/Max, а не durationsSec', seedance?.durationsSec === null && seedance?.durationMinSec === 4 && seedance?.durationMaxSec === 30);
  const veo3 = list.find((e) => e.id === 'leonardo-veo3');
  t('v1-двигун і далі віддає durationsSec, durationMin/Max — null', Array.isArray(veo3?.durationsSec) && veo3?.durationMinSec === null);
}

console.log('\nhumanVideoMessage:');
t('no_key згадує Leonardo.Ai і ключі API', /Ключі API/.test(humanVideoMessage('no_key', 'Leonardo Motion 2.0')));

console.log('\nLeonardo відео — без ключа:');
{
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = '';
  try {
    await generateVideo({ prompt: 'кіт грає з клубком', engine: 'leonardo-motion2' });
    t('мало кинути помилку no_key', false);
  } catch (e: any) {
    t('це VideoGenerationError', e instanceof VideoGenerationError);
    t('kind === no_key', e.kind === 'no_key', e.kind);
  } finally {
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nLeonardo відео — порожній промпт:');
{
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  try {
    await generateVideo({ prompt: '   ', engine: 'leonardo-motion2' });
    t('мало кинути помилку на порожній промпт', false);
  } catch (e: any) {
    t('повідомлення про порожній промпт', /[Пп]орожн/.test(e.message), e.message);
  } finally {
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nLeonardo відео — класифікація HTTP-помилок відправлення генерації:');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) });
  try {
    await generateVideo({ prompt: 'x', engine: 'leonardo-veo3' });
    t('401 мав кинути помилку', false);
  } catch (e: any) {
    t('401 → kind no_key', e.kind === 'no_key', e.kind);
  }
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: 'Too many requests' }) });
  try {
    await generateVideo({ prompt: 'x', engine: 'leonardo-veo3' });
    t('429 мав кинути помилку', false);
  } catch (e: any) {
    t('429 → kind quota', e.kind === 'quota', e.kind);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nLeonardo відео — повний цикл (Motion 2.0, v1: submit → poll PENDING → poll COMPLETE → завантаження):');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  const seenBodies: any[] = [];
  const seenUrls: string[] = [];
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url: string, opts?: any) => {
    call++;
    seenUrls.push(String(url));
    if (String(url).endsWith('/generations-text-to-video') && call === 1) {
      seenBodies.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ sdGenerationJob: { generationId: 'vid-123' } }) };
    }
    if (String(url).includes('/generations/vid-123') && call === 2) {
      return { ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'PENDING' } }) };
    }
    if (String(url).includes('/generations/vid-123') && call === 3) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_videos: [{ url: 'https://example.com/result.mp4' }] } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'video/mp4' : null) },
      arrayBuffer: async () => MP4_BYTES.buffer,
    };
  };
  try {
    const result = await generateVideo({ prompt: 'кіт на пляжі', engine: 'leonardo-motion2' });
    t('повернув буфер із даними', result.buffer.length > 0);
    t('mimeType video/mp4', result.mimeType === 'video/mp4', result.mimeType);
    t('resolution 480 (єдина документована для Motion)', result.resolution === '480', result.resolution);
    t('durationSec null (Motion недокументовано)', result.durationSec === null, String(result.durationSec));
    t('рівно 4 виклики fetch (submit + 2 опитування + завантаження)', call === 4, String(call));
    t('тіло запиту містить model=MOTION2', seenBodies[0]?.model === 'MOTION2', JSON.stringify(seenBodies[0]));
    t('тіло запиту НЕ містить duration (недокументовано для Motion)', !('duration' in (seenBodies[0] || {})));
    t('відправлення пішло на v1 /generations-text-to-video, НЕ на /v2/generations', seenUrls[0].endsWith('/generations-text-to-video') && !seenUrls[0].includes('/v2/'), seenUrls[0]);
  } catch (e: any) {
    t('успішний цикл не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nLeonardo відео — Veo3 надсилає duration і правильні пікселі 1080p (v1):');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  const seenBodies: any[] = [];
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url: string, opts?: any) => {
    call++;
    if (call === 1) {
      seenBodies.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ sdGenerationJob: { generationId: 'vid-veo' } }) };
    }
    if (call === 2) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_videos: [{ url: 'https://example.com/veo.mp4' }] } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'video/mp4' : null) },
      arrayBuffer: async () => MP4_BYTES.buffer,
    };
  };
  try {
    const result = await generateVideo({
      prompt: 'кінематографічний огляд крісла',
      engine: 'leonardo-veo3',
      resolution: '1080',
      durationSec: 6,
    });
    t('тіло запиту містить model=VEO3', seenBodies[0]?.model === 'VEO3', JSON.stringify(seenBodies[0]));
    t('тіло запиту містить duration=6', seenBodies[0]?.duration === 6, String(seenBodies[0]?.duration));
    t('тіло запиту 1920×1080', seenBodies[0]?.width === 1920 && seenBodies[0]?.height === 1080, JSON.stringify(seenBodies[0]));
    t('тіло запиту resolution=RESOLUTION_1080', seenBodies[0]?.resolution === 'RESOLUTION_1080', seenBodies[0]?.resolution);
    t('result.durationSec === 6', result.durationSec === 6, String(result.durationSec));
  } catch (e: any) {
    t('Veo3-цикл не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nLeonardo відео — невалідна тривалість/роздільність мовчки замінюється на дефолт двигуна (v1):');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  const seenBodies: any[] = [];
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url: string, opts?: any) => {
    call++;
    if (call === 1) {
      seenBodies.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ sdGenerationJob: { generationId: 'vid-bad' } }) };
    }
    if (call === 2) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_videos: [{ url: 'https://example.com/x.mp4' }] } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'video/mp4' : null) },
      arrayBuffer: async () => MP4_BYTES.buffer,
    };
  };
  try {
    await generateVideo({ prompt: 'x', engine: 'leonardo-kling2-5', resolution: '4K', durationSec: 999 });
    t('duration впав на дефолт (5)', seenBodies[0]?.duration === 5, String(seenBodies[0]?.duration));
    t('resolution впала на дефолт (1080)', seenBodies[0]?.resolution === 'RESOLUTION_1080', seenBodies[0]?.resolution);
  } catch (e: any) {
    t('цикл з невалідними параметрами не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nLeonardo відео — статус FAILED зупиняє опитування одразу (v1):');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async () => {
    call++;
    if (call === 1) return { ok: true, status: 200, json: async () => ({ sdGenerationJob: { generationId: 'vid-fail' } }) };
    return { ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'FAILED' } }) };
  };
  try {
    await generateVideo({ prompt: 'x', engine: 'leonardo-motion2' });
    t('FAILED мав кинути помилку', false);
  } catch (e: any) {
    t('повідомлення згадує FAILED', /FAILED/.test(e.message), e.message);
    t('лише 2 виклики fetch (submit + одне опитування)', call === 2, String(call));
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nLeonardo відео — COMPLETE без відомого поля з посиланням кидає чітку помилку (а не падає мовчки):');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async () => {
    call++;
    if (call === 1) return { ok: true, status: 200, json: async () => ({ sdGenerationJob: { generationId: 'vid-weird' } }) };
    return { ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'COMPLETE' } }) };
  };
  try {
    await generateVideo({ prompt: 'x', engine: 'leonardo-motion2' });
    t('мало кинути помилку через невідому форму відповіді', false);
  } catch (e: any) {
    t('це VideoGenerationError', e instanceof VideoGenerationError);
    t('kind === unknown', e.kind === 'unknown', e.kind);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

// ---------------------------------------------------------------------------
// Задача #202 — чотири нові v2-двигуни (Seedance 2.5, Wan 3.0, Kling O3, FLUX 3 Video)
// ---------------------------------------------------------------------------

console.log('\nLeonardo відео — Seedance 2.5 (v2): submit на /v2/generations, тіло {model, public, parameters}:');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  const seenUrls: string[] = [];
  const seenBodies: any[] = [];
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url: string, opts?: any) => {
    call++;
    seenUrls.push(String(url));
    if (call === 1) {
      seenBodies.push(JSON.parse(opts.body));
      // v2 — форма підтвердження створення завдання не задокументована; пробуємо звичайний REST-стиль { id }.
      return { ok: true, status: 200, json: async () => ({ id: 'seedance-job-1' }) };
    }
    if (call === 2) {
      return { ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'PENDING' } }) };
    }
    if (call === 3) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_videos: [{ url: 'https://example.com/seedance.mp4' }] } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'video/mp4' : null) },
      arrayBuffer: async () => MP4_BYTES.buffer,
    };
  };
  try {
    const result = await generateVideo({ prompt: 'коала грається з котом на галявині', engine: 'leonardo-seedance-2-5' });
    t('відправлення пішло на /v2/generations, НЕ на v1 /generations-text-to-video', seenUrls[0].includes('/v2/generations') && !seenUrls[0].includes('-text-to-video'), seenUrls[0]);
    t('тіло: model=bytedance/seedance-2.5', seenBodies[0]?.model === 'bytedance/seedance-2.5', JSON.stringify(seenBodies[0]));
    t('тіло: public=false (не model.public)', seenBodies[0]?.public === false);
    t('тіло: parameters.duration=8 (дефолт)', seenBodies[0]?.parameters?.duration === 8, JSON.stringify(seenBodies[0]));
    t('тіло: parameters.width/height=1280×720 (дефолт документації)', seenBodies[0]?.parameters?.width === 1280 && seenBodies[0]?.parameters?.height === 720);
    t('тіло: НЕМАЄ окремого поля roздільності (Seedance його не документує)', !('resolution' in (seenBodies[0]?.parameters || {})) && !('mode' in (seenBodies[0]?.parameters || {})));
    t('тіло: parameters.quantity=1', seenBodies[0]?.parameters?.quantity === 1);
    t('тіло: parameters.motion_has_audio=true', seenBodies[0]?.parameters?.motion_has_audio === true);
    t('result.modelId === modelSlug', result.modelId === 'bytedance/seedance-2.5', result.modelId);
    t('рівно 4 виклики (submit + 2 опитування + завантаження)', call === 4, String(call));
  } catch (e: any) {
    t('Seedance 2.5-цикл не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nLeonardo відео — Wan 3.0 (v2): "resolution":"1080p", тривалість затиснена до діапазону 2–30с:');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  const seenBodies: any[] = [];
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url: string, opts?: any) => {
    call++;
    if (call === 1) {
      seenBodies.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ id: 'wan-job-1' }) };
    }
    if (call === 2) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_videos: [{ url: 'https://example.com/wan.mp4' }] } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'video/mp4' : null) },
      arrayBuffer: async () => MP4_BYTES.buffer,
    };
  };
  try {
    // 45с — поза документованим діапазоном 2–30с → має впасти на дефолт (5с).
    const result = await generateVideo({ prompt: 'коала в евкаліптовому гаю', engine: 'leonardo-wan-3', resolution: '1080', durationSec: 45 });
    t('тіло: model=alibaba/wan-3.0', seenBodies[0]?.model === 'alibaba/wan-3.0');
    t('тіло: parameters.resolution="1080p" (не "RESOLUTION_1080")', seenBodies[0]?.parameters?.resolution === '1080p', seenBodies[0]?.parameters?.resolution);
    t('тіло: parameters.width/height=1920×1080', seenBodies[0]?.parameters?.width === 1920 && seenBodies[0]?.parameters?.height === 1080);
    t('невалідна тривалість (45, поза 2–30) впала на дефолт (5)', seenBodies[0]?.parameters?.duration === 5, String(seenBodies[0]?.parameters?.duration));
    t('result.durationSec === 5', result.durationSec === 5, String(result.durationSec));
  } catch (e: any) {
    t('Wan 3.0-цикл не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nLeonardo відео — Kling O3 (v2): "mode":"RESOLUTION_720" (не "resolution"), тривалість у межах 3–15с приймається як є:');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  const seenBodies: any[] = [];
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url: string, opts?: any) => {
    call++;
    if (call === 1) {
      seenBodies.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ id: 'kling-o3-job-1' }) };
    }
    if (call === 2) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_videos: [{ url: 'https://example.com/kling-o3.mp4' }] } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'video/mp4' : null) },
      arrayBuffer: async () => MP4_BYTES.buffer,
    };
  };
  try {
    const result = await generateVideo({ prompt: 'жінка грається з котом', engine: 'leonardo-kling-o3', durationSec: 3 });
    t('тіло: model=kling-video-o-3', seenBodies[0]?.model === 'kling-video-o-3');
    t('тіло: parameters.mode="RESOLUTION_720" (дефолтна роздільність)', seenBodies[0]?.parameters?.mode === 'RESOLUTION_720', seenBodies[0]?.parameters?.mode);
    t('тіло: НЕМАЄ поля "resolution" (Kling O3 зве його "mode")', !('resolution' in (seenBodies[0]?.parameters || {})));
    t('валідна тривалість (3, у межах 3–15) прийнята як є', seenBodies[0]?.parameters?.duration === 3);
    t('тіло: НЕМАЄ quantity (Kling O3 його не приймає)', !('quantity' in (seenBodies[0]?.parameters || {})));
    t('result.durationSec === 3', result.durationSec === 3);
  } catch (e: any) {
    t('Kling O3-цикл не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nLeonardo відео — FLUX 3 Video (v2): опитування БЕЗ обгортки generations_by_pk (запасний шлях розбору відповіді):');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  const seenBodies: any[] = [];
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url: string, opts?: any) => {
    call++;
    if (call === 1) {
      seenBodies.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ generationId: 'flux3-job-1' }) };
    }
    if (call === 2) {
      // Навмисно БЕЗ generations_by_pk — перевіряє запасний шлях extractGenerationStatus() на плаский обʼєкт.
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETE', generated_videos: [{ url: 'https://example.com/flux3.mp4' }] }) };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'video/mp4' : null) },
      arrayBuffer: async () => MP4_BYTES.buffer,
    };
  };
  try {
    const result = await generateVideo({ prompt: 'коала пливе на дошці за течією на заході сонця', engine: 'leonardo-flux-3-video', resolution: '1080', durationSec: 12 });
    t('тіло: model=bfl/flux-3-video', seenBodies[0]?.model === 'bfl/flux-3-video');
    t('тіло: parameters.resolution="1080p"', seenBodies[0]?.parameters?.resolution === '1080p');
    t('тіло: parameters.duration=12 (у межах 5–20)', seenBodies[0]?.parameters?.duration === 12);
    t('розпізнав статус і відео без обгортки generations_by_pk', result.buffer.length > 0);
    t('рівно 3 виклики (submit + 1 опитування (одразу COMPLETE) + завантаження)', call === 3, String(call));
  } catch (e: any) {
    t('FLUX 3 Video-цикл (без обгортки) не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nЗадача #206 — референс ПЕРШОГО кадру (v1, Veo3): submit іде на /generations-image-to-video (НЕ /generations-text-to-video), з imageId/imageType:"UPLOADED":');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  const seenUrls: string[] = [];
  const seenBodies: any[] = [];
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url: string, opts?: any) => {
    call++;
    seenUrls.push(String(url));
    if (call === 1) {
      // джерело референсу першого кадру
      return { ok: true, status: 200, headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => new ArrayBuffer(8) };
    }
    if (call === 2) {
      return { ok: true, status: 200, json: async () => ({ uploadInitImage: { id: 'frame-id-1', url: 'https://s3.example.com/upload', fields: JSON.stringify({ key: 'k1' }) } }) };
    }
    if (call === 3) {
      return { ok: true, status: 204 }; // S3 upload
    }
    if (call === 4) {
      seenBodies.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ sdGenerationJob: { generationId: 'i2v-job-1' } }) };
    }
    if (call === 5) {
      return { ok: true, status: 200, json: async () => ({ generations_by_pk: { status: 'COMPLETE', generated_videos: [{ url: 'https://example.com/i2v.mp4' }] } }) };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'video/mp4' : null) },
      arrayBuffer: async () => MP4_BYTES.buffer,
    };
  };
  try {
    const result = await generateVideo({ prompt: 'жінка йде пляжем', engine: 'leonardo-veo3', startFrameImageUrl: 'https://app.example.com/generated/frame.png' });
    t('повернув буфер', result.buffer.length > 0);
    t('submit пішов на /generations-image-to-video', seenUrls[3].endsWith('/generations-image-to-video'), seenUrls[3]);
    t('НЕ на /generations-text-to-video', !seenUrls[3].endsWith('/generations-text-to-video'), seenUrls[3]);
    t('тіло: imageId = id завантаженого кадру', seenBodies[0]?.imageId === 'frame-id-1', JSON.stringify(seenBodies[0]));
    t('тіло: imageType = "UPLOADED"', seenBodies[0]?.imageType === 'UPLOADED');
  } catch (e: any) {
    t('цикл із першим кадром (v1) не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nЗадача #206 — референс ПЕРШОГО і ОСТАННЬОГО кадру (v2, Seedance 2.5): guidances.start_frame + guidances.end_frame, обидва type:"UPLOADED":');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  const seenBodies: any[] = [];
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url: string, opts?: any) => {
    call++;
    // 1-3: завантаження першого кадру (джерело → init-image → S3)
    // 4-6: завантаження останнього кадру (джерело → init-image → S3)
    // 7: submit, 8: опитування, 9: завантаження результату
    if (call === 1 || call === 4) {
      return { ok: true, status: 200, headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => new ArrayBuffer(8) };
    }
    if (call === 2) {
      return { ok: true, status: 200, json: async () => ({ uploadInitImage: { id: 'start-id', url: 'https://s3.example.com/upload', fields: JSON.stringify({ key: 'k1' }) } }) };
    }
    if (call === 5) {
      return { ok: true, status: 200, json: async () => ({ uploadInitImage: { id: 'end-id', url: 'https://s3.example.com/upload', fields: JSON.stringify({ key: 'k2' }) } }) };
    }
    if (call === 3 || call === 6) {
      return { ok: true, status: 204 }; // S3 upload
    }
    if (call === 7) {
      seenBodies.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ id: 'i2v-v2-job' }) };
    }
    if (call === 8) {
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETE', generated_videos: [{ url: 'https://example.com/seedance-i2v.mp4' }] } ) };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'video/mp4' : null) },
      arrayBuffer: async () => MP4_BYTES.buffer,
    };
  };
  try {
    const result = await generateVideo({
      prompt: 'квітка розпускається',
      engine: 'leonardo-seedance-2-5',
      startFrameImageUrl: 'https://app.example.com/generated/start.png',
      endFrameImageUrl: 'https://app.example.com/generated/end.png',
    });
    t('повернув буфер', result.buffer.length > 0);
    const guidances = seenBodies[0]?.parameters?.guidances;
    t('guidances.start_frame — 1 елемент, id першого кадру', guidances?.start_frame?.[0]?.image?.id === 'start-id', JSON.stringify(guidances));
    t('guidances.start_frame — type UPLOADED', guidances?.start_frame?.[0]?.image?.type === 'UPLOADED');
    t('guidances.end_frame — 1 елемент, id останнього кадру', guidances?.end_frame?.[0]?.image?.id === 'end-id');
    t('guidances.end_frame — type UPLOADED', guidances?.end_frame?.[0]?.image?.type === 'UPLOADED');
  } catch (e: any) {
    t('цикл із двома кадрами (v2) не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nЗадача #206 — референс останнього кадру БЕЗ першого кидає зрозумілу помилку, без жодного мережевого виклику:');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  global.fetch = async () => { call++; throw new Error('не мав викликати fetch'); };
  try {
    await generateVideo({ prompt: 'x', engine: 'leonardo-seedance-2-5', endFrameImageUrl: 'https://app.example.com/generated/end.png' });
    t('мав кинути помилку', false);
  } catch (e: any) {
    t('повідомлення пояснює причину', /останнього кадру.*першого кадру/.test(e.message), e.message);
    t('жодного мережевого виклику', call === 0, String(call));
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nЗадача #206 — референс останнього кадру на v1-двигуні (Motion 2.0) не підтримується, без жодного мережевого виклику:');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  global.fetch = async () => { call++; throw new Error('не мав викликати fetch'); };
  try {
    await generateVideo({
      prompt: 'x',
      engine: 'leonardo-motion2',
      startFrameImageUrl: 'https://app.example.com/generated/start.png',
      endFrameImageUrl: 'https://app.example.com/generated/end.png',
    });
    t('мав кинути помилку', false);
  } catch (e: any) {
    t('повідомлення називає v2-альтернативи', /Seedance 2\.5.*Wan 3\.0.*Kling O3.*FLUX 3 Video/.test(e.message), e.message);
    t('жодного мережевого виклику', call === 0, String(call));
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nЗадача #206 — listVideoEngines(): supportsStartFrame=true для всіх, supportsEndFrame лише для v2:');
{
  const list = listVideoEngines({ leonardo: true });
  t('усі 10 мають supportsStartFrame=true', list.every((e) => e.supportsStartFrame === true));
  const v1Ids = ['leonardo-motion2', 'leonardo-motion2-fast', 'leonardo-veo3', 'leonardo-veo3-fast', 'leonardo-kling2-1', 'leonardo-kling2-5'];
  const v2Ids = ['leonardo-seedance-2-5', 'leonardo-wan-3', 'leonardo-kling-o3', 'leonardo-flux-3-video'];
  t('v1-двигуни: supportsEndFrame=false', v1Ids.every((id) => list.find((e) => e.id === id)?.supportsEndFrame === false));
  t('v2-двигуни: supportsEndFrame=true', v2Ids.every((id) => list.find((e) => e.id === id)?.supportsEndFrame === true));
}

console.log('\nЗадача #207 — превентивно: якщо відео-submit поверне ту саму {generate:{generationId}} форму, що й реальна фото-відповідь (той самий /v2/generations шлюз), генерація не впаде:');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url: string) => {
    call++;
    if (call === 1) {
      return { ok: true, status: 200, json: async () => ({ generate: { generationId: 'v2-real-shape-id' } }) };
    }
    if (call === 2) {
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETE', generated_videos: [{ url: 'https://example.com/generate-wrapper.mp4' }] }) };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'video/mp4' : null) },
      arrayBuffer: async () => MP4_BYTES.buffer,
    };
  };
  try {
    const result = await generateVideo({ prompt: 'x', engine: 'leonardo-seedance-2-5' });
    t('повернув буфер (розпізнав generate.generationId)', result.buffer.length > 0);
  } catch (e: any) {
    t('НЕ мав кинути помилку на {generate:{generationId}}', false, e.message);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
