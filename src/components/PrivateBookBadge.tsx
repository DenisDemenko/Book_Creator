import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { fetchMyPrivateStores, onPrivateSync, type PrivateSyncEvent } from '../utils/privateStore';

/**
 * Смуга над редактором приватної книги (журнал #549): де зберігається матеріал і чи пишеться він на локальний сервер.
 * ШІ, PDF-експорт, медіатека й публікація для такої книги вимкнені охоронцем у utils/privateStore.ts.
 */
export function PrivateBookBadge({ storeId, docId, kind = 'book' }: { storeId: string; docId: string; kind?: 'book' | 'course' | 'instruction' }) {
  const [name, setName] = useState<string>('');
  const [last, setLast] = useState<PrivateSyncEvent | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchMyPrivateStores().then((stores) => {
      const hit = stores.find((s) => s.id === storeId);
      if (!cancelled) setName(hit?.name ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => onPrivateSync((ev) => ev.storeId === storeId && ev.id === docId && setLast(ev)), [storeId, docId]);

  const tone = last?.status === 'synced' ? 'text-emerald-300' : last ? 'text-amber-300' : 'text-slate-400';
  const status =
    last?.status === 'synced'
      ? `збережено на сервері о ${new Date(last.at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`
      : last?.status === 'offline'
        ? kind === 'book'
          ? 'сервер недоступний: зміни є в цьому браузері й підуть на сервер, щойно він з’явиться'
          : kind === 'instruction'
            ? 'сервер недоступний: зміни є лише в цьому вікні й підуть на сервер самі, щойно він з’явиться — не закривайте вкладку'
            : 'сервер недоступний: зміни є лише в цьому вікні — натисніть «Зберегти», щойно сервер повернеться, і не закривайте вкладку'
        : last?.status === 'conflict'
          ? 'матеріал змінено з іншого місця — перевірте версію'
          : last?.status === 'error'
            ? last.message || 'не вдалося зберегти на сервері'
            : 'очікує першого збереження';
  const noun = kind === 'course' ? 'Приватний курс' : kind === 'instruction' ? 'Приватна інструкція' : 'Приватна книга';

  return (
    <div data-private-badge className="w-full bg-slate-900/90 border-b border-emerald-500/20 px-4 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" role="status">
      <span className="flex items-center gap-1.5 font-semibold text-emerald-300">
        <Lock className="w-3.5 h-3.5" /> {noun}
      </span>
      <span className="text-slate-300">зберігається лише на локальному сервері{name ? ` «${name}»` : ''}; у хмару не потрапляє. ШІ, PDF-експорт, медіатека й публікація недоступні.</span>
      <span className={`ml-auto ${tone}`} data-private-sync={last?.status ?? 'idle'}>{status}</span>
    </div>
  );
}
