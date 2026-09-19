/**
 * Вкладка адмінки «Борд витрат» (задача #211).
 *
 * Збирає ВСІ щомісячні накладні витрати бізнесу в одному місці — ШІ
 * (автоматично з usage_log, та сама цифра, що й на вкладці «Витрати на
 * API»), Railway (вручну, бо Railway не віддає грошовий біллінг через
 * публічне API — лише розмір тому/диску) та довільні інші статті — і
 * розподіляє їх суму на собівартість одиниці товару пропорційно кількості
 * проданого за місяць у трьох лінійках бізнесу (матеріальні товари/меблі,
 * книги, тренінги).
 *
 * Розрахована ставка «накладні на одиницю» автоматично підхоплюється
 * калькулятором меблів (FurnitureCalculatorPanel → ExpenseBoardOverheadSection)
 * — той самий GET-ендпоінт, той самий период (поточний місяць).
 *
 * «Факт» кількості проданого для ПОТОЧНОГО місяця розблоковується лише з
 * 15-го числа (сервер це й перевіряє, тут — лише відображення причини
 * блокування); для минулих місяців коригування дозволене завжди.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Wallet,
  Server,
  Cpu,
  Plus,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Info,
  Settings2,
  Package,
  BookOpen,
  GraduationCap,
} from 'lucide-react';

type ExpenseKind = 'railway' | 'other';
type ProductCategory = 'goods' | 'books' | 'trainings';

interface ExpenseLineItem {
  id: string;
  kind: ExpenseKind;
  label: string;
  amountUsd: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface SalesMixEntry {
  plannedUnits: number;
  actualUnits: number | null;
  updatedAt: string;
}

interface BreakdownRow {
  category: ProductCategory;
  labelUk: string;
  units: number;
  sharePercent: number;
  allocatedCostUsd: number;
  costPerUnitUsd: number;
}

interface BoardSummary {
  period: string;
  aiCostUsd: number;
  railwayCostUsd: number;
  otherCostUsd: number;
  totalExpensesUsd: number;
  expenses: ExpenseLineItem[];
  salesMix: Record<ProductCategory, SalesMixEntry>;
  totalUnits: number;
  overheadPerUnitUsd: number;
  breakdown: BreakdownRow[];
  actualEditable: boolean;
  actualEditableReasonUk: string | null;
  isCurrentPeriod: boolean;
}

interface RailwaySettingsInfo {
  configured: boolean;
  tokenFingerprint: string | null;
  volumeId: string | null;
  lastCurrentMb: number | null;
  lastSizeMb: number | null;
  lastSyncedAt: string | null;
}

const CATEGORY_META: Record<ProductCategory, { labelUk: string; icon: React.ElementType }> = {
  goods: { labelUk: 'Матеріальні товари', icon: Package },
  books: { labelUk: 'Книги', icon: BookOpen },
  trainings: { labelUk: 'Тренінги', icon: GraduationCap },
};

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const usd2 = (n: number) => `$${n.toFixed(2)}`;

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

async function fetchBoard(period: string): Promise<BoardSummary> {
  const res = await fetch(`/api/admin/expense-board/${period}`, { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Не вдалося завантажити борд витрат.');
  return data as BoardSummary;
}

async function fetchRailwaySettings(): Promise<RailwaySettingsInfo> {
  const res = await fetch('/api/admin/expense-board/railway-settings', { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Не вдалося завантажити налаштування Railway.');
  return data as RailwaySettingsInfo;
}

export const AdminExpenseBoardView: React.FC = () => {
  const [period, setPeriod] = useState<string>(currentPeriod());
  const [board, setBoard] = useState<BoardSummary | null>(null);
  const [railway, setRailway] = useState<RailwaySettingsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Форма додавання витрати
  const [newKind, setNewKind] = useState<ExpenseKind>('other');
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Налаштування Railway API
  const [showRailwaySettings, setShowRailwaySettings] = useState(false);
  const [railwayToken, setRailwayToken] = useState('');
  const [railwayVolumeId, setRailwayVolumeId] = useState('');
  const [syncingRailway, setSyncingRailway] = useState(false);
  const [savingRailwaySettings, setSavingRailwaySettings] = useState(false);

  // Мікс продажів — локальні чернетки полів, щоб не бити запит на кожен символ
  const [mixDrafts, setMixDrafts] = useState<Record<ProductCategory, { planned: string; actual: string }>>({
    goods: { planned: '0', actual: '' },
    books: { planned: '0', actual: '' },
    trainings: { planned: '0', actual: '' },
  });
  const [savingMix, setSavingMix] = useState<ProductCategory | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Дві незалежні спроби, а не Promise.all: борд і налаштування Railway —
    // окремі секції екрана, і збій в одній (наприклад, тимчасова проблема з
    // /railway-settings) не має гасити відображення іншої, робочої секції.
    const results = await Promise.allSettled([fetchBoard(period), fetchRailwaySettings()]);
    const [boardResult, railwayResult] = results;

    if (boardResult.status === 'fulfilled') {
      const b = boardResult.value;
      setBoard(b);
      setMixDrafts({
        goods: { planned: String(b.salesMix.goods.plannedUnits), actual: b.salesMix.goods.actualUnits === null ? '' : String(b.salesMix.goods.actualUnits) },
        books: { planned: String(b.salesMix.books.plannedUnits), actual: b.salesMix.books.actualUnits === null ? '' : String(b.salesMix.books.actualUnits) },
        trainings: { planned: String(b.salesMix.trainings.plannedUnits), actual: b.salesMix.trainings.actualUnits === null ? '' : String(b.salesMix.trainings.actualUnits) },
      });
    } else {
      setError((boardResult.reason as any)?.message || 'Помилка завантаження борду витрат.');
    }

    if (railwayResult.status === 'fulfilled') {
      const r = railwayResult.value;
      setRailway(r);
      setRailwayVolumeId(r.volumeId || '');
    } else {
      console.error('Failed to load Railway settings', railwayResult.reason);
    }

    setLoading(false);
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const handleAddExpense = async () => {
    if (!newLabel.trim()) {
      setError('Вкажіть назву статті витрат.');
      return;
    }
    const amount = Number(newAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Сума має бути невідʼємним числом.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/expense-board/${period}/expenses`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: newKind, label: newLabel.trim(), amountUsd: amount, note: newNote.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося додати витрату.');
      setBoard(data as BoardSummary);
      setNewLabel('');
      setNewAmount('');
      setNewNote('');
      setNotice('Статтю витрат додано.');
    } catch (e: any) {
      setError(e?.message || 'Помилка збереження.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/expense-board/${period}/expenses/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося видалити статтю витрат.');
      setBoard(data as BoardSummary);
      setNotice('Статтю витрат видалено.');
    } catch (e: any) {
      setError(e?.message || 'Помилка видалення.');
    }
  };

  const handleSaveMix = async (category: ProductCategory, field: 'planned' | 'actual') => {
    if (!board) return;
    const draft = mixDrafts[category];
    const body: Record<string, unknown> = { category };
    if (field === 'planned') {
      const v = Number(draft.planned);
      if (!Number.isFinite(v) || v < 0) {
        setError('Планова кількість має бути невідʼємним числом.');
        return;
      }
      body.plannedUnits = v;
    } else {
      if (draft.actual.trim() === '') {
        body.actualUnits = null;
      } else {
        const v = Number(draft.actual);
        if (!Number.isFinite(v) || v < 0) {
          setError('Фактична кількість має бути невідʼємним числом.');
          return;
        }
        body.actualUnits = v;
      }
    }
    setSavingMix(category);
    setError(null);
    try {
      const res = await fetch(`/api/admin/expense-board/${period}/sales-mix`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося зберегти кількість.');
      setBoard(data as BoardSummary);
      setNotice('Збережено.');
    } catch (e: any) {
      setError(e?.message || 'Помилка збереження.');
    } finally {
      setSavingMix(null);
    }
  };

  const handleSaveRailwaySettings = async () => {
    setSavingRailwaySettings(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/expense-board/railway-settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: railwayToken.trim() || undefined, volumeId: railwayVolumeId.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося зберегти налаштування Railway.');
      setRailwayToken('');
      const r = await fetchRailwaySettings();
      setRailway(r);
      setNotice('Налаштування Railway збережено.');
    } catch (e: any) {
      setError(e?.message || 'Помилка збереження.');
    } finally {
      setSavingRailwaySettings(false);
    }
  };

  const handleSyncRailway = async () => {
    setSyncingRailway(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/expense-board/railway-settings/sync', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося оновити дані з Railway.');
      const r = await fetchRailwaySettings();
      setRailway(r);
      setNotice('Дані з Railway оновлено.');
    } catch (e: any) {
      setError(e?.message || 'Помилка синхронізації з Railway.');
    } finally {
      setSyncingRailway(false);
    }
  };

  if (loading && !board) {
    return (
      <div className="p-8 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin" /> Завантаження борду витрат…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="px-2 rounded hover:bg-white/10">✕</button>
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2" role="status">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Період */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setPeriod((p) => shiftPeriod(p, -1))}
          className="px-3 py-1.5 rounded-lg badge-glass text-slate-300 text-xs font-bold"
        >
          ← Попередній
        </button>
        <span className="px-4 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 text-sm font-bold capitalize">
          {board ? periodLabel(board.period) : period}
        </span>
        <button
          onClick={() => setPeriod((p) => shiftPeriod(p, 1))}
          className="px-3 py-1.5 rounded-lg badge-glass text-slate-300 text-xs font-bold"
        >
          Наступний →
        </button>
        {period !== currentPeriod() && (
          <button
            onClick={() => setPeriod(currentPeriod())}
            className="px-3 py-1.5 rounded-lg badge-glass text-cyan-300 text-xs font-bold"
          >
            До поточного місяця
          </button>
        )}
      </div>

      {board && (
        <>
          {/* Підсумкові KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Wallet, label: 'Усього витрат за місяць', value: usd2(board.totalExpensesUsd), hint: 'ШІ + Railway + інше', tone: 'text-amber-300' },
              { icon: Cpu, label: 'Витрати на ШІ', value: usd2(board.aiCostUsd), hint: 'автоматично з журналу генерацій', tone: 'text-cyan-300' },
              { icon: Server, label: 'Railway + інше', value: usd2(board.railwayCostUsd + board.otherCostUsd), hint: `Railway ${usd2(board.railwayCostUsd)} · інше ${usd2(board.otherCostUsd)}`, tone: 'text-violet-300' },
              { icon: Package, label: 'Накладні на одиницю', value: usd(board.overheadPerUnitUsd), hint: `${board.totalUnits} шт. за місяць`, tone: 'text-emerald-300' },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <div key={i} className="p-4 rounded-2xl glass-panel">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${card.tone}`} />
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">{card.label}</span>
                  </div>
                  <div className="text-xl font-bold font-mono">{card.value}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{card.hint}</div>
                </div>
              );
            })}
          </div>

          {/* Railway */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Server className="w-4 h-4 text-violet-400" />
                Railway
              </h2>
              <button
                onClick={() => setShowRailwaySettings((v) => !v)}
                className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5"
              >
                <Settings2 className="w-3.5 h-3.5" /> Налаштування API
              </button>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Railway не віддає грошову вартість через публічне API — лише через дашборд/CLI. Тому суму внось
              вручну нижче. Розмір тому (ГБ) можна опційно підтягувати автоматично як довідкове число — не
              вартість, а фактичне заповнення диска <code className="text-slate-400">/data</code>.
            </p>

            {showRailwaySettings && (
              <div className="p-4 rounded-xl bg-slate-950/60 border border-white/[0.06] space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1.5">Токен доступу Railway (Account/Project token)</label>
                    <input
                      type="password"
                      value={railwayToken}
                      onChange={(e) => setRailwayToken(e.target.value)}
                      placeholder={railway?.configured ? `збережено · ${railway.tokenFingerprint}` : 'вставте токен'}
                      className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1.5">Volume ID</label>
                    <input
                      type="text"
                      value={railwayVolumeId}
                      onChange={(e) => setRailwayVolumeId(e.target.value)}
                      placeholder="з URL тому в дашборді Railway"
                      className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200 font-mono"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveRailwaySettings}
                    disabled={savingRailwaySettings}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold disabled:opacity-60"
                  >
                    {savingRailwaySettings ? 'Збереження…' : 'Зберегти'}
                  </button>
                  {railway?.configured && (
                    <button
                      onClick={handleSyncRailway}
                      disabled={syncingRailway}
                      className="px-3 py-1.5 rounded-lg badge-glass text-slate-200 text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingRailway ? 'animate-spin' : ''}`} />
                      Оновити з Railway
                    </button>
                  )}
                </div>
                {railway?.lastSyncedAt && (
                  <p className="text-[11px] text-slate-400">
                    Диск: <strong className="text-slate-200">{(railway.lastCurrentMb! / 1024).toFixed(2)} ГБ</strong> з{' '}
                    <strong className="text-slate-200">{(railway.lastSizeMb! / 1024).toFixed(2)} ГБ</strong> ·{' '}
                    синхронізовано {new Date(railway.lastSyncedAt).toLocaleString('uk-UA')}
                  </p>
                )}
              </div>
            )}

            <ExpenseList
              items={board.expenses.filter((e) => e.kind === 'railway')}
              onDelete={handleDeleteExpense}
            />
          </div>

          {/* Інші витрати */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h2 className="text-sm font-bold flex items-center gap-2 border-b border-white/[0.06] pb-3">
              <Wallet className="w-4 h-4 text-amber-400" />
              Інші накладні витрати
            </h2>
            <ExpenseList items={board.expenses.filter((e) => e.kind === 'other')} onDelete={handleDeleteExpense} />
          </div>

          {/* Форма додавання */}
          <div className="p-6 rounded-2xl glass-panel space-y-3">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />
              Додати статтю витрат
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1.5">Тип</label>
                <select
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as ExpenseKind)}
                  className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200"
                >
                  <option value="railway">Railway</option>
                  <option value="other">Інше</option>
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1.5">Назва</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="напр. Railway хостинг, вересень"
                  className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1.5">Сума, $</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1.5">Нотатка (необовʼязково)</label>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="field-glow w-full p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200"
                />
              </div>
            </div>
            <button
              onClick={handleAddExpense}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold disabled:opacity-60"
            >
              {saving ? 'Додавання…' : 'Додати'}
            </button>
          </div>

          {/* Мікс продажів */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h2 className="text-sm font-bold flex items-center gap-2 border-b border-white/[0.06] pb-3">
              <Package className="w-4 h-4 text-cyan-400" />
              Мікс продажів за місяць
            </h2>
            {!board.actualEditable && board.actualEditableReasonUk && (
              <p className="text-[11px] text-amber-300/90 flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {board.actualEditableReasonUk}
              </p>
            )}
            <div className="space-y-3">
              {(['goods', 'books', 'trainings'] as ProductCategory[]).map((cat) => {
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                const draft = mixDrafts[cat];
                return (
                  <div key={cat} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end p-3 rounded-xl bg-slate-950/50 border border-white/[0.06]">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                      <Icon className="w-4 h-4 text-slate-400" />
                      {meta.labelUk}
                    </div>
                    <div className="w-32">
                      <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">План, шт.</label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          min={0}
                          value={draft.planned}
                          onChange={(e) => setMixDrafts((prev) => ({ ...prev, [cat]: { ...prev[cat], planned: e.target.value } }))}
                          className="field-glow w-full p-2 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200 font-mono text-xs"
                        />
                        <button
                          onClick={() => handleSaveMix(cat, 'planned')}
                          disabled={savingMix === cat}
                          className="px-2 rounded-lg badge-glass text-[10px] font-bold shrink-0"
                        >
                          ОК
                        </button>
                      </div>
                    </div>
                    <div className="w-32">
                      <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Факт, шт.</label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          min={0}
                          disabled={!board.actualEditable}
                          value={draft.actual}
                          onChange={(e) => setMixDrafts((prev) => ({ ...prev, [cat]: { ...prev[cat], actual: e.target.value } }))}
                          placeholder="—"
                          className="field-glow w-full p-2 rounded-lg bg-slate-950/60 border border-white/[0.08] text-slate-200 font-mono text-xs disabled:opacity-40"
                        />
                        <button
                          onClick={() => handleSaveMix(cat, 'actual')}
                          disabled={savingMix === cat || !board.actualEditable}
                          className="px-2 rounded-lg badge-glass text-[10px] font-bold shrink-0 disabled:opacity-40"
                        >
                          ОК
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Розподіл */}
          <div className="p-6 rounded-2xl glass-panel space-y-3">
            <h2 className="text-sm font-bold border-b border-white/[0.06] pb-3">Розподіл витрат по лінійках бізнесу</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-white/[0.06]">
                    <th className="pb-2 pr-3 font-medium">Категорія</th>
                    <th className="pb-2 pr-3 font-medium text-right">Одиниць</th>
                    <th className="pb-2 pr-3 font-medium text-right">Частка</th>
                    <th className="pb-2 pr-3 font-medium text-right">Витрати на категорію</th>
                    <th className="pb-2 text-right font-medium">На одиницю</th>
                  </tr>
                </thead>
                <tbody>
                  {board.breakdown.map((row) => (
                    <tr key={row.category} className="border-b border-white/[0.04]">
                      <td className="py-2 pr-3">{row.labelUk}</td>
                      <td className="py-2 pr-3 text-right font-mono">{row.units}</td>
                      <td className="py-2 pr-3 text-right font-mono text-cyan-300">{row.sharePercent}%</td>
                      <td className="py-2 pr-3 text-right font-mono">{usd2(row.allocatedCostUsd)}</td>
                      <td className="py-2 text-right font-mono text-amber-300 font-bold">{usd(row.costPerUnitUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed pt-2 border-t border-white/[0.06]">
              Ставка «на одиницю» автоматично підставляється в калькулятор меблів (розділ «Накладні витрати з
              борду») для поточного місяця. Для книг і тренінгів окремих калькуляторів собівартості поки немає —
              це число можна використати вручну при ціноутворенні.
            </p>
          </div>
        </>
      )}
    </div>
  );
};

const ExpenseList: React.FC<{ items: ExpenseLineItem[]; onDelete: (id: string) => void }> = ({ items, onDelete }) => {
  if (items.length === 0) {
    return <p className="text-xs text-slate-500">Ще немає жодної статті витрат за цей місяць.</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-slate-950/50 border border-white/[0.06]">
          <div className="min-w-0">
            <span className="truncate font-medium text-slate-200 block">{item.label}</span>
            {item.note && <span className="text-slate-500 text-[11px]">{item.note}</span>}
          </div>
          <span className="flex items-center gap-3 shrink-0 ml-3">
            <span className="text-amber-300 font-mono font-bold">{usd2(item.amountUsd)}</span>
            <button onClick={() => onDelete(item.id)} className="p-1 rounded hover:bg-rose-500/20 text-rose-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
};
