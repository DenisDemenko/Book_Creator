/**
 * Сторінка 3 — «Жива біографія персонажа» (Т1.5, ТЗ-11 §4).
 *
 * Канон автора (картка в «Персонажах») і висновки ШІ показано окремо й
 * по-різному; факти Profile Builder мають оцінку (підтверджено / пропозиція /
 * суперечить канону / недостатньо даних) і джерела-абзаци з переходом у
 * редактор; «Підтвердити / Відхилити» — за правами. Затверджене ШІ не змінює.
 * Появи, стани (арка) і події — з тегів автора, у порядку книги. Перемикач
 * «стан на главі N» ховає все з пізніших глав. Якщо героя перейменовано (П6),
 * сторінка показує, де старе ім'я ще в книзі, і пропонує заміну окремо в
 * тегах і в тексті.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ExternalLink, Loader2, RefreshCw, Sparkles, UserRound, X } from 'lucide-react';
import type { Book } from '../types';
import { calculateWordCount } from '../utils/helpers';
import { countNameInBook, replaceNameInBook } from '../utils/heroRename';
import { entityBySlug } from '../utils/coreEntities';

interface Place {
  paragraphId: string;
  editorPid: string;
  sectionId: string;
  sectionTitle: string;
  chapterId: string | null;
  chapterNumber: number | null;
  excerpt: string;
}
interface Fact {
  id: string;
  field: string;
  fieldLabel: string;
  statement: string;
  quote: string;
  status: 'suggested' | 'confirmed' | 'rejected';
  assessment: 'confirmed' | 'suggested' | 'contradicted' | 'unknown';
  needsReview: boolean;
  sources: Place[];
  chapterNumber: number | null;
}
interface Item {
  entityId: string;
  type: string;
  name: string;
  detail: string;
  via: 'tag' | 'relation' | 'scene';
  place: Place | null;
}
interface Profile {
  entity: { id: string; name: string; type: string };
  aliases: string[];
  formerNames: string[];
  canon: { fields: { key: string; label: string; value: string }[]; portraitUrl: string | null; hidden: boolean; linked: boolean };
  chapters: { id: string; number: number; title: string }[];
  upto: number | null;
  appearances: { total: number; items: Place[] };
  timeline: Item[];
  arc: { initial: Item[]; intermediate: Item[]; current: Item[] };
  relations: { id: string; kind: string; label: string; direction: 'out' | 'in'; otherId: string; otherName: string; sources: Place[] }[];
  facts: { confirmed: Fact[]; suggested: Fact[]; contradicted: Fact[]; unknown: Fact[] };
  canEdit: boolean;
}

interface Props {
  book: Book;
  entityId: string;
  onBack: () => void;
  onOpenParagraph: (t: { chapterId: string; sectionId: string; editorPid: string; text: string }) => void;
  onUpdateBook?: (book: Book, logAction?: string, logDetails?: string) => void;
  onOpenCharacter: (id: string) => void;
}

const api = (url: string, init?: RequestInit) =>
  fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });

const typeUk = (t: string) => entityBySlug(t)?.nameUk ?? t;

const Section: React.FC<{ title: string; children: React.ReactNode; tone?: string; attr?: string }> = ({ title, children, tone, attr }) => (
  <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-4" data-profile-section={attr}>
    <h3 className={`mb-2.5 text-[11px] font-bold uppercase tracking-wide ${tone ?? 'text-slate-400'}`}>{title}</h3>
    {children}
  </section>
);

export const CharacterProfilePage: React.FC<Props> = ({ book, entityId, onBack, onOpenParagraph, onUpdateBook, onOpenCharacter }) => {
  const base = `/api/projects/${encodeURIComponent(book.id)}/characters/${encodeURIComponent(entityId)}`;
  const [upto, setUpto] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api(`${base}/profile${upto ? `?chapter=${upto}` : ''}`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) setError(res?.status === 403 ? 'Немає доступу до цієї книги.' : res?.status === 503 ? 'Семантичне ядро зараз недоступне.' : body.error || 'Не вдалося завантажити профіль.');
    else {
      setError(null);
      setProfile(body as Profile);
    }
    setLoading(false);
  }, [base, upto]);

  useEffect(() => {
    void load();
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [load]);

  const build = async () => {
    setBuilding(true);
    setMessage(null);
    const res = await api(`${base}/profile/build`, { method: 'POST', body: '{}' }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setBuilding(false);
      setMessage(body.error || 'Не вдалося запустити Profile Builder.');
      return;
    }
    const jobUrl = `/api/projects/${encodeURIComponent(book.id)}/jobs/${body.jobId}`;
    const tick = async () => {
      const r = await api(jobUrl).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      if (j && (j.status === 'queued' || j.status === 'running')) {
        poll.current = setTimeout(tick, 1500);
        return;
      }
      setBuilding(false);
      if (j?.status === 'succeeded') setMessage(j.result?.facts ? `Нових фактів: ${j.result.facts}` : 'Нових фактів немає — усе, що знайшлося, уже в профілі.');
      else setMessage(j?.error || 'Profile Builder не впорався.');
      await load();
    };
    poll.current = setTimeout(tick, 1200);
  };

  const decide = async (f: Fact, status: 'confirmed' | 'rejected') => {
    setBusy(f.id);
    const res = await api(`${base}/facts/${f.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }).catch(() => null);
    if (!res?.ok) setMessage(((await res?.json().catch(() => ({}))) as any)?.error || 'Не вдалося.');
    setBusy(null);
    await load();
  };

  const rename = useMemo(() => {
    if (!profile) return [];
    return profile.formerNames.map((old) => ({ old, ...countNameInBook(book, old) })).filter((r) => r.tags + r.text > 0);
  }, [profile, book]);

  const doRename = (old: string, scope: 'tags' | 'text') => {
    if (!profile || !onUpdateBook) return;
    const res = replaceNameInBook(book, old, profile.entity.name, scope, calculateWordCount);
    if (!res.replaced) return;
    onUpdateBook(res.book, 'Перейменування героя', `«${old}» → «${profile.entity.name}» ${scope === 'tags' ? 'у тегах' : 'у тексті'}: ${res.replaced} (розділів: ${res.sections})`);
    setMessage(`Замінено ${scope === 'tags' ? 'в тегах' : 'в тексті'}: ${res.replaced}.`);
  };

  const PlaceLine = ({ p }: { p: Place }) => (
    <li className="flex items-start gap-1.5 text-[11px] text-slate-400" data-profile-place={p.paragraphId}>
      <span className="shrink-0 rounded bg-slate-800 px-1 text-[10px] text-slate-300">{p.chapterNumber ? `гл. ${p.chapterNumber}` : '—'}</span>
      <span className="line-clamp-2 flex-1">{p.excerpt}</span>
      {p.chapterId && (
        <button
          type="button"
          title="Відкрити в редакторі"
          data-profile-open
          onClick={() => onOpenParagraph({ chapterId: p.chapterId!, sectionId: p.sectionId, editorPid: p.editorPid, text: p.excerpt })}
          className="shrink-0 rounded border border-slate-700 p-0.5 hover:border-sky-500"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      )}
    </li>
  );

  const FactCard = ({ f }: { f: Fact }) => (
    <li className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5" data-profile-fact={f.id} data-profile-fact-assessment={f.assessment}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 rounded bg-slate-800 px-1.5 text-[10px] text-slate-300">{f.fieldLabel}</span>
        <p className="flex-1 text-[12px] text-slate-100">{f.statement}</p>
        {f.needsReview && <span className="shrink-0 rounded border border-amber-500/40 px-1 text-[10px] text-amber-300">на перегляд</span>}
      </div>
      {f.quote && <p className="mt-1 text-[11px] italic text-slate-400">«{f.quote}»</p>}
      {f.sources.length > 0 && <ul className="mt-1.5 space-y-1">{f.sources.map((s) => <PlaceLine key={s.paragraphId} p={s} />)}</ul>}
      {f.status !== 'confirmed' && profile?.canEdit && (
        <div className="mt-1.5 flex gap-1.5">
          <button type="button" disabled={busy === f.id} data-profile-fact-confirm onClick={() => void decide(f, 'confirmed')} className="flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10">
            <Check className="h-3 w-3" /> Підтвердити
          </button>
          <button type="button" disabled={busy === f.id} data-profile-fact-reject onClick={() => void decide(f, 'rejected')} className="flex items-center gap-1 rounded border border-rose-500/40 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/10">
            <X className="h-3 w-3" /> Відхилити
          </button>
        </div>
      )}
    </li>
  );

  const ItemRow = ({ it }: { it: Item }) => (
    <li className="flex items-start gap-1.5 text-[12px] text-slate-200" data-profile-item={it.entityId}>
      <span className="shrink-0 rounded bg-slate-800 px-1 text-[10px] text-slate-300">{it.place?.chapterNumber ? `гл. ${it.place.chapterNumber}` : '—'}</span>
      <span className="flex-1">
        <b>{it.name}</b>
        {it.detail && it.detail !== it.name ? <span className="text-slate-400"> · {it.detail}</span> : null}
        <span className="text-[10px] text-slate-500"> · {typeUk(it.type).toLowerCase()}{it.via === 'scene' ? ', у сцені з героєм' : it.via === 'relation' ? ', зв\'язок' : ''}</span>
      </span>
      {it.place?.chapterId && (
        <button type="button" title="Відкрити в редакторі" onClick={() => onOpenParagraph({ chapterId: it.place!.chapterId!, sectionId: it.place!.sectionId, editorPid: it.place!.editorPid, text: it.place!.excerpt })} className="shrink-0 rounded border border-slate-700 p-0.5 hover:border-sky-500">
          <ExternalLink className="h-3 w-3" />
        </button>
      )}
    </li>
  );

  return (
    <div className="min-w-0 space-y-3" data-character-profile={entityId}>
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Усі герої
      </button>
      {loading && !profile && <Loader2 className="h-5 w-5 animate-spin text-slate-500" />}
      {error && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{error}</p>}
      {profile && (
        <>
          <header className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:flex-row sm:items-center">
            {profile.canon.portraitUrl ? (
              <img src={profile.canon.portraitUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-slate-800">
                <UserRound className="h-8 w-8 text-slate-500" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-100" data-profile-name>{profile.entity.name}</h2>
              <p className="text-[12px] text-slate-400">
                {typeUk(profile.entity.type)} · появ у тексті: {profile.appearances.total}
                {profile.aliases.length ? ` · також: ${profile.aliases.join(', ')}` : ''}
                {profile.formerNames.length ? ` · колишнє ім'я: ${profile.formerNames.join(', ')}` : ''}
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 sm:items-end">
              <label className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                Стан на главі
                <select
                  value={upto ?? ''}
                  data-profile-upto
                  onChange={(e) => setUpto(e.target.value ? Number(e.target.value) : null)}
                  className="w-full min-w-0 max-w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 sm:w-auto sm:max-w-[260px]"
                >
                  <option value="">уся книга</option>
                  {profile.chapters.map((c) => (
                    <option key={c.id} value={c.number}>
                      {c.number}. {c.title}
                    </option>
                  ))}
                </select>
              </label>
              {profile.canEdit && (
                <button type="button" disabled={building} onClick={() => void build()} data-profile-build className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[11px] font-bold text-violet-200 hover:bg-violet-500/20 disabled:opacity-50">
                  {building ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {building ? 'Profile Builder працює…' : 'Оновити профіль (ШІ)'}
                </button>
              )}
            </div>
          </header>
          {upto && (
            <p className="rounded-xl border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-[11px] text-sky-200" data-profile-spoiler-note>
              Стан на главі {upto}: показано лише те, що має джерела в главах 1–{upto}. Картку автора (вона не прив'язана до глав) приховано, щоб не було спойлерів.
            </p>
          )}
          {message && <p className="text-[11px] text-amber-300" data-profile-message>{message}</p>}

          {rename.length > 0 && onUpdateBook && profile.canEdit && (
            <Section title="Героя перейменовано" tone="text-amber-300" attr="rename">
              {rename.map((r) => (
                <div key={r.old} className="space-y-1.5 text-[12px] text-slate-300" data-profile-rename={r.old}>
                  <p>
                    Старе ім'я «{r.old}» лишилось псевдонімом (старі теги ведуть сюди), але в книзі воно ще трапляється: у тегах — {r.tags}, у тексті — {r.text}.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.tags > 0 && (
                      <button type="button" data-profile-rename-tags onClick={() => doRename(r.old, 'tags')} className="flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[11px] hover:border-sky-500">
                        <RefreshCw className="h-3 w-3" /> Замінити в тегах ({r.tags})
                      </button>
                    )}
                    {r.text > 0 && (
                      <button type="button" data-profile-rename-text onClick={() => doRename(r.old, 'text')} className="flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[11px] hover:border-sky-500">
                        <RefreshCw className="h-3 w-3" /> Замінити в тексті ({r.text})
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </Section>
          )}

          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <Section title="Канон автора" tone="text-emerald-300" attr="canon">
              {profile.canon.fields.length ? (
                <dl className="space-y-1.5">
                  {profile.canon.fields.map((f) => (
                    <div key={f.key} className="text-[12px]">
                      <dt className="text-[10px] uppercase text-slate-500">{f.label}</dt>
                      <dd className="break-words text-slate-200">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-[11px] text-slate-500">{profile.canon.linked ? 'Картку героя ще не заповнено.' : 'Героя немає в «Персонажах» — канон автора тут з\'явиться, коли його додати.'}</p>
              )}
              <p className="mt-2 text-[10px] text-slate-500">Це дані автора з «Персонажів». ШІ їх не змінює — лише порівнює з текстом.</p>
            </Section>

            <Section title={`Підтверджені факти (${profile.facts.confirmed.length})`} tone="text-emerald-300" attr="confirmed">
              {profile.facts.confirmed.length ? <ul className="space-y-1.5">{profile.facts.confirmed.map((f) => <FactCard key={f.id} f={f} />)}</ul> : <p className="text-[11px] text-slate-500">Ще немає — підтвердьте пропозиції ШІ нижче.</p>}
            </Section>
          </div>

          {(profile.facts.suggested.length > 0 || profile.facts.contradicted.length > 0 || profile.facts.unknown.length > 0) && (
            <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
              <Section title={`Пропозиції ШІ (${profile.facts.suggested.length})`} tone="text-violet-300" attr="suggested">
                <ul className="space-y-1.5">{profile.facts.suggested.map((f) => <FactCard key={f.id} f={f} />)}</ul>
              </Section>
              <Section title={`Суперечать канону (${profile.facts.contradicted.length})`} tone="text-rose-300" attr="contradicted">
                <ul className="space-y-1.5">{profile.facts.contradicted.map((f) => <FactCard key={f.id} f={f} />)}</ul>
              </Section>
              <Section title={`Недостатньо даних (${profile.facts.unknown.length})`} tone="text-slate-400" attr="unknown">
                <ul className="space-y-1.5">{profile.facts.unknown.map((f) => <FactCard key={f.id} f={f} />)}</ul>
              </Section>
            </div>
          )}

          <Section title="Арка трансформації" attr="arc">
            {profile.arc.initial.length + profile.arc.current.length === 0 ? (
              <p className="text-[11px] text-slate-500">Станів героя ще немає: позначте в тексті емоції чи стани з ним як суб'єктом — `[/emotion:страх @{profile.entity.name}]`.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {(['initial', 'intermediate', 'current'] as const).map((k) => (
                  <div key={k} data-profile-arc={k}>
                    <div className="mb-1 text-[11px] font-bold text-slate-300">{k === 'initial' ? 'Початковий стан' : k === 'intermediate' ? 'Проміжний' : 'Поточний'}</div>
                    {profile.arc[k].length ? <ul className="space-y-1">{profile.arc[k].map((it, i) => <ItemRow key={`${it.entityId}-${i}`} it={it} />)}</ul> : <p className="text-[11px] text-slate-500">—</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <Section title={`Події й рішення (${profile.timeline.length})`} attr="timeline">
              {profile.timeline.length ? <ul className="space-y-1">{profile.timeline.map((it, i) => <ItemRow key={`${it.entityId}-${i}`} it={it} />)}</ul> : <p className="text-[11px] text-slate-500">Подій поруч із героєм ще не позначено.</p>}
            </Section>
            <Section title={`Стосунки й зв'язки (${profile.relations.length})`} attr="relations">
              {profile.relations.length ? (
                <ul className="space-y-1">
                  {profile.relations.map((r) => (
                    <li key={r.id} className="text-[12px] text-slate-200" data-profile-relation={r.id}>
                      {r.direction === 'out' ? `${profile.entity.name} → ${r.label} → ` : ''}
                      <button type="button" className="font-bold hover:text-sky-300" onClick={() => onOpenCharacter(r.otherId)}>
                        {r.otherName}
                      </button>
                      {r.direction === 'in' ? ` → ${r.label} → ${profile.entity.name}` : ''}
                      <span className="text-[10px] text-slate-500"> · джерел: {r.sources.length}{r.kind === 'tag' ? ' (з тегів)' : ''}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-500">Підтверджених зв'язків ще немає (див. «Граф історії»).</p>
              )}
            </Section>
          </div>

          <Section title={`Появи в тексті (${profile.appearances.total})`} attr="appearances">
            {profile.appearances.items.length ? (
              <>
                <ul className="space-y-1">{(showAll ? profile.appearances.items : profile.appearances.items.slice(0, 12)).map((p) => <PlaceLine key={p.paragraphId} p={p} />)}</ul>
                {profile.appearances.items.length > 12 && !showAll && (
                  <button type="button" onClick={() => setShowAll(true)} className="mt-1.5 text-[11px] text-sky-300 hover:underline">
                    Показати всі ({profile.appearances.items.length})
                  </button>
                )}
              </>
            ) : (
              <p className="text-[11px] text-slate-500">Героя ще не позначено в тексті тегом.</p>
            )}
          </Section>
        </>
      )}
    </div>
  );
};

export default CharacterProfilePage;
