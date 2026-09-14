import React, { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, RefreshCw } from 'lucide-react';

/**
 * «Модерація» — окремий розділ адмінпанелі.
 *
 * ДОТИ ця черга жила всередині вкладки «Міст до вітрини»: адміністратор
 * відкривав розділ про адресу й ключ API, а знаходив там ще й список курсів,
 * що чекають рішення. Це різні дії: міст — налаштування зʼєднання, модерація —
 * рішення про конкретний товар. Тепер у неї власна сторінка.
 *
 * Логіка, маршрути й вигляд рядків ПЕРЕНЕСЕНІ як були — змінився лише спосіб
 * відкриття (окремий вузол карти замість блоку під мостом), щоб уже перевірене
 * погодження курсів не довелося перевіряти вдруге.
 */

type ModerationRow = {
  id: string;
  itemType: 'book' | 'course' | 'instruction' | 'game';
  itemId: string;
  title: string;
  authorId: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  createdAt: string;
  decidedAt?: string;
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  book: 'Книга',
  course: 'Курс',
  instruction: 'Інструкція',
  game: 'Інтерактивна гра',
};

export const AdminModerationView: React.FC = () => {
  const [rows, setRows] = useState<ModerationRow[] | null>(null);
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | ''>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setMessage(null);
    try {
      const query = status ? `?status=${status}` : '';
      const res = await fetch(`/api/admin/moderation${query}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Не вдалося прочитати чергу модерації.');
      const data = await res.json();
      setRows(data.moderation ?? []);
    } catch (err: any) {
      setMessage({ tone: 'err', text: err?.message || 'Помилка завантаження.' });
      setRows([]);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusyId(id);
    setMessage(null);
    try {
      const reason = decision === 'reject' ? (window.prompt('Причина відхилення:')?.trim() || '') : '';
      if (decision === 'reject' && !reason) {
        setMessage({ tone: 'err', text: 'Потрібна причина відхилення.' });
        return;
      }
      const res = await fetch(`/api/admin/moderation/${id}/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(decision === 'reject' ? { reason } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Не вдалося (HTTP ${res.status}).`);
      setMessage({ tone: 'ok', text: decision === 'approve' ? 'Погоджено — лістинг опубліковано.' : 'Відхилено.' });
      void load();
    } catch (err: any) {
      setMessage({ tone: 'err', text: err?.message || 'Помилка.' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-100">Модерація</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Погодження публікацій у вітрину: книги, курси, інструкції, інтерактивні ігри.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {(['pending', 'approved', 'rejected', ''] as const).map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setStatus(s)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                status === s ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {s === 'pending' ? 'Очікує' : s === 'approved' ? 'Погоджено' : s === 'rejected' ? 'Відхилено' : 'Усі'}
            </button>
          ))}
          <button onClick={() => void load()} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400" title="Оновити">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {message && (
        <div className={`mt-3 p-2.5 rounded-xl text-xs ${message.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'}`}>
          {message.text}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {rows === null ? (
          <p className="text-xs text-slate-500">Завантаження…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-500">Черга порожня.</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="flex items-center gap-3 rounded-xl bg-slate-950/50 border border-slate-800 p-3">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 bg-slate-800 text-slate-300 border-slate-700">
                {ITEM_TYPE_LABELS[row.itemType] ?? row.itemType}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-200 truncate">{row.title}</p>
                <p className="text-[10px] text-slate-500 font-mono truncate">{row.itemId}</p>
              </div>
              {row.status === 'rejected' && row.reason && (
                <p className="text-[10px] text-rose-300 max-w-[180px] truncate" title={row.reason}>Причина: {row.reason}</p>
              )}
              {row.status === 'pending' && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => void decide(row.id, 'approve')}
                    disabled={busyId === row.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Погодити
                  </button>
                  <button
                    onClick={() => void decide(row.id, 'reject')}
                    disabled={busyId === row.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 text-[11px] font-semibold disabled:opacity-50"
                  >
                    <Ban className="w-3.5 h-3.5" /> Відхилити
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
