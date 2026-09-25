/**
 * Сторінки семантичного ядра (Т0.8) — поки що «каркас»: у кожної з
 * одинадцяти сторінок ТЗ є адреса, назва, призначення й етап, на якому вона
 * оживе, і вже справжні дані ядра з API проєкту (`/api/projects/:id/*`):
 * скільки абзаців синхронізовано, які сутності знайдено в тегах, скільки
 * зв'язків і висновків AI чекають на автора.
 *
 * Профіль персонажа працює вже зараз у найпростішому вигляді: список героїв
 * книги з кількістю згадок і картка героя (псевдоніми, згадки, зв'язки,
 * висновки) — рівно те, що дають перші маршрути задачі.
 */

import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Database, Loader2, ShieldAlert, UserRound, ArrowLeft } from 'lucide-react';
import type { Book, NavigationTab } from '../types';
import { corePageByTab } from '../utils/appRoutes';
import { useLanguage } from '../i18n/LanguageContext';
import { CoreSearchPage } from './CoreSearchPage';

// Граф (Т1.4) тягне React Flow — вантажимо його лише на сторінці графа.
const StoryGraphPage = lazy(() => import('./StoryGraphPage'));

interface Props {
  tab: NavigationTab;
  book: Book;
  characterId?: string;
  onOpenCharacter: (entityId: string | undefined) => void;
  /** Перехід до абзацу в редакторі (сторінка «Пошук», Т1.3). */
  onOpenParagraph?: (target: { chapterId: string; sectionId: string; editorPid: string; text: string }) => void;
}

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; status: number; message: string };

interface Summary {
  synced: boolean;
  revision: number;
  paragraphs: number;
  entities: Record<string, number>;
  relations: number;
  findings: { suggested: number; needsReview: number };
  lastSync?: { status: string; finishedAt: string | null } | null;
}

interface EntityItem {
  id: string;
  type: string;
  name: string;
  status: string;
  mentions: number;
}

function useApi<T>(url: string | null): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' });
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoad({ state: 'loading' });
    fetch(url, { credentials: 'same-origin' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setLoad({ state: 'error', status: res.status, message: body?.error || `Помилка ${res.status}` });
        else setLoad({ state: 'ok', data: body as T });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'error', status: 0, message: 'Немає зв\'язку з сервером' });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return load;
}

function Problem({ load }: { load: Extract<Load<unknown>, { state: 'error' }> }) {
  const text =
    load.status === 401
      ? 'Увійдіть, щоб бачити дані семантичного ядра цієї книги.'
      : load.status === 403
        ? 'Немає доступу до цієї книги: дані ядра бачать лише власник і запрошені учасники.'
        : load.status === 503
          ? 'Семантичне ядро зараз недоступне. Решта Студії працює як звичайно.'
          : load.message;
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" data-core-problem={load.status}>
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

const TYPE_UK: Record<string, string> = {
  character: 'Персонажі',
  emotion: 'Емоції',
  location: 'Місця',
  event: 'Події',
  goal: 'Цілі',
  scene: 'Сцени',
};

function SummaryCard({ summary }: { summary: Summary }) {
  const types = Object.entries(summary.entities).sort((a, b) => b[1] - a[1]);
  const total = types.reduce((n, [, v]) => n + v, 0);
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5" data-core-summary>
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-200">
        <Database className="h-4 w-4 text-emerald-400" />
        Що вже є в ядрі
      </div>
      {!summary.synced ? (
        <p className="text-sm text-slate-400">
          Книгу ще не синхронізовано з ядром: це станеться автоматично після найближчого збереження.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Абзаців', summary.paragraphs],
              ['Сутностей', total],
              ['Зв\'язків', summary.relations],
              ['Висновків AI на розгляд', summary.findings.suggested],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                <div className="text-xl font-bold text-slate-100">{value}</div>
                <div className="text-[11px] text-slate-400">{label}</div>
              </div>
            ))}
          </div>
          {types.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {types.slice(0, 12).map(([type, n]) => (
                <span key={type} className="rounded-full border border-slate-700 px-2.5 py-0.5 text-[11px] text-slate-300">
                  {TYPE_UK[type] ?? `/${type}`}: {n}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-slate-500">
            Ревізія книги в ядрі: {summary.revision}
            {summary.lastSync?.finishedAt
              ? ` · остання синхронізація ${new Date(summary.lastSync.finishedAt).toLocaleString('uk-UA')}${summary.lastSync.status === 'failed' ? ' (не вдалась)' : ''}`
              : ''}
            {summary.findings.needsReview > 0 ? ` · на перегляд після правок: ${summary.findings.needsReview}` : ''}
          </p>
        </>
      )}
    </section>
  );
}

function CharacterList({ bookId, onOpen }: { bookId: string; onOpen: (id: string) => void }) {
  const load = useApi<{ entities: EntityItem[] }>(`/api/projects/${encodeURIComponent(bookId)}/entities?type=character`);
  if (load.state === 'loading') return <Loader2 className="h-5 w-5 animate-spin text-slate-500" />;
  if (load.state === 'error') return <Problem load={load} />;
  const list = load.data.entities;
  if (!list.length) {
    return <p className="text-sm text-slate-400">Героїв у ядрі ще немає: додайте їх у «Персонажах» або позначте в тексті тегом <code>[/character:Ім'я]</code>.</p>;
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-core-characters>
      {list.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => onOpen(e.id)}
            className="flex w-full items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/50 px-3.5 py-2.5 text-left hover:border-slate-600"
          >
            <UserRound className="h-4 w-4 text-sky-400" />
            <span className="flex-1 truncate text-sm text-slate-100">{e.name}</span>
            <span className="text-[11px] text-slate-400">згадок: {e.mentions}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CharacterCard({ bookId, entityId, onBack }: { bookId: string; entityId: string; onBack: () => void }) {
  const load = useApi<{
    entity: EntityItem;
    aliases: { alias: string }[];
    mentions: unknown[];
    relations: unknown[];
    findings: { id: string; kind: string; status: string; payload: { summary?: string } }[];
  }>(`/api/projects/${encodeURIComponent(bookId)}/entities/${encodeURIComponent(entityId)}`);
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Усі герої
      </button>
      {load.state === 'loading' && <Loader2 className="h-5 w-5 animate-spin text-slate-500" />}
      {load.state === 'error' && <Problem load={load} />}
      {load.state === 'ok' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5" data-core-character={load.data.entity.id}>
          <h2 className="text-lg font-bold text-slate-100">{load.data.entity.name}</h2>
          {load.data.aliases.length > 0 && (
            <p className="mt-1 text-xs text-slate-400">Також: {load.data.aliases.map((a) => a.alias).join(', ')}</p>
          )}
          <p className="mt-3 text-sm text-slate-300">
            Згадок у тексті: {load.data.mentions.length} · зв'язків: {load.data.relations.length} · висновків AI: {load.data.findings.length}
          </p>
          {load.data.findings.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {load.data.findings.slice(0, 20).map((f) => (
                <li key={f.id} className="text-xs text-slate-300">
                  <span className="text-slate-500">[{f.status}]</span> {f.payload?.summary ?? f.kind}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export const CorePageView: React.FC<Props> = ({ tab, book, characterId, onOpenCharacter, onOpenParagraph }) => {
  const { t } = useLanguage();
  const page = corePageByTab(tab);
  const summary = useApi<Summary>(`/api/projects/${encodeURIComponent(book.id)}/summary`);
  if (!page) return null;
  return (
    <div className="flex-1 space-y-5 overflow-y-auto bg-slate-900 p-4 text-slate-100 lg:p-6" data-core-page={page.segment}>
      <header className="nova-glass-dark rounded-2xl border border-slate-800 p-6">
        <div className="mb-1 flex items-center gap-2 text-emerald-400">
          <span className="font-mono text-xs font-bold uppercase tracking-widest">/{page.segment}</span>
          <span className="rounded-full border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
            етап {page.stage}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-slate-100">{t(`header.nav.${tab}`)}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">{page.purposeUk}</p>
        {tab !== 'core-search' && tab !== 'core-story-graph' && (
          <p className="mt-2 text-xs text-slate-500">
            Сторінка з'явиться повністю на етапі {page.stage} дорожньої карти. Нижче — дані семантичного ядра цієї книги, на яких вона працюватиме.
          </p>
        )}
      </header>

      {/* Сторінка 1 — «Розумний пошук» (Т1.3) — уже робоча. */}
      {tab === 'core-search' && <CoreSearchPage book={book} onOpenParagraph={(t) => onOpenParagraph?.(t)} />}

      {/* Сторінка 2 — «Граф історії» (Т1.4). */}
      {tab === 'core-story-graph' && (
        <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin text-slate-500" />}>
          <StoryGraphPage book={book} onOpenParagraph={(t) => onOpenParagraph?.(t)} />
        </Suspense>
      )}

      {summary.state === 'loading' && <Loader2 className="h-5 w-5 animate-spin text-slate-500" />}
      {summary.state === 'error' && <Problem load={summary} />}
      {summary.state === 'ok' && <SummaryCard summary={summary.data} />}

      {tab === 'core-character' && summary.state === 'ok' && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          {characterId ? (
            <CharacterCard bookId={book.id} entityId={characterId} onBack={() => onOpenCharacter(undefined)} />
          ) : (
            <CharacterList bookId={book.id} onOpen={(id) => onOpenCharacter(id)} />
          )}
        </section>
      )}
    </div>
  );
};

export default CorePageView;
