import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Loader2, Lock, RefreshCw, Trash2 } from 'lucide-react';
import {
  PrivateStoreError,
  deletePrivateDoc,
  fetchMyPrivateStores,
  listPrivateDocs,
  probePrivateStore,
  type PrivateDocSummary,
  type PrivateKind,
  type PrivateStoreInfo,
} from '../utils/privateStore';

/**
 * «Приватні матеріали» на дашборді (журнал #549): книги, курси й інструкції, що лежать на локальному сервері автора.
 * Перелік читає ПРЯМО з сервера (Studio вмісту не знає): сервер вимкнений — матеріали недоступні, і про це сказано прямо.
 * Нічого не копіюється в хмару, тож «резервну копію» тримає сам автор (том Docker і файл ключа).
 */

const KIND_TITLE: Record<PrivateKind, string> = { book: 'Книга', course: 'Курс', instruction: 'Інструкція' };

interface StoreState {
  store: PrivateStoreInfo;
  docs: PrivateDocSummary[];
  reachable: boolean;
  error: string | null;
}

export function PrivateMaterialsSection({
  userId,
  onOpen,
  refreshKey = 0,
}: {
  userId: string | null;
  /** Відкрити матеріал: для книги — завантажити й показати в редакторі; для курсу й інструкції — у відповідних розділах. */
  onOpen: (store: PrivateStoreInfo, doc: PrivateDocSummary) => Promise<void>;
  refreshKey?: number;
}) {
  const [states, setStates] = useState<StoreState[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setStates([]);
      return;
    }
    setLoading(true);
    try {
      const stores = (await fetchMyPrivateStores());
      const next: StoreState[] = await Promise.all(
        stores.map(async (store) => {
          const reachable = await probePrivateStore(store.endpoint);
          if (!reachable) return { store, docs: [], reachable, error: null };
          try {
            return { store, docs: await listPrivateDocs(store.id), reachable, error: null };
          } catch (err) {
            return { store, docs: [], reachable, error: (err as Error).message };
          }
        })
      );
      setStates(next);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!states || states.length === 0) return null;

  const open = async (store: PrivateStoreInfo, doc: PrivateDocSummary) => {
    setBusy(doc.id);
    setError(null);
    try {
      await onOpen(store, doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося відкрити матеріал.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (store: PrivateStoreInfo, doc: PrivateDocSummary) => {
    if (!window.confirm(`Видалити «${doc.meta.title || doc.id}» з локального сервера «${store.name}»? Копій у хмарі немає — відновити буде неможливо.`)) return;
    setBusy(doc.id);
    setError(null);
    try {
      await deletePrivateDoc(store.id, doc.id);
      await load();
    } catch (err) {
      setError(err instanceof PrivateStoreError ? err.message : 'Не вдалося видалити.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section data-private-materials className="nova-glass-dark rounded-2xl p-5 border border-emerald-500/30">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="w-5 h-5 text-emerald-300" />
        <h2 className="text-base font-bold text-slate-100">Приватні матеріали</h2>
        <button type="button" onClick={() => void load()} className="ml-auto p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400" title="Оновити">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-3">Лежать лише на вашому локальному сервері й не потрапляють у хмару.</p>
      {states.map(({ store, docs, reachable, error: storeError }) => (
        <div key={store.id} className="mb-3 last:mb-0" data-private-store-block={store.id}>
          <div className="text-xs text-slate-300 flex items-center gap-2 mb-1.5">
            <span className="font-semibold">{store.name}</span>
            <span className={reachable ? 'text-emerald-300' : 'text-amber-300'}>{reachable ? 'доступний' : 'недоступний'}</span>
          </div>
          {!reachable && (
            <p className="text-xs text-amber-200 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5" data-private-unreachable>
              Сервер зараз недоступний із цього браузера: матеріали на ньому не відкрити, поки він не повернеться (запустіть контейнер: <code>docker compose up -d</code>). Нічого не копіюється в хмару.
            </p>
          )}
          {storeError && <p className="text-xs text-rose-300">{storeError}</p>}
          {reachable && !storeError && docs.length === 0 && <p className="text-xs text-slate-500">Поки порожньо. Створіть матеріал із галочкою «Приватне збереження на локальному сервері».</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {docs.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/70 p-3 bg-slate-900/50" data-private-doc={doc.id}>
                <button type="button" onClick={() => void open(store, doc)} disabled={busy !== null} className="min-w-0 text-left flex-1 disabled:opacity-50">
                  <span className="block font-semibold text-sm text-slate-100 truncate">{doc.meta.title || doc.id}</span>
                  <span className="block text-xs text-slate-500 truncate">
                    {KIND_TITLE[doc.kind]} · {new Date(doc.updatedAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </button>
                {busy === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4 shrink-0 text-emerald-300" />}
                <button type="button" onClick={() => void remove(store, doc)} disabled={busy !== null} className="p-1.5 rounded-lg hover:bg-rose-900/40 text-slate-500 hover:text-rose-300" title="Видалити з локального сервера">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
    </section>
  );
}
