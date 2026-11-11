import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Loader2, Lock, RefreshCw, Trash2, X } from 'lucide-react';
import {
  PrivateStoreError,
  deletePrivateDoc,
  fetchMyPrivateStores,
  listPrivateDocs,
  probePrivateStore,
  type PrivateDocSummary,
  type PrivateStoreInfo,
} from '../utils/privateStore';

/**
 * Перелік приватних інструкцій у конструкторі (журнал #549): читається ПРЯМО з локального сервера автора.
 * Сервер вимкнений — інструкції недоступні, і діалог каже про це прямо (рішення власника: «недоступний, з поясненням»).
 */

interface StoreList {
  store: PrivateStoreInfo;
  docs: PrivateDocSummary[];
  reachable: boolean;
  error: string | null;
}

export function PrivateInstructionsDialog({
  onOpen,
  onClose,
}: {
  onOpen: (storeId: string, docId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [lists, setLists] = useState<StoreList[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const stores = (await fetchMyPrivateStores()).filter((st) => st.kinds.includes('instruction'));
    setLists(
      await Promise.all(
        stores.map(async (store): Promise<StoreList> => {
          const reachable = await probePrivateStore(store.endpoint);
          if (!reachable) return { store, docs: [], reachable, error: null };
          try {
            return { store, docs: await listPrivateDocs(store.id, 'instruction'), reachable, error: null };
          } catch (err) {
            return { store, docs: [], reachable, error: (err as Error).message };
          }
        })
      )
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (store: PrivateStoreInfo, doc: PrivateDocSummary) => {
    setBusy(doc.id);
    setError(null);
    try {
      await onOpen(store.id, doc.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося відкрити інструкцію.');
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
    <div data-private-instructions-dialog className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="glass-panel w-full max-w-lg rounded-2xl p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-widest text-emerald-400">
            <Lock className="h-3.5 w-3.5" /> Приватні інструкції
          </span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void load()} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors" title="Оновити">
              {lists === null ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
            <button type="button" onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors" aria-label="Закрити">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">Лежать лише на вашому локальному сервері й не потрапляють у хмару.</p>

        {lists?.map(({ store, docs, reachable, error: storeError }) => (
          <div key={store.id} className="mt-4" data-private-store-block={store.id}>
            <div className="text-xs text-slate-300 flex items-center gap-2 mb-1.5">
              <span className="font-semibold">{store.name}</span>
              <span className={reachable ? 'text-emerald-300' : 'text-amber-300'}>{reachable ? 'доступний' : 'недоступний'}</span>
            </div>
            {!reachable && (
              <p className="text-xs text-amber-200 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5" data-private-unreachable>
                Сервер зараз недоступний із цього браузера: інструкції на ньому не відкрити, поки він не повернеться (запустіть контейнер: <code>docker compose up -d</code>). Нічого не копіюється в хмару.
              </p>
            )}
            {storeError && <p className="text-xs text-rose-300">{storeError}</p>}
            {reachable && !storeError && docs.length === 0 && <p className="text-xs text-slate-500">Приватних інструкцій поки немає.</p>}
            <div className="grid gap-2">
              {docs.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/70 p-3 bg-slate-900/50" data-private-doc={doc.id}>
                  <button type="button" onClick={() => void open(store, doc)} disabled={busy !== null} className="min-w-0 text-left flex-1 disabled:opacity-50">
                    <span className="block font-semibold text-sm text-slate-100 truncate">{doc.meta.title || doc.id}</span>
                    <span className="block text-xs text-slate-500 truncate">
                      {Number(doc.meta.steps ?? 0)} кроків · {new Date(doc.updatedAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}
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
        {lists !== null && lists.length === 0 && <p className="mt-4 text-xs text-slate-500">Для вас не підключено локального сервера для інструкцій. Його підключає адміністратор.</p>}
        {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
      </div>
    </div>
  );
}
