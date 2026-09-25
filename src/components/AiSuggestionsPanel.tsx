/**
 * Пропозиції AI-1 для розділу (Т1.1): кнопка «Знайти згадки», список
 * запропонованих тегів і зв'язків, «Підтвердити» / «Відхилити».
 *
 * Рішення П3: підтверджена згадка ОДРАЗУ стає тегом у рукописі — у тому
 * абзаці, на який вказує доказ, і лише в ньому. Сам тег ставить редактор
 * (`onInsertTag` з EditorView): рукопис змінюється тільки в браузері (К2), а
 * далі — звичайне збереження й синхронізація з ядром (Т0.6). Без
 * підтвердження текст не змінюється; відхилене не пропонується вдруге.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Sparkles, X, Link2 } from 'lucide-react';

export interface AiSuggestion {
  id: string;
  kind: 'mention_suggestion' | 'relation_suggestion';
  entityType?: string;
  entityName?: string;
  tag?: string;
  subjectName?: string;
  relationType?: string;
  targetEntityName?: string;
  quote?: string;
  confidence?: number;
  paragraphId: string | null;
  sectionId: string | null;
  editorPid: string | null;
  paragraphExcerpt: string | null;
}

interface Props {
  bookId: string;
  sectionId: string | undefined;
  /**
   * Перевірка до підтвердження: чи можна поставити тег у цей абзац (абзац є в
   * канві, не перевищено 12 тегів). Рядок — причина відмови.
   */
  canInsertTag: (editorPid: string, tag: string) => true | string;
  /** Поставити тег на початку абзацу з цим номером. */
  onInsertTag: (editorPid: string, tag: string) => boolean;
}

const api = (url: string, init?: RequestInit) =>
  fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });

export const AiSuggestionsPanel: React.FC<Props> = ({ bookId, sectionId, canInsertTag, onInsertTag }) => {
  const [items, setItems] = useState<AiSuggestion[]>([]);
  const [job, setJob] = useState<{ id: string; status: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const base = `/api/projects/${encodeURIComponent(bookId)}`;

  const load = useCallback(async () => {
    if (!sectionId) return;
    const res = await api(`${base}/suggestions?sectionId=${encodeURIComponent(sectionId)}`).catch(() => null);
    if (!res) return;
    if (res.ok) {
      const body = await res.json();
      setItems(body.suggestions || []);
    } else if (res.status === 503) {
      setMessage('Семантичне ядро зараз недоступне.');
    }
  }, [base, sectionId]);

  useEffect(() => {
    setItems([]);
    setMessage(null);
    setJob(null);
    void load();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [load]);

  const poll = useCallback(
    (jobId: string) => {
      pollRef.current = setTimeout(async () => {
        const res = await api(`${base}/jobs/${jobId}`).catch(() => null);
        const body = res?.ok ? await res.json() : null;
        if (!body) {
          setJob(null);
          return;
        }
        if (body.status === 'queued' || body.status === 'running') {
          setJob({ id: jobId, status: body.status });
          poll(jobId);
          return;
        }
        setJob(null);
        if (body.status === 'succeeded') {
          const n = (body.result?.suggestions ?? 0) + (body.result?.relations ?? 0);
          setMessage(n ? `Нових пропозицій: ${n}` : 'Нових пропозицій немає — усе, що знайшлось, уже позначено або відхилено.');
          await load();
        } else {
          setMessage(body.error || 'Аналіз не вдався.');
        }
      }, 1500);
    },
    [base, load]
  );

  const run = async () => {
    if (!sectionId) return;
    setMessage(null);
    const res = await api(`${base}/ai/mentions`, { method: 'POST', body: JSON.stringify({ sectionId }) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setMessage(body.error || 'Не вдалося запустити аналіз.');
      return;
    }
    setJob({ id: body.jobId, status: 'queued' });
    poll(body.jobId);
  };

  const decide = async (s: AiSuggestion, action: 'confirm' | 'reject') => {
    if (action === 'confirm' && s.kind === 'mention_suggestion') {
      const check = canInsertTag(s.editorPid || '', s.tag || '');
      if (check !== true) {
        setMessage(check);
        return;
      }
    }
    setBusyId(s.id);
    try {
      const res = await api(`${base}/suggestions/${s.id}/${action}`, { method: 'POST', body: '{}' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || 'Не вдалося.');
        if (res.status === 409) setItems((prev) => prev.filter((x) => x.id !== s.id));
        return;
      }
      if (action === 'confirm' && body.kind === 'mention_suggestion') {
        if (!onInsertTag(body.editorPid, body.tag)) setMessage('Абзацу з цією пропозицією немає в канві — тег не поставлено.');
      }
      setItems((prev) => prev.filter((x) => x.id !== s.id));
    } finally {
      setBusyId(null);
    }
  };

  const running = !!job;
  return (
    <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/50 p-3" data-ai-suggestions>
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-violet-300" />
        <span className="flex-1 text-[11px] font-bold text-slate-200">Пропозиції ШІ (AI-1)</span>
        <button
          type="button"
          onClick={run}
          disabled={!sectionId || running}
          data-ai-suggestions-run
          className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[11px] font-bold text-violet-200 hover:bg-violet-500/20 disabled:opacity-50"
          title="ШІ прочитає абзаци розділу й запропонує теги сутностей, яких ще немає. Нічого не змінюється без вашого підтвердження."
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {running ? 'Аналіз…' : 'Знайти згадки'}
        </button>
      </div>
      {message && <p className="text-[11px] text-slate-400" data-ai-suggestions-message>{message}</p>}
      {items.length === 0 && !running && !message && (
        <p className="text-[11px] text-slate-500">Пропозицій для цього розділу немає.</p>
      )}
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5" data-ai-suggestion={s.id}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {s.kind === 'relation_suggestion' ? (
                  <div className="flex items-center gap-1 text-[11px] font-bold text-sky-200">
                    <Link2 className="h-3 w-3" /> {s.entityName} → <span className="font-mono">/{s.relationType}</span> → {s.targetEntityName}
                  </div>
                ) : (
                  <code className="text-[11px] font-bold text-violet-200">{s.tag}</code>
                )}
                {s.quote && <p className="mt-1 text-[11px] italic text-slate-300">«{s.quote}»</p>}
                {s.paragraphExcerpt && <p className="mt-1 line-clamp-2 text-[10px] text-slate-500">{s.paragraphExcerpt}</p>}
                {typeof s.confidence === 'number' && (
                  <p className="mt-0.5 text-[10px] text-slate-500">впевненість {Math.round(s.confidence * 100)}%</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => decide(s, 'confirm')}
                  data-ai-suggestion-confirm
                  className="rounded-md border border-emerald-500/40 p-1 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                  title={s.kind === 'relation_suggestion' ? 'Підтвердити зв\'язок' : 'Підтвердити — тег стане в абзац'}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => decide(s, 'reject')}
                  data-ai-suggestion-reject
                  className="rounded-md border border-rose-500/40 p-1 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                  title="Відхилити — більше не пропонувати"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default AiSuggestionsPanel;
