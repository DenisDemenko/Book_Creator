/**
 * Сторінка 4 — «Емоційний монітор» (Т2.2, ТЗ-11).
 *
 * Емоційна динаміка одного чи кількох героїв за главами, сценами або часом
 * світу (Т2.1): кожна родина емоцій — своя лінія зі своїм кольором, формою
 * маркера й підписом у кінці; герої різняться штрихом. Три окремі показники —
 * сила емоції героя, майстерність її передачі в тексті, вплив на сюжет.
 * Основні, другорядні й приховані емоції. Мітки подій, рішень, конфліктів і
 * порогів на шкалі; «до / після» вибраної події.
 *
 * Критерій сторінки 4: будь-яку оцінку можна відкрити й перевірити за її
 * вихідними абзацами — натиснули маркер кривої, рядок «до / після», настрій
 * сцени чи попередження → «Докази»: точки з уривками й переходом до тексту.
 * Де висновку нема на чому триматися — «недостатньо даних».
 *
 * Ручне коригування: будь-яку точку (зокрема з тега — текст не змінюється)
 * автор уточнює в її панелі; може й сам поставити точку на абзаці героя.
 * Пропозиції AI-2 — на розгляд: підтвердити (з уточненою силою) чи відхилити.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, HeartPulse, ListChecks, Loader2, Sparkles, Table2, Trash2, X } from 'lucide-react';
import type { Book } from '../types';
import { EMOTION_AXES, EMOTION_FAMILIES, EMOTION_LAYERS, EMOTION_METRICS, familyInfo, layerLabel, type EmotionAxis, type EmotionMetric } from '../utils/emotionScale';

interface Place {
  paragraphId: string;
  editorPid: string;
  sectionId: string;
  sectionTitle: string;
  chapterId: string | null;
  chapterNumber: number | null;
  excerpt: string;
  x: number | null;
  bucket: number | null;
}
interface Point {
  id: string;
  source: 'tag' | 'author' | 'ai';
  characterId: string | null;
  characterName: string;
  emotion: string;
  family: string;
  layer: string;
  intensity: number;
  estimated: boolean;
  craft: number | null;
  impact: number | null;
  note: string;
  corrected: boolean;
  tagIntensity: number | null;
  place: Place;
}
interface Series {
  characterId: string;
  characterName: string;
  family: string;
  values: (number | null)[];
  counts: number[];
  pointIds: string[][];
}
interface Scene {
  sectionId: string;
  title: string;
  chapterNumber: number | null;
  points: number;
  dominant: string;
  avgIntensity: number;
  valence: number;
  editorPid: string;
  chapterId: string | null;
  pointIds: string[];
}
interface Warning {
  kind: 'jump' | 'flat' | 'no_subject' | 'insufficient';
  message: string;
  characterId: string | null;
  editorPid: string | null;
  sectionId: string | null;
  chapterId: string | null;
  pointIds: string[];
}
interface Suggestion {
  id: string;
  characterName: string;
  emotion: string;
  family: string;
  layer: string;
  intensity: number;
  craft: number | null;
  impact: number | null;
  statement: string;
  quote: string;
  needsReview: boolean;
  insufficient: boolean;
  place: Place | null;
}
interface ImpactRow {
  characterId: string;
  characterName: string;
  family: string;
  before: { avg: number; count: number } | null;
  after: { avg: number; count: number } | null;
  delta: number | null;
  pointIds: string[];
}
interface Monitor {
  synced: boolean;
  canEdit?: boolean;
  axis: EmotionAxis;
  metric: EmotionMetric;
  buckets: { key: string; label: string; title: string }[];
  untimed: number;
  families: { key: string; label: string; color: string; points: number }[];
  characters: { id: string; name: string; points: number }[];
  selected: string[];
  points: Point[];
  series: Series[];
  unscored: number;
  scenes: Scene[];
  warnings: Warning[];
  suggestions: Suggestion[];
  events: { id: string; name: string; type: string; chapterNumber: number | null; x: number | null }[];
  impact: { event: { id: string; name: string; place: Place }; window: number; rows: ImpactRow[] } | null;
  anchors: (Place & { characterId: string })[];
  totals: { tag: number; author: number; ai: number; corrected: number; estimated: number; withoutSubject: number };
}

interface Props {
  book: Book;
  onOpenParagraph: (t: { chapterId: string; sectionId: string; editorPid: string; text: string }) => void;
}

const api = (url: string, init?: RequestInit) =>
  fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });

const SOURCE_UK: Record<Point['source'], string> = { tag: 'тег у тексті', author: 'точка автора', ai: 'AI, підтверджено автором' };
const DASHES = ['', '6 4', '2 3', '10 3 2 3'];
const familyIndex = (key: string) => Math.max(0, EMOTION_FAMILIES.findIndex((f) => f.key === key));
const metricLabel = (m: EmotionMetric) => EMOTION_METRICS.find((x) => x.key === m)!.label;
const metricValue = (p: Point, m: EmotionMetric) => (m === 'intensity' ? p.intensity : m === 'craft' ? p.craft : p.impact);
const score = (v: number | null) => (v == null ? 'не оцінено' : String(v));

/** Форма маркера родини — друга ознака, крім кольору. */
function Marker({ family, x, y, r = 4.5 }: { family: string; x: number; y: number; r?: number }) {
  const c = familyInfo(family).color;
  const common = { fill: c, stroke: '#0f172a', strokeWidth: 2 };
  switch (familyIndex(family) % 4) {
    case 1:
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1} {...common} />;
    case 2:
      return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`} {...common} />;
    case 3:
      return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} {...common} />;
    default:
      return <circle cx={x} cy={y} r={r} {...common} />;
  }
}

type Evidence = { title: string; pointIds: string[] };
type Correction = { intensity: number; layer: string; craft: string; impact: string; note: string };
const scoreOptions = ['', ...Array.from({ length: 11 }, (_, i) => String(i))];

export const EmotionMonitorPage: React.FC<Props> = ({ book, onOpenParagraph }) => {
  const base = `/api/projects/${encodeURIComponent(book.id)}`;
  // null — ще не вибрано (уперше — герой з найбільшою кількістю точок); [] — усі.
  const [heroes, setHeroes] = useState<string[] | null>(null);
  const [family, setFamily] = useState('');
  const [layer, setLayer] = useState('');
  const [axis, setAxis] = useState<EmotionAxis>('chapter');
  const [metric, setMetric] = useState<EmotionMetric>('intensity');
  const [event, setEvent] = useState('');
  const [windowSize, setWindowSize] = useState(2);
  const [data, setData] = useState<Monitor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [strength, setStrength] = useState<Record<string, number>>({});
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [form, setForm] = useState({ characterId: '', paragraphId: '', emotion: '', intensity: 5, layer: 'primary', craft: '', impact: '', note: '' });
  const [askDelete, setAskDelete] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Номер запиту: відповідь старішого запиту (інший герой, фільтр) не затирає новішу.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    const qs = new URLSearchParams();
    if (heroes?.length) qs.set('characters', heroes.join(','));
    if (family) qs.set('family', family);
    if (layer) qs.set('layer', layer);
    if (axis !== 'chapter') qs.set('axis', axis);
    if (metric !== 'intensity') qs.set('metric', metric);
    if (event) {
      qs.set('event', event);
      qs.set('window', String(windowSize));
    }
    const res = await api(`${base}/emotions?${qs.toString()}`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (my !== seq.current) return;
    if (!res || !res.ok) setError(res?.status === 403 ? 'Немає доступу до цієї книги.' : res?.status === 503 ? 'Семантичне ядро зараз недоступне.' : body.error || 'Не вдалося завантажити монітор.');
    else {
      setError(null);
      setData(body as Monitor);
      if (heroes === null && body.characters?.length) setHeroes([body.characters[0].id]);
    }
    setLoading(false);
  }, [base, heroes, family, layer, axis, metric, event, windowSize]);

  useEffect(() => {
    void load();
  }, [load]);
  // Після дії — перезавантаження з ТЕПЕРІШНІМИ фільтрами, навіть якщо автор їх змінив, поки йшов запит.
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = () => loadRef.current();
  useEffect(() => () => {
    if (poll.current) clearTimeout(poll.current);
  }, []);

  const pointById = useMemo(() => new Map((data?.points ?? []).map((p) => [p.id, p])), [data]);
  const sel = selected ? pointById.get(selected) ?? null : null;
  useEffect(() => {
    setCorrection(sel ? { intensity: sel.intensity, layer: sel.layer, craft: sel.craft == null ? '' : String(sel.craft), impact: sel.impact == null ? '' : String(sel.impact), note: sel.source === 'tag' ? '' : sel.note } : null);
    setAskDelete(null);
  }, [sel?.id, sel?.intensity, sel?.craft, sel?.impact, sel?.layer]);
  useEffect(() => {
    const hs = heroes ?? [];
    if (hs.length && !hs.includes(form.characterId)) setForm((f) => ({ ...f, characterId: hs[0], paragraphId: '' }));
  }, [heroes]);

  const open = (p: { chapterId: string | null; sectionId: string; editorPid: string; excerpt?: string } | null) => {
    if (p && p.chapterId) onOpenParagraph({ chapterId: p.chapterId, sectionId: p.sectionId, editorPid: p.editorPid, text: p.excerpt ?? '' });
  };
  const showEvidence = (title: string, pointIds: string[]) => {
    setEvidence({ title, pointIds });
    setSelected(null);
  };
  const toggleHero = (id: string) => {
    setSelected(null);
    setEvidence(null);
    setHeroes((hs) => {
      const cur = hs ?? [];
      return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    });
  };

  const analyze = async () => {
    const hero = heroes?.[0];
    if (!hero) return;
    setAnalyzing(true);
    setMessage(null);
    const res = await api(`${base}/emotions/analyze`, { method: 'POST', body: JSON.stringify({ characterId: hero }) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setAnalyzing(false);
      setMessage(body.error || 'Не вдалося запустити аналіз емоцій.');
      return;
    }
    const tick = async () => {
      const r = await api(`${base}/jobs/${body.jobId}`).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      if (j && (j.status === 'queued' || j.status === 'running')) {
        poll.current = setTimeout(tick, 1500);
        return;
      }
      setAnalyzing(false);
      if (j?.status === 'succeeded') setMessage(j.result?.points ? `Нових пропозицій: ${j.result.points} — розгляньте їх нижче.` : 'Нових емоцій не знайдено — усе, що є, уже на кривій.');
      else setMessage(j?.error || 'Аналіз емоцій не вдався.');
      await reload();
    };
    poll.current = setTimeout(tick, 1200);
  };

  const decide = async (s: Suggestion, status: 'confirmed' | 'rejected') => {
    setBusy(s.id);
    const body: Record<string, unknown> = { status };
    if (status === 'confirmed') body.intensity = strength[s.id] ?? s.intensity;
    const res = await api(`${base}/emotions/suggestions/${s.id}/status`, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
    if (!res?.ok) setMessage(((await res?.json().catch(() => ({}))) as any)?.error || 'Не вдалося.');
    else setMessage(status === 'confirmed' ? `«${s.emotion}» — на кривій.` : `«${s.emotion}» відхилено.`);
    setBusy(null);
    await reload();
  };

  const savePoint = async (body: Record<string, unknown>, done: string) => {
    setBusy('save');
    const res = await api(`${base}/emotions/points`, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) {
      setMessage(out.error || 'Не вдалося зберегти точку.');
      return null;
    }
    setMessage(done);
    await reload();
    return out.point as { id: string };
  };

  const addPoint = async () => {
    if (!form.characterId || !form.paragraphId || !form.emotion.trim()) {
      setMessage('Оберіть героя, абзац і назвіть емоцію.');
      return;
    }
    const p = await savePoint(form, `Точку «${form.emotion.trim().toLocaleLowerCase('uk')}» (${form.intensity}) додано.`);
    if (p) setForm((f) => ({ ...f, emotion: '', note: '', craft: '', impact: '' }));
  };

  const saveCorrection = async () => {
    if (!sel || !correction || !sel.characterId) return;
    const p = await savePoint(
      { characterId: sel.characterId, paragraphId: sel.place.paragraphId, emotion: sel.emotion, ...correction },
      sel.source === 'tag' ? 'Точку скориговано — текст книги не змінено.' : 'Точку оновлено.',
    );
    if (p) setSelected(p.id);
  };

  const removePoint = async (id: string) => {
    setBusy(id);
    const res = await api(`${base}/emotions/points/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    setAskDelete(null);
    if (!res?.ok) setMessage('Не вдалося видалити точку.');
    else {
      setSelected(null);
      setMessage('Точку прибрано з кривої.');
    }
    await reload();
  };

  // ── Геометрія графіка ──
  const [boxW, setBoxW] = useState(720);
  // Ref-функція: спостерігач ставиться щоразу, коли блок графіка з'являється (після таблиці, зміни героя…).
  const ro = useRef<ResizeObserver | null>(null);
  const boxRef = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    setBoxW(Math.max(280, el.clientWidth));
    if (typeof ResizeObserver === 'undefined') return;
    ro.current = new ResizeObserver(([e]) => setBoxW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.current.observe(el);
  }, []);
  const nb = Math.max(1, data?.buckets.length ?? 1);
  const PAD = { l: 30, r: 118, t: 16, b: 34 };
  const W = Math.max(boxW, PAD.l + PAD.r + nb * 56, 520);
  const H = 260;
  const px = (x: number) => PAD.l + (x / nb) * (W - PAD.l - PAD.r);
  const py = (v: number) => PAD.t + (1 - v / 10) * (H - PAD.t - PAD.b);
  const charOrder = useMemo(() => [...new Set((data?.series ?? []).map((s) => s.characterId))], [data]);
  const multiHero = charOrder.length > 1;
  const labelEvery = Math.max(1, Math.ceil(nb / Math.max(1, Math.floor((W - PAD.l - PAD.r) / 56))));

  const labels = useMemo(() => {
    if (!data) return [];
    const raw = data.series
      .map((s) => {
        let last = -1;
        s.values.forEach((v, i) => {
          if (v != null) last = i;
        });
        if (last < 0) return null;
        return { key: `${s.characterId}:${s.family}`, text: `${multiHero ? `${s.characterName} · ` : ''}${familyInfo(s.family).label.toLocaleLowerCase('uk')}`, y: py(s.values[last]!) };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.y - b.y);
    // Підписи не налазять один на одного: мінімум 12 px по вертикалі.
    for (let i = 1; i < raw.length; i++) if (raw[i].y - raw[i - 1].y < 12) raw[i].y = raw[i - 1].y + 12;
    return raw;
  }, [data, multiHero, W]);

  const selectCls = 'min-w-0 rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200';
  const heroAnchors = (data?.anchors ?? []).filter((a) => a.characterId === form.characterId);
  const heroName = (id: string) => data?.characters.find((c) => c.id === id)?.name ?? '';

  return (
    <section className="min-w-0 space-y-3" data-emotions>
      <div className="min-w-0 space-y-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-emotions-heroes>
          <span className="text-[11px] text-slate-400">Герої:</span>
          <button type="button" aria-pressed={!!heroes && heroes.length === 0} data-emotions-hero="all" onClick={() => { setHeroes([]); setSelected(null); setEvidence(null); }} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${heroes && heroes.length === 0 ? 'border-sky-400 bg-sky-500/15 text-sky-100' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
            усі
          </button>
          {(data?.characters ?? []).map((c) => {
            const on = !!heroes?.includes(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={on} data-emotions-hero={c.id} onClick={() => toggleHero(c.id)} className={`max-w-[60%] truncate rounded-full border px-2.5 py-0.5 text-[11px] ${on ? 'border-sky-400 bg-sky-500/15 text-sky-100' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
                {c.name} ({c.points})
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-400">
            Шкала
            <select className={selectCls} value={axis} data-emotions-axis onChange={(e) => setAxis(e.target.value as EmotionAxis)}>
              {EMOTION_AXES.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-400">
            Показник
            <select className={selectCls} value={metric} data-emotions-metric onChange={(e) => setMetric(e.target.value as EmotionMetric)}>
              {EMOTION_METRICS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-400">
            Емоція
            <select className={selectCls} value={family} data-emotions-family onChange={(e) => setFamily(e.target.value)}>
              <option value="">усі родини</option>
              {EMOTION_FAMILIES.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-400">
            Шар
            <select className={selectCls} value={layer} data-emotions-layer onChange={(e) => setLayer(e.target.value)}>
              <option value="">усі</option>
              {EMOTION_LAYERS.map((l) => (
                <option key={l.key} value={l.key}>{l.label}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-400">
            До / після події
            <select className={selectCls} value={event} data-emotions-event onChange={(e) => setEvent(e.target.value)}>
              <option value="">не порівнювати</option>
              {(data?.events ?? []).map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.chapterNumber ? ` (гл. ${e.chapterNumber})` : ''}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-400">
            Вікно, глав
            <select className={selectCls} value={windowSize} data-emotions-window disabled={!event} onChange={(e) => setWindowSize(Number(e.target.value))}>
              {[1, 2, 3, 5].map((w) => (
                <option key={w} value={w}>±{w}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading && !data && <Loader2 className="h-5 w-5 animate-spin text-slate-500" />}
      {error && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{error}</p>}
      {message && (
        <p className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[12px] text-sky-100" data-emotions-message>
          <span className="flex-1">{message}</span>
          <button type="button" onClick={() => setMessage(null)} className="text-sky-300"><X className="h-3.5 w-3.5" /></button>
        </p>
      )}

      {data && !data.synced && <p className="text-sm text-slate-400">Книгу ще не синхронізовано з ядром — монітор з'явиться після найближчого збереження.</p>}

      {data?.synced && (
        <>
          <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-3" data-emotions-chart>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <HeartPulse className="h-4 w-4 text-rose-300" />
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {metricLabel(data.metric)} (0–10) · {EMOTION_AXES.find((a) => a.key === data.axis)?.label}
              </h3>
              <span className="text-[11px] text-slate-500" data-emotions-totals>
                з тегів {data.totals.tag} · автора {data.totals.author} · AI {data.totals.ai}
                {data.totals.corrected ? ` · скориговано ${data.totals.corrected}` : ''}
                {data.totals.estimated ? ` · без сили ${data.totals.estimated}` : ''}
              </span>
              <button type="button" onClick={() => setAsTable((v) => !v)} data-emotions-table-toggle className="ml-auto flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-sky-500">
                <Table2 className="h-3 w-3" /> {asTable ? 'графіком' : 'таблицею'}
              </button>
            </div>

            {data.metric !== 'intensity' && data.unscored > 0 && (
              <p className="mb-2 text-[11px] text-amber-200" data-emotions-unscored>
                Недостатньо даних: {data.unscored} {data.unscored === 1 ? 'точка' : 'точок'} без оцінки «{metricLabel(data.metric).toLocaleLowerCase('uk')}» — оцініть їх у панелі точки або запустіть пошук емоцій.
              </p>
            )}
            {data.axis === 'world' && data.untimed > 0 && (
              <p className="mb-2 text-[11px] text-amber-200" data-emotions-untimed>
                {data.untimed} {data.untimed === 1 ? 'точка' : 'точок'} у сценах без часу світу — на шкалу не потрапили. Задайте час сценам на сторінці «Хронологія».
              </p>
            )}

            {data.series.length === 0 ? (
              <p className="text-[12px] text-slate-400" data-emotions-empty>
                {data.points.length
                  ? 'Недостатньо даних для цієї шкали чи показника.'
                  : <>Точок ще немає. Позначте емоцію в тексті тегом <code>[/emotion:страх — 7 @Ім'я]</code> (сила 0–10 після тире, «прихована» чи «другорядна» — шар, герой після @) або додайте точку нижче.</>}
              </p>
            ) : asTable ? (
              <div className="overflow-x-auto" data-emotions-table>
                <table className="min-w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="py-1 pr-3 font-medium">Крива</th>
                      {data.buckets.map((b) => (
                        <th key={b.key} className="px-2 py-1 font-medium" title={b.title}>{b.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.series.map((s) => (
                      <tr key={`${s.characterId}:${s.family}`} className="border-t border-slate-800 text-slate-200">
                        <td className="whitespace-nowrap py-1 pr-3">
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: familyInfo(s.family).color }} />
                          {s.characterName} · {familyInfo(s.family).label.toLocaleLowerCase('uk')}
                        </td>
                        {s.values.map((v, i) => (
                          <td key={i} className="px-2 py-1 tabular-nums text-slate-300">
                            {v == null ? '—' : (
                              <button type="button" className="underline decoration-dotted hover:text-sky-300" onClick={() => showEvidence(`${s.characterName} · ${familyInfo(s.family).label.toLocaleLowerCase('uk')}: ${data.buckets[i].label} — ${v}`, s.pointIds[i])}>{v}</button>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto" ref={boxRef}>
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-none" role="img" aria-label={`${metricLabel(data.metric)} по шкалі`} data-emotions-svg>
                  {[0, 5, 10].map((v) => (
                    <g key={v}>
                      <line x1={PAD.l} x2={W - PAD.r} y1={py(v)} y2={py(v)} stroke="#1e293b" strokeWidth={1} />
                      <text x={PAD.l - 6} y={py(v) + 3} textAnchor="end" className="fill-slate-500" fontSize={10}>{v}</text>
                    </g>
                  ))}
                  {data.buckets.map((b, i) => (
                    <g key={b.key}>
                      {i > 0 && <line x1={px(i)} x2={px(i)} y1={PAD.t} y2={H - PAD.b} stroke="#1e293b" strokeWidth={1} strokeDasharray="2 4" />}
                      {i % labelEvery === 0 && (
                        <text x={px(i + 0.5)} y={H - PAD.b + 14} textAnchor="middle" className="fill-slate-400" fontSize={10}>
                          {b.label.length > 11 ? `${b.label.slice(0, 10)}…` : b.label}
                          <title>{b.title}</title>
                        </text>
                      )}
                    </g>
                  ))}
                  {/* Мітки подій, рішень, конфліктів, порогів — на нижньому краю. */}
                  {data.events.filter((e) => e.x != null).map((e) => (
                    <g key={e.id} data-emotions-event-tick={e.id}>
                      <polygon points={`${px(e.x!)},${H - PAD.b - 7} ${px(e.x!) + 4},${H - PAD.b} ${px(e.x!) - 4},${H - PAD.b}`} fill="#e2e8f0" opacity={0.8} />
                      <title>{`${e.name} (${e.type})`}</title>
                    </g>
                  ))}
                  {data.impact && data.impact.event.place.x != null && (
                    <g data-emotions-event-mark>
                      <line x1={px(data.impact.event.place.x)} x2={px(data.impact.event.place.x)} y1={PAD.t} y2={H - PAD.b} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4 3" />
                      <text x={px(data.impact.event.place.x) + 4} y={PAD.t + 9} className="fill-slate-300" fontSize={10}>{data.impact.event.name}</text>
                    </g>
                  )}
                  {/* Окремі абзаци — тонкі точки під лініями. Порожній кружок — сила не вказана; пунктир — прихована емоція. */}
                  {data.points.filter((p) => p.characterId && p.place.x != null && metricValue(p, data.metric) != null).map((p) => {
                    const v = metricValue(p, data.metric)!;
                    const c = familyInfo(p.family).color;
                    const hollow = p.estimated && data.metric === 'intensity';
                    return (
                      <g key={p.id} className="cursor-pointer" data-emotions-point={p.id} onClick={() => { setSelected(p.id); setEvidence(null); }}>
                        <circle cx={px(p.place.x!)} cy={py(v)} r={10} fill="transparent" />
                        <circle
                          cx={px(p.place.x!)}
                          cy={py(v)}
                          r={selected === p.id ? 4.5 : p.layer === 'secondary' ? 2.5 : 3.2}
                          fill={hollow || p.layer === 'hidden' ? '#0f172a' : c}
                          stroke={c}
                          strokeWidth={hollow || p.layer === 'hidden' ? 1.5 : 0}
                          strokeDasharray={p.layer === 'hidden' ? '2 1.5' : undefined}
                          opacity={selected === p.id ? 1 : 0.6}
                        />
                        <title>{`${p.characterName} · ${p.emotion} ${v}${hollow ? ' (сила не вказана)' : ''} · ${layerLabel(p.layer)} — гл. ${p.place.chapterNumber ?? '?'}: ${p.place.excerpt}`}</title>
                      </g>
                    );
                  })}
                  {data.series.map((s) => {
                    const color = familyInfo(s.family).color;
                    const dash = DASHES[charOrder.indexOf(s.characterId) % DASHES.length];
                    // Розрив лінії там, де у відрізку оцінок немає.
                    const segs: string[][] = [];
                    let cur: string[] = [];
                    s.values.forEach((v, i) => {
                      if (v == null) {
                        if (cur.length) segs.push(cur);
                        cur = [];
                      } else cur.push(`${px(i + 0.5)},${py(v)}`);
                    });
                    if (cur.length) segs.push(cur);
                    return (
                      <g key={`${s.characterId}:${s.family}`} data-emotions-series={`${s.characterName}:${s.family}`}>
                        {segs.map((seg, k) => seg.length > 1 && <polyline key={k} points={seg.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeDasharray={dash} strokeLinejoin="round" />)}
                        {s.values.map((v, i) =>
                          v == null ? null : (
                            <g
                              key={i}
                              className="cursor-pointer"
                              data-emotions-average={`${s.characterName}:${s.family}:${i}`}
                              onClick={() => showEvidence(`${s.characterName} · ${familyInfo(s.family).label.toLocaleLowerCase('uk')}: ${data.buckets[i].label} — середнє ${v}`, s.pointIds[i])}
                            >
                              <circle cx={px(i + 0.5)} cy={py(v)} r={10} fill="transparent" />
                              <Marker family={s.family} x={px(i + 0.5)} y={py(v)} />
                              <title>{`${s.characterName} · ${familyInfo(s.family).label}: ${data.buckets[i].title} — середнє ${v} (точок: ${s.counts[i]}) — натисніть, щоб побачити абзаци`}</title>
                            </g>
                          ),
                        )}
                      </g>
                    );
                  })}
                  {labels.map((l) => (
                    <text key={l.key} x={W - PAD.r + 6} y={l.y + 3} fontSize={10} className="fill-slate-300">
                      {l.text}
                    </text>
                  ))}
                </svg>
              </div>
            )}

            {data.series.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300" data-emotions-legend>
                {data.families.map((f) => (
                  <span key={f.key} className="flex items-center gap-1">
                    <svg width={12} height={12} aria-hidden><Marker family={f.key} x={6} y={6} r={3.5} /></svg>
                    {f.label} ({f.points})
                  </span>
                ))}
                {multiHero && charOrder.map((id, i) => (
                  <span key={id} className="flex items-center gap-1 text-slate-400">
                    <svg width={18} height={6} aria-hidden><line x1={0} x2={18} y1={3} y2={3} stroke="#cbd5e1" strokeWidth={2} strokeDasharray={DASHES[i % DASHES.length]} /></svg>
                    {data.series.find((s) => s.characterId === id)?.characterName}
                  </span>
                ))}
                {data.events.some((e) => e.x != null) && <span className="text-slate-400">▲ — подія, рішення, конфлікт</span>}
              </div>
            )}
            <p className="mt-1.5 text-[10px] text-slate-500">
              Натисніть маркер кривої — побачите абзаци, з яких пораховано оцінку. Порожній кружок — сила не вказана в тезі (стоїть 5); пунктирний — прихована емоція. Числа — евристика для редагування художнього тексту, не клінічний вимір: зважайте на жанр і свій задум.
            </p>
          </div>

          {evidence && (
            <aside className="min-w-0 space-y-2 rounded-2xl border border-sky-500/30 bg-slate-900/70 p-4" data-emotions-evidence>
              <div className="flex items-start gap-2">
                <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                <h3 className="min-w-0 flex-1 text-sm font-bold text-slate-100">Докази: {evidence.title}</h3>
                <button type="button" onClick={() => setEvidence(null)} className="text-slate-500 hover:text-slate-200"><X className="h-4 w-4" /></button>
              </div>
              {evidence.pointIds.length ? (
                <ul className="space-y-1.5">
                  {evidence.pointIds.map((id) => pointById.get(id)).filter((p): p is Point => !!p).map((p) => (
                    <li key={p.id} className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 text-[12px]" data-emotions-evidence-item={p.place.paragraphId}>
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: familyInfo(p.family).color }} />
                        <button type="button" className="font-bold text-slate-100 hover:text-sky-300" onClick={() => { setSelected(p.id); setEvidence(null); }}>{p.characterName || 'без героя'}: {p.emotion}</button>
                        <span className="text-slate-400">сила {p.intensity}{p.estimated ? ' (не вказана)' : ''} · майст. {score(p.craft)} · вплив {score(p.impact)} · {layerLabel(p.layer)} · {SOURCE_UK[p.source]}{p.corrected ? ', скориговано' : ''}</span>
                        <button type="button" data-emotions-evidence-open onClick={() => open(p.place)} className="ml-auto flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200"><ExternalLink className="h-3 w-3" /> до тексту</button>
                      </div>
                      <p className="mt-0.5 italic text-slate-300">гл. {p.place.chapterNumber ?? '?'} · «{p.place.excerpt}»</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-slate-400">Недостатньо даних — точок немає.</p>
              )}
            </aside>
          )}

          {sel && (
            <aside className="min-w-0 space-y-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4" data-emotions-panel={sel.id}>
              <div className="flex items-start gap-2">
                <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: familyInfo(sel.family).color }} />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold text-slate-100">{sel.characterName}: {sel.emotion} — {sel.intensity}{sel.estimated ? ' (сила не вказана)' : ''}</h3>
                  <p className="text-[11px] text-slate-400">
                    {SOURCE_UK[sel.source]}{sel.corrected ? ` · скориговано автором (у тезі ${sel.tagIntensity})` : ''} · {layerLabel(sel.layer)} · майстерність передачі {score(sel.craft)} · вплив на сюжет {score(sel.impact)} · глава {sel.place.chapterNumber ?? '?'} · {sel.place.sectionTitle}
                  </p>
                </div>
                <button type="button" data-emotions-open onClick={() => open(sel.place)} className="flex shrink-0 items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[11px] hover:border-sky-500">
                  <ExternalLink className="h-3 w-3" /> до тексту
                </button>
                <button type="button" onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-200"><X className="h-4 w-4" /></button>
              </div>
              <p className="text-[12px] italic text-slate-300">«{sel.place.excerpt}»</p>
              {sel.note && <p className="text-[11px] text-slate-400">{sel.note}</p>}
              {data.canEdit && sel.characterId && correction && (
                <div className="space-y-1.5 border-t border-slate-800 pt-2" data-emotions-correct>
                  <p className="text-[11px] text-slate-400">{sel.source === 'tag' ? 'Скоригувати оцінку (текст книги й тег не зміняться):' : 'Змінити оцінки:'}</p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                    <label className="col-span-2 flex items-center gap-1.5 text-[11px] text-slate-300">
                      сила
                      <input type="range" min={0} max={10} step={1} value={correction.intensity} data-emotions-correct-intensity onChange={(e) => setCorrection((c) => c && { ...c, intensity: Number(e.target.value) })} className="min-w-0 flex-1" />
                      <span className="w-4 tabular-nums">{correction.intensity}</span>
                    </label>
                    <select className={selectCls} value={correction.layer} data-emotions-correct-layer onChange={(e) => setCorrection((c) => c && { ...c, layer: e.target.value })}>
                      {EMOTION_LAYERS.map((l) => (
                        <option key={l.key} value={l.key}>{l.label}</option>
                      ))}
                    </select>
                    <select className={selectCls} value={correction.craft} title="Майстерність передачі" data-emotions-correct-craft onChange={(e) => setCorrection((c) => c && { ...c, craft: e.target.value })}>
                      {scoreOptions.map((o) => (
                        <option key={o} value={o}>{o === '' ? 'майст.: не оцінено' : `майст.: ${o}`}</option>
                      ))}
                    </select>
                    <select className={selectCls} value={correction.impact} title="Вплив на сюжет" data-emotions-correct-impact onChange={(e) => setCorrection((c) => c && { ...c, impact: e.target.value })}>
                      {scoreOptions.map((o) => (
                        <option key={o} value={o}>{o === '' ? 'вплив: не оцінено' : `вплив: ${o}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={busy === 'save'} onClick={() => void saveCorrection()} data-emotions-correct-save className="rounded-lg bg-sky-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-50">
                      {sel.source === 'tag' ? 'Скоригувати' : 'Зберегти'}
                    </button>
                    {sel.source !== 'tag' && (
                      askDelete === sel.id ? (
                        <span className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-[12px] text-rose-100" data-emotions-delete-confirm>
                          {sel.corrected ? 'Скасувати коригування? Повернеться оцінка з тега.' : 'Прибрати цю точку з кривої? Текст книги не зміниться.'}
                          <button type="button" disabled={busy === sel.id} onClick={() => void removePoint(sel.id)} className="rounded bg-rose-600 px-2.5 py-0.5 text-[11px] font-bold text-white">Так</button>
                          <button type="button" onClick={() => setAskDelete(null)} className="rounded border border-slate-600 px-2.5 py-0.5 text-[11px]">Ні</button>
                        </span>
                      ) : (
                        <button type="button" data-emotions-delete onClick={() => setAskDelete(sel.id)} className="flex items-center gap-1 text-[11px] text-rose-300 hover:text-rose-200">
                          <Trash2 className="h-3 w-3" /> {sel.corrected ? 'скасувати коригування' : 'прибрати точку'}
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </aside>
          )}

          {data.impact && (
            <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-3" data-emotions-impact>
              <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                До / після «{data.impact.event.name}» (±{data.impact.window} гл.) · {metricLabel(data.metric).toLocaleLowerCase('uk')}
              </h3>
              {data.impact.rows.length ? (
                <ul className="space-y-1">
                  {data.impact.rows.map((r) => (
                    <li key={`${r.characterId}:${r.family}`}>
                      <button
                        type="button"
                        className="flex w-full min-w-0 items-center gap-2 rounded px-1 text-left text-[12px] text-slate-200 hover:bg-slate-800/60"
                        data-emotions-impact-row={`${r.characterName}:${r.family}`}
                        onClick={() => showEvidence(`${r.characterName} · ${familyInfo(r.family).label.toLocaleLowerCase('uk')} до / після «${data.impact!.event.name}»`, r.pointIds)}
                      >
                        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: familyInfo(r.family).color }} />
                        <span className="min-w-0 flex-1 truncate">{r.characterName} · {familyInfo(r.family).label.toLocaleLowerCase('uk')}</span>
                        <span className="tabular-nums text-slate-400">{r.before ? r.before.avg : '—'} → {r.after ? r.after.avg : '—'}</span>
                        <span className={`w-24 text-right tabular-nums ${r.delta == null ? 'text-[10px] text-slate-500' : 'font-bold text-slate-100'}`}>
                          {r.delta == null ? 'недостатньо даних' : `${r.delta > 0 ? '▲ +' : r.delta < 0 ? '▼ ' : '= '}${r.delta}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-500">Недостатньо даних: поруч із подією точок немає — збільште вікно або позначте емоції в цих главах.</p>
              )}
            </div>
          )}

          {data.scenes.length > 0 && (
            <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-3" data-emotions-scenes>
              <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Настрій сцен</h3>
              <div className="flex flex-wrap gap-1.5">
                {data.scenes.map((s) => (
                  <button
                    key={s.sectionId}
                    type="button"
                    data-emotions-scene={s.sectionId}
                    onClick={() => showEvidence(`настрій сцени «${s.title}»: переважає ${familyInfo(s.dominant).label.toLocaleLowerCase('uk')}, баланс ${s.valence > 0 ? '+' : ''}${s.valence}`, s.pointIds)}
                    title={`${s.title}: переважає ${familyInfo(s.dominant).label.toLocaleLowerCase('uk')}, середня сила ${s.avgIntensity}, баланс ${s.valence > 0 ? '+' : ''}${s.valence} (точок: ${s.points})`}
                    className="flex max-w-[48%] min-w-0 items-center gap-1.5 rounded-lg border border-slate-800 px-2 py-1 text-left text-[11px] text-slate-200 hover:border-sky-500 sm:max-w-[32%]"
                  >
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: familyInfo(s.dominant).color }} />
                    <span className="min-w-0 flex-1 truncate">{s.chapterNumber ? `${s.chapterNumber}. ` : ''}{s.title}</span>
                    <span className="shrink-0 tabular-nums text-slate-400">{s.valence > 0 ? '+' : ''}{s.valence}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">Колір — родина, що переважає; число — баланс від −10 (важкі емоції) до +10 (ресурсні). Натисніть — абзаци-докази.</p>
            </div>
          )}

          {data.warnings.length > 0 && (
            <div className="min-w-0 space-y-1.5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3" data-emotions-warnings>
              {data.warnings.map((w, i) => (
                <div key={i} className="flex min-w-0 items-start gap-2 text-[12px] text-amber-100" data-emotions-warning={w.kind}>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <span className="min-w-0 flex-1">{w.message}</span>
                  {w.pointIds.length > 0 && (
                    <button type="button" onClick={() => showEvidence(w.message.slice(0, 80), w.pointIds)} className="shrink-0 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] hover:border-amber-300">докази</button>
                  )}
                  {w.editorPid && w.sectionId && w.chapterId && (
                    <button type="button" onClick={() => open({ chapterId: w.chapterId, sectionId: w.sectionId!, editorPid: w.editorPid! })} className="shrink-0 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] hover:border-amber-300">
                      до тексту
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {(data.suggestions.length > 0 || (data.canEdit && heroes?.length)) && (
            <div className="min-w-0 space-y-2 rounded-2xl border border-slate-800 bg-slate-900/50 p-3" data-emotions-suggestions>
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-300" />
                <h3 className="flex-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Пропозиції AI на розгляд ({data.suggestions.length})</h3>
                {data.canEdit && !!heroes?.length && (
                  <button type="button" disabled={analyzing} onClick={() => void analyze()} data-emotions-analyze className="flex max-w-full items-center gap-1 truncate rounded-lg border border-violet-500/40 px-2.5 py-1 text-[11px] text-violet-100 hover:border-violet-300 disabled:opacity-50">
                    {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} знайти емоції: {heroName(heroes[0])}
                  </button>
                )}
              </div>
              {data.suggestions.map((s) => (
                <div key={s.id} className="min-w-0 space-y-1 rounded-xl border border-slate-800 bg-slate-950/40 p-2.5" data-emotions-suggestion={s.id}>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px]">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: familyInfo(s.family).color }} />
                    <span className="font-bold text-slate-100">{s.characterName}: {s.emotion}</span>
                    {s.insufficient ? (
                      <span className="rounded bg-slate-700 px-1 text-[10px] text-slate-200" data-emotions-insufficient>недостатньо даних</span>
                    ) : (
                      <span className="text-slate-400">гл. {s.place?.chapterNumber ?? '?'} · {layerLabel(s.layer)} · майст. {score(s.craft)} · вплив {score(s.impact)}</span>
                    )}
                    {s.needsReview && <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-200">текст змінився</span>}
                    {s.place && (
                      <button type="button" onClick={() => open(s.place)} className="ml-auto text-[11px] text-sky-300 hover:text-sky-200">до тексту</button>
                    )}
                  </div>
                  {s.statement && <p className="text-[11px] text-slate-300">{s.statement}</p>}
                  {s.quote && <p className="text-[11px] italic text-slate-400">«{s.quote}»</p>}
                  {data.canEdit && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                      {!s.insufficient && (
                        <>
                          <label className="flex items-center gap-1.5">
                            сила
                            <input type="range" min={0} max={10} step={1} value={strength[s.id] ?? s.intensity} data-emotions-strength={s.id} onChange={(e) => setStrength((m) => ({ ...m, [s.id]: Number(e.target.value) }))} />
                            <span className="w-4 tabular-nums">{strength[s.id] ?? s.intensity}</span>
                          </label>
                          <button type="button" disabled={busy === s.id} data-emotions-confirm={s.id} onClick={() => void decide(s, 'confirmed')} className="rounded bg-emerald-700 px-2.5 py-0.5 font-bold text-white hover:bg-emerald-600 disabled:opacity-50">Підтвердити</button>
                        </>
                      )}
                      <button type="button" disabled={busy === s.id} data-emotions-reject={s.id} onClick={() => void decide(s, 'rejected')} className="rounded border border-slate-600 px-2.5 py-0.5 hover:border-slate-400 disabled:opacity-50">{s.insufficient ? 'Прибрати' : 'Відхилити'}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {data.canEdit && !!heroes?.length && (data.anchors.length ?? 0) > 0 && (
            <div className="min-w-0 space-y-2 rounded-2xl border border-slate-800 bg-slate-900/50 p-3" data-emotions-add>
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Додати точку вручну</h3>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {heroes.length > 1 && (
                  <select className={`${selectCls} col-span-2 sm:col-span-4`} value={form.characterId} data-emotions-add-hero onChange={(e) => setForm((f) => ({ ...f, characterId: e.target.value, paragraphId: '' }))}>
                    {heroes.map((h) => (
                      <option key={h} value={h}>{heroName(h)}</option>
                    ))}
                  </select>
                )}
                <select className={`${selectCls} col-span-2 sm:col-span-4`} value={form.paragraphId} data-emotions-add-paragraph onChange={(e) => setForm((f) => ({ ...f, paragraphId: e.target.value }))}>
                  <option value="">абзац, де є герой…</option>
                  {heroAnchors.map((a) => (
                    <option key={a.paragraphId} value={a.paragraphId}>гл. {a.chapterNumber ?? '?'} · {a.excerpt.slice(0, 90)}</option>
                  ))}
                </select>
                <input className={`${selectCls} col-span-2 sm:col-span-1`} value={form.emotion} placeholder="емоція (полегшення)" data-emotions-add-emotion maxLength={80} onChange={(e) => setForm((f) => ({ ...f, emotion: e.target.value }))} />
                <label className="col-span-2 flex items-center gap-1.5 text-[11px] text-slate-300 sm:col-span-1">
                  сила
                  <input type="range" min={0} max={10} step={1} value={form.intensity} data-emotions-add-intensity onChange={(e) => setForm((f) => ({ ...f, intensity: Number(e.target.value) }))} className="min-w-0 flex-1" />
                  <span className="w-4 tabular-nums">{form.intensity}</span>
                </label>
                <select className={selectCls} value={form.layer} data-emotions-add-layer onChange={(e) => setForm((f) => ({ ...f, layer: e.target.value }))}>
                  {EMOTION_LAYERS.map((l) => (
                    <option key={l.key} value={l.key}>{l.label}</option>
                  ))}
                </select>
                <select className={selectCls} value={form.craft} title="Майстерність передачі" data-emotions-add-craft onChange={(e) => setForm((f) => ({ ...f, craft: e.target.value }))}>
                  {scoreOptions.map((o) => (
                    <option key={o} value={o}>{o === '' ? 'майст.: не оцінено' : `майст.: ${o}`}</option>
                  ))}
                </select>
                <select className={selectCls} value={form.impact} title="Вплив на сюжет" data-emotions-add-impact onChange={(e) => setForm((f) => ({ ...f, impact: e.target.value }))}>
                  {scoreOptions.map((o) => (
                    <option key={o} value={o}>{o === '' ? 'вплив: не оцінено' : `вплив: ${o}`}</option>
                  ))}
                </select>
                <input className={selectCls} value={form.note} placeholder="примітка" maxLength={500} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
                <button type="button" disabled={busy === 'save'} onClick={() => void addPoint()} data-emotions-add-save className="col-span-2 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50 sm:col-span-4">Додати</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default EmotionMonitorPage;
