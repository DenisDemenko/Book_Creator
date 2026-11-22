import React, { useEffect, useState } from 'react';
import { Cloud, Loader2, Lock, MoveRight } from 'lucide-react';
import { PrivateBookBadge } from './PrivateBookBadge';
import { usablePrivateStores, type PrivateStoreInfo } from '../utils/privateStore';

/**
 * Де лежить матеріал і як його перенести (журнал #598, запит власника 22.11.2026: «зроби обидва шляхи однаковими для курсів,
 * інструкцій та книг»). Один і той самий елемент над редактором книги, курсу й інструкції:
 *  - приватний матеріал — смуга «лише на локальному сервері» + «Перенести в хмару»;
 *  - хмарний — «зберігається в хмарі» + «Перенести на локальний сервер» (лише коли є сервер, що приймає цей вид і доступний
 *    з цього браузера; інакше смуги немає зовсім, щоб не заважати тим, у кого приватного сервера немає).
 * Саме перенесення робить викликач (onMoveToPrivate / onMoveToCloud): у книги, курсу й інструкції різні сховища.
 */
type Kind = 'book' | 'course' | 'instruction';

const NOUN: Record<Kind, { acc: string; title: string }> = {
  book: { acc: 'книгу', title: 'Книга' },
  course: { acc: 'курс', title: 'Курс' },
  instruction: { acc: 'інструкцію', title: 'Інструкція' },
};

export const moveToPrivateQuestion = (kind: Kind, storeName: string) =>
  `Перенести ${NOUN[kind].acc} на локальний сервер «${storeName}»?\n\n` +
  `• Копію в хмарі Studio буде видалено — далі ${NOUN[kind].acc} зберігатиметься лише на вашому сервері.\n` +
  `• Для неї вимкнуться ШІ, PDF-експорт, медіатека, публікація й співавтори.\n` +
  `• Зображення, вставлені з хмарної медіатеки, лишаться посиланнями на хмару — замініть їх, якщо вони теж конфіденційні.`;

export const moveToCloudQuestion = (kind: Kind) =>
  `Перенести ${NOUN[kind].acc} з локального сервера в хмару Studio?\n\n` +
  `• Увесь вміст буде передано в хмару, а копію на локальному сервері — видалено.\n` +
  `• Знову стануть доступні ШІ, PDF-експорт, медіатека й публікація.\n` +
  `• Не робіть цього для матеріалів суворої конфіденційності.`;

export function StorageMoveBar({
  kind,
  privateStoreId,
  docId,
  cloudLabel = 'зберігається в хмарі Studio',
  onMoveToPrivate,
  onMoveToCloud,
}: {
  kind: Kind;
  privateStoreId?: string | null;
  docId: string;
  /** Для інструкцій «хмарний» шлях — чернетка в цьому браузері: так і пишемо. */
  cloudLabel?: string;
  onMoveToPrivate: (store: PrivateStoreInfo) => Promise<void>;
  onMoveToCloud: () => Promise<void>;
}) {
  const [stores, setStores] = useState<PrivateStoreInfo[]>([]);
  const [storeId, setStoreId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (privateStoreId) return;
    let cancelled = false;
    void usablePrivateStores(kind)
      .then((list) => {
        if (cancelled) return;
        const ok = list.filter((s) => s.reachable);
        setStores(ok);
        setStoreId((prev) => (ok.some((s) => s.id === prev) ? prev : ok[0]?.id ?? ''));
      })
      .catch(() => !cancelled && setStores([]));
    return () => {
      cancelled = true;
    };
  }, [kind, privateStoreId]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося перенести.');
    } finally {
      setBusy(false);
    }
  };

  const errorLine = error && (
    <span role="alert" className="basis-full text-rose-300" data-storage-move-error>
      {error}
    </span>
  );

  if (privateStoreId) {
    return (
      <PrivateBookBadge
        storeId={privateStoreId}
        docId={docId}
        kind={kind}
        action={
          <>
            <button
              type="button"
              disabled={busy}
              data-move-to-cloud
              onClick={() => window.confirm(moveToCloudQuestion(kind)) && void run(onMoveToCloud)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-600 bg-slate-800 text-slate-200 font-semibold hover:bg-slate-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />} Перенести в хмару
            </button>
            {errorLine}
          </>
        }
      />
    );
  }

  if (!stores.length) return null;
  const chosen = stores.find((s) => s.id === storeId) ?? stores[0];
  return (
    <div data-storage-bar={kind} className="w-full bg-slate-900/90 border-b border-sky-500/20 px-4 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" role="status">
      <span className="flex items-center gap-1.5 font-semibold text-sky-300">
        <Cloud className="w-3.5 h-3.5" /> {NOUN[kind].title} {cloudLabel}
      </span>
      <span className="text-slate-400">Для суворої конфіденційності можна тримати лише на вашому сервері.</span>
      <span className="ml-auto flex items-center gap-1.5">
        {stores.length > 1 && (
          <select value={chosen.id} onChange={(e) => setStoreId(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200">
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          disabled={busy}
          data-move-to-private
          onClick={() => window.confirm(moveToPrivateQuestion(kind, chosen.name)) && void run(() => onMoveToPrivate(chosen))}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 font-semibold hover:bg-emerald-500/20 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
          На локальний сервер{stores.length === 1 ? ` «${chosen.name}»` : ''} <MoveRight className="w-3 h-3" />
        </button>
      </span>
      {errorLine}
    </div>
  );
}
