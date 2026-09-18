import {
  resolveVideoEngine,
  generateVideo,
  VIDEO_ENGINES,
  listVideoEngines,
  VideoGenerationError,
  humanVideoMessage,
} from '../server/videoGeneration';
import { leonardoConfig } from '../server/imageGeneration';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const MP4_BYTES = Buffer.from('00000018667479706d703432', 'hex'); // фейкові байти — тесту байдужий реальний контейнер, лише довжина > 0.

console.log('resolveVideoEngine:');
t('leonardo-motion2 резолвиться', resolveVideoEngine('leonardo-motion2').id === 'leonardo-motion2');
t('leonardo-veo3 резолвиться', resolveVideoEngine('leonardo-veo3').id === 'leonardo-veo3');
t('leonardo-veo3-fast резолвиться', resolveVideoEngine('leonardo-veo3-fast').id === 'leonardo-veo3-fast');
t('leonardo-kling2-1 резолвиться', resolveVideoEngine('leonardo-kling2-1').id === 'leonardo-kling2-1');
t('leonardo-kling2-5 резолвиться', resolveVideoEngine('leonardo-kling2-5').id === 'leonardo-kling2-5');
t('невідомий рядок → двигун за замовчуванням', resolveVideoEngine('щось-невідоме').id === 'leonardo-motion2');
t('без аргументу → двигун за замовчуванням', resolveVideoEngine(undefined).id === 'leonardo-motion2');

console.log('\nVIDEO_ENGINES — точні рядки моделі Leonardo (звірено з docs.leonardo.ai, вересень 2026):');
t('MOTION2', VIDEO_ENGINES['leonardo-motion2'].leonardoModel === 'MOTION2');
t('MOTION2FAST', VIDEO_ENGINES['leonardo-motion2-fast'].leonardoModel === 'MOTION2FAST');
t('VEO3', VIDEO_ENGINES['leonardo-veo3'].leonardoModel === 'VEO3');
t('VEO3FAST', VIDEO_ENGINES['leonardo-veo3-fast'].leonardoModel === 'VEO3FAST');
t('KLING2_1', VIDEO_ENGINES['leonardo-kling2-1'].leonardoModel === 'KLING2_1');
t('KLING2_5', VIDEO_ENGINES['leonardo-kling2-5'].leonardoModel === 'KLING2_5');

t('Motion 2.0 не пропонує тривалість (недокументовано)', VIDEO_ENGINES['leonardo-motion2'].durationsSec === null);
t('Veo3 — 4/6/8с', JSON.stringify(VIDEO_ENGINES['leonardo-veo3'].durationsSec) === '[4,6,8]');
t('Kling 2.5 — 5/10с', JSON.stringify(VIDEO_ENGINES['leonardo-kling2-5'].durationsSec) === '[5,10]');
t('Kling 2.5 єдина з 1:1 (1440×1440 підтверджено документацією)', VIDEO_ENGINES['leonardo-kling2-5'].aspectRatios.includes('1:1'));
t('Veo3 без 1:1 (не підтверджено)', !VIDEO_ENGINES['leonardo-veo3'].aspectRatios.includes('1:1'));

console.log('\nlistVideoEngines:');
{
  const list = listVideoEngines({ leonardo: true });
  t('рівно 6 двигунів', list.length === 6, String(list.length));
  t('усі доступні, коли ключ є', list.every((e) => e.available === true));
  const listNoKey = listVideoEngines({ leonardo: false });
  t('жоден недоступний без ключа', listNoKey.every((e) => e.available === false));
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

console.log('\nLeonardo відео — повний цикл (Motion 2.0: submit → poll PENDING → poll COMPLETE → завантаження):');
{
  const realFetch = global.fetch;
  const prevKey = leonardoConfig.apiKey;
  leonardoConfig.apiKey = 'test-leonardo-key';
  let call = 0;
  const seenBodies: any[] = [];
  // @ts-expect-error підміна глобального fetch лише на час цього блоку тесту
  global.fetch = async (url: string, opts?: any) => {
    call++;
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
  } catch (e: any) {
    t('успішний цикл не мав кинути помилку', false, e.message);
  } finally {
    global.fetch = realFetch;
    leonardoConfig.apiKey = prevKey;
  }
}

console.log('\nLeonardo відео — Veo3 надсилає duration і правильні пікселі 1080p:');
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

console.log('\nLeonardo відео — невалідна тривалість/роздільність мовчки замінюється на дефолт двигуна:');
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

console.log('\nLeonardo відео — статус FAILED зупиняє опитування одразу:');
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

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
