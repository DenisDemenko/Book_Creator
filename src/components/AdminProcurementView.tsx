import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  History,
  Info,
  Pencil,
  Percent,
  Plus,
  RefreshCw,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
import {
  blankProcurementRecord,
  procurementIssues,
  procurementSavingsPercent,
  procurementTotalSavingsUah,
  PROCUREMENT_MATERIAL_KIND_HINTS,
  PROCUREMENT_UNIT_HINTS,
  type ProcurementRecord,
} from './adminOs/procurement';
import { ApplyDiscountModal } from './procurement/ApplyDiscountModal';

/**
 * «Закупівлі» — реальна економіка, з якої виводяться знижки на товарах.
 *
 * Власник попросив: знижки не мають будуватись на фантазіях, а мають
 * виходити зі справжньої закупівлі дешевшого матеріалу (деревина, епоксидка
 * тощо). Тут заводять запис такої закупівлі (стара/нова ціна, постачальник,
 * звідки взялась дешевша ціна), а звідси ж вручну застосовують знижку від
 * запису до обраних карток товарів — через `ApplyDiscountModal`, той самий
 * принцип «вручну вибираємо товар», що й у калькуляторі собівартості
 * (`ApplyToProductModal`).
 *
 * ПОШУК АЛЬТЕРНАТИВНИХ ПОСТАЧАЛЬНИКІВ. Живої інтеграції з пошуковим API тут
 * немає — власник обрав «дослідження на запит»: асистент шукає дешевші
 * джерела постачання у звичайній розмові, а результат (ціна, постачальник,
 * посилання) власник заносить у форму нижче полем «Звідки дешевша ціна».
 */

const money = (uah: number) => `${uah.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ₴`;

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

interface FormState {
  record: ProcurementRecord;
  isNew: boolean;
}

export const AdminProcurementView: React.FC = () => {
  const [records, setRecords] = useState<ProcurementRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [applyingFor, setApplyingFor] = useState<ProcurementRecord | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/procurement', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося прочитати перелік закупівель.');
      setRecords(Array.isArray(data.records) ? data.records : []);
    } catch (err: any) {
      setRecords(null);
      setError(err?.message || 'Помилка читання переліку закупівель.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => setForm({ record: blankProcurementRecord(), isNew: true });
  const openEdit = (r: ProcurementRecord) => setForm({ record: { ...r }, isNew: false });

  const save = async () => {
    if (!form) return;
    const issues = procurementIssues(form.record);
    if (issues.length) {
      setError(issues.join(' '));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/procurement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ record: form.record }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося зберегти запис закупівлі.');
      setNotice(form.isNew ? 'Закупівлю додано.' : 'Закупівлю збережено.');
      setForm(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Помилка збереження.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/procurement/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося видалити запис.');
      setNotice('Запис закупівлі видалено.');
      setConfirmingDelete(null);
      setRecords((list) => (list ? list.filter((r) => r.id !== id) : list));
    } catch (err: any) {
      setError(err?.message || 'Помилка видалення.');
    } finally {
      setBusy(false);
    }
  };

  const updateField = <K extends keyof ProcurementRecord>(key: K, value: ProcurementRecord[K]) => {
    setForm((f) => (f ? { ...f, record: { ...f.record, [key]: value } } : f));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-slate-800 text-slate-300 shrink-0">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">Закупівлі</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Реальна економія на матеріалі → знижка на товарі, простежувана до конкретної закупівлі.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={openNew}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Додати закупівлю
            </button>
            <button
              onClick={() => void load()}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              Оновити
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-950/50 border border-slate-800 p-3">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-slate-400">
            Альтернативних постачальників шукає асистент у звичайній розмові (окремої пошукової інтеграції
            тут немає) — знайдену ціну й джерело заносьте в поле <b className="text-slate-300">«Звідки дешевша ціна»</b>.
            Знижку на товар застосовують кнопкою <b className="text-slate-300">«Застосувати знижку»</b> —
            власник щоразу вручну обирає, на які картки її поширити.
          </p>
        </div>

        {error && (
          <div className="mt-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2" role="alert">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2" role="status">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
      </div>

      {form && (
        <div className="rounded-2xl bg-slate-900/60 border border-cyan-500/30 p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              {form.isNew ? 'Нова закупівля' : 'Редагування закупівлі'}
            </h4>
            <button
              onClick={() => setForm(null)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200"
              aria-label="Закрити форму"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-[11px] text-slate-400 space-y-1">
              <span>Матеріал</span>
              <input
                list="procurement-material-hints"
                value={form.record.material}
                onChange={(e) => updateField('material', e.target.value)}
                placeholder="напр. Дуб масив"
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              />
              <datalist id="procurement-material-hints">
                {PROCUREMENT_MATERIAL_KIND_HINTS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>

            <label className="text-[11px] text-slate-400 space-y-1">
              <span>Постачальник</span>
              <input
                value={form.record.supplier}
                onChange={(e) => updateField('supplier', e.target.value)}
                placeholder="назва / контакт"
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              />
            </label>

            <label className="text-[11px] text-slate-400 space-y-1">
              <span>Стара ціна за одиницю, ₴</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.record.oldPricePerUnitUah || ''}
                onChange={(e) => updateField('oldPricePerUnitUah', Number(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              />
            </label>

            <label className="text-[11px] text-slate-400 space-y-1">
              <span>Нова (дешевша) ціна за одиницю, ₴</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.record.newPricePerUnitUah || ''}
                onChange={(e) => updateField('newPricePerUnitUah', Number(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              />
            </label>

            <label className="text-[11px] text-slate-400 space-y-1">
              <span>Одиниця</span>
              <input
                list="procurement-unit-hints"
                value={form.record.unit}
                onChange={(e) => updateField('unit', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              />
              <datalist id="procurement-unit-hints">
                {PROCUREMENT_UNIT_HINTS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </label>

            <label className="text-[11px] text-slate-400 space-y-1">
              <span>Кількість закуплено (необов'язково)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.record.quantity || ''}
                onChange={(e) => updateField('quantity', Number(e.target.value) || 0)}
                placeholder="для підрахунку загальної суми економії"
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              />
            </label>

            <label className="text-[11px] text-slate-400 space-y-1">
              <span>Дата закупівлі</span>
              <input
                type="date"
                value={form.record.purchaseDate}
                onChange={(e) => updateField('purchaseDate', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              />
            </label>

            <label className="text-[11px] text-slate-400 space-y-1">
              <span>Звідки дешевша ціна (посилання / опис)</span>
              <input
                value={form.record.sourceNote}
                onChange={(e) => updateField('sourceNote', e.target.value)}
                placeholder="напр. https://... або «прямо з пилорами в Ірпені»"
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              />
            </label>

            <label className="text-[11px] text-slate-400 space-y-1 sm:col-span-2">
              <span>Нотатка (необов'язково)</span>
              <textarea
                value={form.record.note}
                onChange={(e) => updateField('note', e.target.value)}
                rows={2}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 resize-y"
              />
            </label>
          </div>

          {form.record.oldPricePerUnitUah > 0 && form.record.newPricePerUnitUah > 0 && (
            <div className="mt-3 flex items-center gap-2 text-[11px]">
              <Percent className="w-3.5 h-3.5 text-emerald-400" />
              <span
                className={
                  form.record.newPricePerUnitUah < form.record.oldPricePerUnitUah
                    ? 'text-emerald-300 font-semibold'
                    : 'text-rose-300 font-semibold'
                }
              >
                Економія: {procurementSavingsPercent(form.record)}%
              </span>
              {form.record.quantity > 0 && procurementTotalSavingsUah(form.record) !== undefined && (
                <span className="text-slate-400">
                  · разом {money(procurementTotalSavingsUah(form.record) as number)} на партію
                </span>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => setForm(null)}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
            >
              Скасувати
            </button>
            <button
              onClick={() => void save()}
              disabled={busy}
              className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold disabled:opacity-50"
            >
              {busy ? 'Зберігаю…' : 'Зберегти'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Записи закупівель</h4>
          <span className="text-[10px] text-slate-500">{records?.length ?? 0} шт.</span>
        </div>

        {records === null && !error && <p className="text-xs text-slate-500">Завантаження…</p>}
        {records?.length === 0 && (
          <p className="text-xs text-slate-500">
            Закупівель ще немає. Натисніть «Додати закупівлю», коли знайдете дешевший матеріал.
          </p>
        )}

        {records && records.length > 0 && (
          <div className="space-y-2">
            {records.map((r) => {
              const savingsPercent = procurementSavingsPercent(r);
              const totalSavings = procurementTotalSavingsUah(r);
              const canApply = r.newPricePerUnitUah > 0 && r.newPricePerUnitUah < r.oldPricePerUnitUah;
              const waiting = confirmingDelete === r.id;
              return (
                <div key={r.id} className="rounded-xl bg-slate-950/50 border border-slate-800 p-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[180px]">
                      <p className="text-xs font-semibold text-slate-200 truncate">
                        {r.material || 'Без назви матеріалу'}
                      </p>
                      <p className="text-[10px] text-slate-500 truncate">
                        {r.supplier || 'постачальник не вказаний'} · {r.purchaseDate}
                      </p>
                    </div>
                    <span className="text-[11px] tabular-nums text-slate-400 shrink-0">
                      {money(r.oldPricePerUnitUah)} → {money(r.newPricePerUnitUah)} / {r.unit}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 font-semibold ${
                        canApply
                          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                          : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                      }`}
                    >
                      {savingsPercent}% економії
                    </span>
                    {totalSavings !== undefined && (
                      <span className="text-[10px] text-slate-500 shrink-0">разом {money(totalSavings)}</span>
                    )}
                    {r.appliedTo.length > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-cyan-300 shrink-0" title="Скільки разів застосовано">
                        <History className="w-3 h-3" /> {r.appliedTo.length}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setApplyingFor(r)}
                        disabled={!canApply}
                        title={canApply ? 'Застосувати знижку до товару(ів)' : 'Нова ціна не дешевша за стару'}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Banknote className="w-3.5 h-3.5" /> Знижка
                      </button>
                      <button
                        onClick={() => openEdit(r)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Редагувати
                      </button>
                      {waiting ? (
                        <>
                          <button
                            onClick={() => void remove(r.id)}
                            disabled={busy}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold disabled:opacity-50"
                          >
                            Підтвердити
                          </button>
                          <button
                            onClick={() => setConfirmingDelete(null)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                          >
                            Скасувати
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmingDelete(r.id)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-slate-400 hover:text-rose-300"
                          title="Видалити запис"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {(r.sourceNote || r.note) && (
                    <div className="mt-2 pl-0.5 text-[10px] text-slate-500 space-y-0.5">
                      {r.sourceNote && (
                        <p>
                          Джерело:{' '}
                          {isUrl(r.sourceNote) ? (
                            <a
                              href={r.sourceNote}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cyan-400 hover:text-cyan-300 underline"
                            >
                              {r.sourceNote}
                            </a>
                          ) : (
                            <span className="text-slate-400">{r.sourceNote}</span>
                          )}
                        </p>
                      )}
                      {r.note && <p className="text-slate-400">{r.note}</p>}
                    </div>
                  )}

                  {r.appliedTo.length > 0 && (
                    <div className="mt-2 pl-0.5 flex flex-wrap gap-1.5">
                      {r.appliedTo.map((a, i) => (
                        <span
                          key={`${a.productId}-${i}`}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400"
                          title={`${a.appliedAt}: ${money(a.priceBeforeUah)} → ${money(a.priceAfterUah)}`}
                        >
                          {a.productName} · −{a.discountPercentApplied}%
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ApplyDiscountModal
        record={applyingFor}
        onClose={() => setApplyingFor(null)}
        onApplied={(updated, message) => {
          setRecords((list) => (list ? list.map((r) => (r.id === updated.id ? updated : r)) : list));
          setNotice(message);
          setApplyingFor(null);
        }}
      />
    </div>
  );
};

export default AdminProcurementView;
