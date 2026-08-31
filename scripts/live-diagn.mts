/**
 * Живий прогін модуля /diagn проти справжньої моделі.
 * Запуск: npm run live:diagn   (потрібен ANTHROPIC_API_KEY в оточенні)
 *
 * Це не юніт-тест: він витрачає гроші й ходить у мережу, тому не входить
 * до `npm test`. Він відповідає на питання, якого юніт-тести не ставлять,
 * — чи модель узагалі виконує контракт, який ми їй написали. Схема, що
 * проходить усі перевірки на підставних даних, і схема, за якою реальна
 * модель повертає розбірний JSON, — різні речі.
 */
import {
  DIAGN_MODULES,
  COMPETENCY_AXES,
  diagnSystemInstruction,
  factoryDiagnTemplate,
  renderDiagnTemplate,
  parseDiagnResponse,
  normalizeDiagnResult,
  type DiagnModule,
} from '../server/diagnPrompt.ts';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error('Немає ANTHROPIC_API_KEY — живий прогін пропущено.');
  process.exit(2);
}

const MODEL = process.env.LIVE_MODEL || 'claude-sonnet-4-5-20250929';

const FRAGMENT = `Ліда прокинулась від того, що будинок мовчав.
Не тиша — саме мовчання, важке й свідоме, ніби стіни щось вирішили без неї.
Вона спустилась. На кухні пахло вчорашнім хлібом і чимось іще, чого вона не могла назвати.
— Ти теж це чуєш? — спитала мати, не обертаючись.
— Що саме?
— Що воно припинилось.
Ліда підійшла до вікна. За склом стояв туман, і в тумані не було ані ліхтарів, ані звуку — тільки біле, рівне, до самого краю подвір'я.
Вона згадала, як батько казав: коли не чуєш річки, значить, річка вже в домі.
Тоді це здавалось приказкою. Тепер — інструкцією, яку вона запізно почала розуміти.
Мати нарешті обернулась. У руках вона тримала ключ, якого Ліда не бачила ніколи.
— Тобі доведеться піти першою, — сказала мати. — Я вже пробувала.`;

async function ask(system: string, user: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body: any = await res.json();
  return body?.content?.[0]?.text ?? '';
}

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log(`\nЖивий прогін /diagn на ${MODEL}\n`);

for (const module of DIAGN_MODULES as readonly DiagnModule[]) {
  console.log(`\n── ${module} ──`);
  const system = renderDiagnTemplate(diagnSystemInstruction(module), {
    fragment: '',
    locale: 'українська',
    competencies: COMPETENCY_AXES.join(', '),
  });
  const user = renderDiagnTemplate(factoryDiagnTemplate(module), {
    bookTitle: 'Коли не чуєш річки',
    genre: 'магічний реалізм',
    fragment: FRAGMENT,
    competencies: COMPETENCY_AXES.map((a, i) => `${i + 1}. ${a}`).join('\n'),
    locale: 'українська',
  });

  try {
    const raw = await ask(system, user);
    let parsed: any;
    try {
      parsed = parseDiagnResponse(raw);
      t(`${module}: відповідь розібрано як JSON`, true);
    } catch {
      t(`${module}: відповідь розібрано як JSON`, false, raw.slice(0, 200));
      continue;
    }

    const norm: any = normalizeDiagnResult(module, parsed);
    t(`${module}: summary непорожній`, typeof norm.summary === 'string' && norm.summary.length > 10);

    if (module === 'style') {
      const scores = Object.values(norm.metrics).map((m: any) => m.score);
      t('усі три метрики в межах 0-100', scores.length === 3 && scores.every((s: any) => s >= 0 && s <= 100));
      t('модель дала власні числа, а не запасні 50', scores.some((s: any) => s !== 50), `scores=${scores.join(',')}`);
      t('є щонайменше одна цитата', norm.highlights.length > 0);
      const inText = norm.highlights.every((h: any) =>
        FRAGMENT.replace(/\s+/g, ' ').includes(h.excerpt.replace(/\s+/g, ' ').slice(0, 25))
      );
      t('цитати взято з тексту, а не вигадано', inText,
        inText ? '' : norm.highlights.map((h: any) => h.excerpt.slice(0, 40)).join(' | '));
      t('є рекомендації', norm.recommendations.length > 0);
      console.log(`    ${norm.summary}`);
    }

    if (module === 'structure') {
      t('архетип визначено', norm.detected_archetype !== 'не визначено');
      t('позицію на дузі визначено', norm.arc_position !== 'не визначено');
      t('severity лише з дозволених', norm.deviations.every((d: any) => ['low', 'medium', 'high'].includes(d.severity)));
      console.log(`    ${norm.detected_archetype} · ${norm.arc_position}`);
    }

    if (module === 'competency') {
      t('радар має всі осі платформи', norm.radar.length === COMPETENCY_AXES.length);
      t('модель оцінила більшість осей', norm.radar.filter((r: any) => r.score !== 50).length >= 5,
        `оцінено ${norm.radar.filter((r: any) => r.score !== 50).length} із ${COMPETENCY_AXES.length}`);
      t('оцінки в межах 0-100', norm.radar.every((r: any) => r.score >= 0 && r.score <= 100));
      console.log(`    ${norm.radar.map((r: any) => `${r.skill}:${r.score}`).join(' · ')}`);
    }
  } catch (e) {
    t(`${module}: виклик моделі`, false, String((e as Error).message));
  }
}

console.log(`\nПідсумок живого прогону: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
