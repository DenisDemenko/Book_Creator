/**
 * «Управління карткою товару» — редактор фізичного виробу (меблі/дерево).
 *
 * Відтворює макет `fusion_lab_studio` (нічна неоново-ціанова тема) і додає
 * ДЕННУ тему з тим самим змістом і сутністю — ті самі поля, та сама логіка,
 * лише світла гама. Перемикач ніч/день — у шапці сторінки.
 *
 * Чому окремий компонент, а не вкладка AdminPanelView: у наявних вкладок
 * зовсім інша природа (аналітика, таблиці), а тут — довга форма з власною
 * гамою. Це той самий підхід, що й AdminProductsView / AdminModerationView:
 * самостійний екран, який адмінка відкриває з вузла «Управління товарами».
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Image as ImageIcon,
  Info,
  Moon,
  Package,
  RefreshCw,
  Ruler,
  Save,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  blankFurnitureProduct,
  furniturePublishIssues,
  type FurnitureColor,
  type FurnitureProduct,
  type FurnitureWoodTone,
} from './furnitureProduct';

// ---------------------------------------------------------------------------
// Дві теми — та сама структура, різні класи Tailwind.
// ---------------------------------------------------------------------------

interface ThemeTokens {
  page: string;
  card: string;
  sectionHead: string;
  h2: string;
  sub: string;
  label: string;
  input: string;
  select: string;
  chip: string;
  chipChecked: string;
  banner: string;
  primaryBtn: string;
  ghostBtn: string;
  dangerBtn: string;
  backPill: string;
  badge: string;
  badgeOk: string;
  badgeInfo: string;
  dropZone: string;
  footer: string;
  divider: string;
  swatchRing: string;
}

const THEMES: Record<'night' | 'day', ThemeTokens> = {
  night: {
    page: 'bg-[#060b10] text-slate-300',
    card: 'bg-[#0b141f]/90 border border-cyan-500/15 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.45)]',
    sectionHead: 'border-b border-slate-800',
    h2: 'text-white',
    sub: 'text-slate-400',
    label: 'text-slate-300',
    input: 'bg-[#091119] border border-[#1a2a3a] text-slate-100 placeholder:text-slate-600 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400',
    select: 'bg-[#091119] border border-[#1a2a3a] text-slate-200 focus:border-cyan-400',
    chip: 'bg-cyan-950/50 border border-cyan-500/40 text-cyan-300',
    chipChecked: 'bg-cyan-950/70 border-cyan-400 text-cyan-200',
    banner: 'bg-[#0d1926]/70 border-l-4 border-l-cyan-400 text-slate-300',
    primaryBtn: 'bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40',
    ghostBtn: 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white',
    dangerBtn: 'border border-rose-600/40 bg-rose-950/20 hover:bg-rose-900/30 text-rose-300 hover:text-white',
    backPill: 'bg-[#0d1824]/80 border border-cyan-400/35 text-cyan-400',
    badge: 'bg-slate-800/80 border border-slate-700 text-slate-300',
    badgeOk: 'bg-emerald-950/60 border border-emerald-600/50 text-emerald-400',
    badgeInfo: 'bg-cyan-950/60 border border-cyan-700/50 text-cyan-400',
    dropZone: 'border-cyan-800/60 hover:border-cyan-400/80 bg-[#081018]/50 text-slate-300',
    footer: 'bg-[#070e17]/95 border-t border-cyan-800/40',
    divider: 'border-slate-800',
    swatchRing: 'ring-cyan-400/60',
  },
  day: {
    page: 'bg-[#f4f7fb] text-slate-700',
    card: 'bg-white border border-slate-200 rounded-2xl shadow-sm',
    sectionHead: 'border-b border-slate-200',
    h2: 'text-slate-900',
    sub: 'text-slate-500',
    label: 'text-slate-600',
    input: 'bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:ring-1 focus:ring-sky-500',
    select: 'bg-white border border-slate-300 text-slate-800 focus:border-sky-500',
    chip: 'bg-sky-50 border border-sky-200 text-sky-700',
    chipChecked: 'bg-sky-100 border-sky-400 text-sky-800',
    banner: 'bg-sky-50 border-l-4 border-l-sky-500 text-slate-700',
    primaryBtn: 'bg-sky-600 hover:bg-sky-500 text-white shadow-sm',
    ghostBtn: 'bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900',
    dangerBtn: 'border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700',
    backPill: 'bg-white border border-sky-300 text-sky-700',
    badge: 'bg-slate-100 border border-slate-200 text-slate-600',
    badgeOk: 'bg-emerald-50 border border-emerald-300 text-emerald-700',
    badgeInfo: 'bg-sky-50 border border-sky-200 text-sky-700',
    dropZone: 'border-slate-300 hover:border-sky-400 bg-slate-50 text-slate-500',
    footer: 'bg-white border-t border-slate-200',
    divider: 'border-slate-200',
    swatchRing: 'ring-sky-500/60',
  },
};

// ---------------------------------------------------------------------------
// Дрібні підкомпоненти
// ---------------------------------------------------------------------------

/** Підпис над полем — те саме місце, де в макеті стоять UPPERCASE-лейбли. */
const Label: React.FC<{ children: React.ReactNode; muted?: boolean }> = ({ children, muted }) => (
  <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${muted ? 'opacity-70' : ''}`}>
    {children}
  </label>
);

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  sub: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  t: ThemeTokens;
}

const Section: React.FC<SectionProps> = ({ icon, title, sub, right, children, t }) => (
  <div className={`${t.card} p-5`}>
    <div className={`flex items-center gap-3 ${t.sectionHead} pb-4 mb-5`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${t.badgeInfo}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <h2 className={`text-base font-bold tracking-wide ${t.h2}`}>{title}</h2>
        <p className={`text-[11px] ${t.sub}`}>{sub}</p>
      </div>
      {right}
    </div>
    {children}
  </div>
);

/** Двопозиційний чіп-перемикач («Активний у Nexus», «Фізичний (у Kyiv)»). */
const ToggleChip: React.FC<{
  on: boolean;
  label: string;
  onClick: () => void;
  t: ThemeTokens;
}> = ({ on, label, onClick, t }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
      on ? t.chipChecked : t.badge
    }`}
    aria-pressed={on}
  >
    {label}
  </button>
);

/** Читає локальний файл і стискає до превʼю (data URL) — щоб чорнетка не важила десятки МБ. */
function fileToPreview(file: File, maxDim = 1200): Promise<{ src: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не вдалося прочитати файл.'));
    reader.onload = () => {
      const raw = String(reader.result || '');
      const img = new Image();
      img.onerror = () => reject(new Error('Файл не є зображенням.'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        if (scale >= 1 && raw.length < 400_000) {
          // Дрібний файл — беремо як є, без перекодування (зберігає прозорість PNG).
          resolve({ src: raw, width: img.naturalWidth, height: img.naturalHeight });
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ src: raw, width: img.naturalWidth, height: img.naturalHeight });
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ src: canvas.toDataURL('image/jpeg', 0.85), width: w, height: h });
      };
      img.src = raw;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Редактор
// ---------------------------------------------------------------------------

export interface FurnitureProductEditorProps {
  /** Готова картка для редагування; null = нова. */
  initial?: FurnitureProduct | null;
  /** Повернення до переліку товарів. */
  onBack: () => void;
  /** Викликається після успішного збереження — щоб перелік оновився. */
  onSaved?: () => void;
}

export const FurnitureProductEditor: React.FC<FurnitureProductEditorProps> = ({ initial, onBack, onSaved }) => {
  const [theme, setTheme] = useState<'night' | 'day'>('night');
  const [product, setProduct] = useState<FurnitureProduct>(() => initial ?? blankFurnitureProduct());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);

  const t = THEMES[theme];

  const patch = useCallback((partial: Partial<FurnitureProduct>) => {
    setProduct((p) => ({ ...p, ...partial, updatedAt: new Date().toISOString() }));
  }, []);

  const issues = useMemo(() => furniturePublishIssues(product), [product]);

  // Ефект: якщо батьківський компонент передав інший початковий виріб —
  // перечитати (наприклад, «новий» після «редагувати»).
  useEffect(() => {
    setProduct(initial ?? blankFurnitureProduct());
  }, [initial]);

  const saveDraft = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/furniture-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ product }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося зберегти чорнетку.');
      setProduct(data.product);
      setMessage({ tone: 'ok', text: `${data.product.sku || 'Картку'} збережено як чорнетку.` });
      onSaved?.();
    } catch (err: any) {
      setMessage({ tone: 'err', text: err?.message || 'Помилка збереження.' });
    } finally {
      setBusy(false);
    }
  }, [product, onSaved]);

  const publish = useCallback(async () => {
    if (issues.length) {
      setMessage({ tone: 'err', text: `Не можна публікувати: ${issues.join(' ')}` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      // Спершу зберегти чорнетку, щоб публікувати останню версію.
      const saveRes = await fetch('/api/admin/furniture-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ product }),
      });
      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(saved?.error || 'Не вдалося зберегти перед публікацією.');
      const res = await fetch(`/api/admin/furniture-products/${encodeURIComponent(saved.product.id)}/publish`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Публікацію відхилено.');
      setProduct(data.product);
      setMessage({ tone: 'ok', text: 'Опубліковано на вітрині.' });
      onSaved?.();
    } catch (err: any) {
      setMessage({ tone: 'err', text: err?.message || 'Помилка публікації.' });
    } finally {
      setBusy(false);
    }
  }, [product, issues, onSaved]);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const accepted: Awaited<ReturnType<typeof fileToPreview>>[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        try {
          accepted.push(await fileToPreview(file));
        } catch {
          // пропускаємо незображення
        }
      }
      if (accepted.length === 0) return;
      const items = accepted.map((a, i) => ({
        id: `${Date.now().toString(36)}-${i}`,
        label: product.media.length + i === 0 ? 'Головний банер CAD / CNC' : `Фото ${product.media.length + i + 1}`,
        src: a.src,
        filename: files[i]?.name,
        width: a.width,
        height: a.height,
      }));
      patch({ media: [...product.media, ...items] });
    },
    [patch, product.media]
  );

  const removeMedia = useCallback(
    (id: string) => patch({ media: product.media.filter((m) => m.id !== id) }),
    [patch, product.media]
  );

  const toggleZone = useCallback(
    (zone: string) => {
      const has = product.functionalZones.includes(zone);
      patch({
        functionalZones: has
          ? product.functionalZones.filter((z) => z !== zone)
          : [...product.functionalZones, zone],
      });
    },
    [patch, product.functionalZones]
  );

  const toggleColor = useCallback(
    (id: string) => {
      patch({
        availableColors: product.availableColors.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)),
      });
    },
    [patch, product.availableColors]
  );

  const colorOf = (c: FurnitureColor) =>
    ({ oak: '#d9b380', walnut: '#6b4a2b', teak: '#9a6b3f', black: '#232323', ebony: '#2e2a26', mahogany: '#7c2f24' })[c.id] ?? '#888';

  return (
    <div className={`min-h-full rounded-2xl p-4 sm:p-6 pb-28 ${t.page}`} data-furniture-theme={theme}>
      {/* Шапка */}
      <header className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center gap-3 mb-5">
          <button
            type="button"
            onClick={onBack}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-full flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider transition-colors ${t.backPill}`}
          >
            <ArrowLeft className="w-4 h-4" /> Повернутися до мапінгу адмін панелі
          </button>
          <button
            type="button"
            onClick={() => setTheme((th) => (th === 'night' ? 'day' : 'night'))}
            className={`p-2 rounded-lg border transition-colors ${t.ghostBtn}`}
            title={theme === 'night' ? 'Денна тема' : 'Нічна тема'}
            aria-label={theme === 'night' ? 'Увімкнути денну тему' : 'Увімкнути нічну тему'}
          >
            {theme === 'night' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        <div className={`${t.card} p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-5`}>
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 rounded-2xl p-0.5 flex items-center justify-center shrink-0 ${theme === 'night' ? 'bg-gradient-to-br from-amber-500 via-orange-600 to-cyan-500' : 'bg-gradient-to-br from-amber-400 via-orange-500 to-sky-500'}`}>
              <div className={`w-full h-full rounded-[14px] flex items-center justify-center font-black text-2xl tracking-tighter ${theme === 'night' ? 'bg-[#080f17]' : 'bg-white'}`}>
                <span className={`bg-clip-text text-transparent bg-gradient-to-tr ${theme === 'night' ? 'from-amber-400 to-cyan-300' : 'from-amber-500 to-sky-600'}`}>FL</span>
              </div>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={`text-[10px] uppercase tracking-widest px-2.5 py-0.5 rounded-full font-mono ${t.badgeInfo}`}>
                  Fusion Lab Studio • Admin
                </span>
                <span className={`text-[10px] uppercase px-2.5 py-0.5 rounded-full flex items-center gap-1.5 font-medium ${t.badgeOk}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {product.status === 'published' ? 'published' : 'draft'}
                </span>
                <span className={`text-[10px] px-2.5 py-0.5 rounded-full ${t.badge}`}>Фізичний виріб (Handmade / CNC)</span>
              </div>
              <h1 className={`text-xl font-bold tracking-tight ${t.h2}`}>Управління карткою вітрини</h1>
              <p className={`text-xs ${t.sub} mt-1 max-w-2xl`}>
                Налаштуйте повний опис, мультимедіа, характеристики, комплектацію та параметри
                персоналізації для вітрини <span className="font-mono">Nexus → Fusion Labs</span>.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 self-end md:self-center">
            <button type="button" onClick={() => void saveDraft()} disabled={busy} className={`px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-50 ${t.ghostBtn}`}>
              <RefreshCw className="w-3.5 h-3.5" /> Зберегти
            </button>
            <button type="button" onClick={() => void publish()} disabled={busy} className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 ${t.primaryBtn}`}>
              Опублікувати на вітрині
            </button>
          </div>
        </div>
      </header>

      {/* Основний вміст */}
      <main className="max-w-6xl mx-auto mt-5 space-y-5">
        {message && (
          <div className={`rounded-xl p-3.5 flex items-start gap-2.5 text-xs leading-relaxed ${t.banner}`}>
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{message.text}</span>
            <button type="button" onClick={() => setMessage(null)} className="ml-auto shrink-0 opacity-70 hover:opacity-100" aria-label="Закрити">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Ліва колонка — дані */}
          <div className="lg:col-span-8 space-y-5">
            <Section t={t} icon={<Package className="w-4 h-4" />} title="Основна інформація про товар" sub="Назва, ціноутворення, артикул та складський облік">
              <div className="space-y-4">
                <div>
                  <Label>Назва виробу для вітрини</Label>
                  <input data-field="name" className={`w-full rounded-xl px-4 py-3 text-sm outline-none ${t.input}`} type="text" value={product.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Преміальний органайзер для робочого столу з LED-підсвічуванням" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <Label>Артикул / SKU</Label>
                    <input data-field="sku" className={`w-full rounded-xl px-3 py-2.5 text-xs font-mono outline-none ${t.input}`} type="text" value={product.sku} onChange={(e) => patch({ sku: e.target.value })} placeholder="BK-ORG-LED-2084" />
                  </div>
                  <div>
                    <Label>Категорія</Label>
                    <select className={`w-full rounded-xl px-3 py-2.5 text-xs outline-none ${t.select}`} value={product.category} onChange={(e) => patch({ category: e.target.value })}>
                      {(['Органайзери та підставки', 'Ексклюзивний декор', 'LED Еко-вироби', 'Цифрові STL моделі'] as const).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Підкатегорія</Label>
                    <select className={`w-full rounded-xl px-3 py-2.5 text-xs outline-none ${t.select}`} value={product.subcategory} onChange={(e) => patch({ subcategory: e.target.value })}>
                      {(['Авторський крафт (Дерево + Смола)', 'Офісні аксесуари', 'Подарункові комплекти'] as const).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <Label>Поточна ціна (₴)</Label>
                    <input data-field="price" className={`w-full rounded-xl px-3 py-2.5 text-sm font-bold outline-none ${t.input}`} type="number" min={0} value={product.priceUah || ''} onChange={(e) => patch({ priceUah: Number(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <Label muted>Базова ціна / До знижки</Label>
                    <input className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none ${t.input}`} type="number" min={0} value={product.basePriceUah || ''} onChange={(e) => patch({ basePriceUah: Number(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <Label>Залишок на складі</Label>
                    <input className={`w-24 rounded-xl px-3 py-2.5 text-sm text-center outline-none ${t.input}`} type="number" min={0} value={product.stock || ''} onChange={(e) => patch({ stock: Number(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Термін відправлення</Label>
                    <input className={`w-full rounded-xl px-3 py-2.5 text-xs outline-none ${t.input}`} type="text" value={product.leadTime} onChange={(e) => patch({ leadTime: e.target.value })} />
                  </div>
                  <div>
                    <Label>Статус лістингу</Label>
                    <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                      <ToggleChip t={t} on={product.activeInNexus} label="Активний у Nexus" onClick={() => patch({ activeInNexus: !product.activeInNexus })} />
                      <ToggleChip t={t} on={product.physical} label="Фізичний (у Kyiv)" onClick={() => patch({ physical: !product.physical })} />
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            <Section t={t} icon={<Sparkles className="w-4 h-4" />} title="Опис товару та контент" sub="Маркетинговий текст, концепція виробу та слоти" right={<span className={`text-[10px] font-mono px-2.5 py-1 rounded border ${t.badge}`}>WYSIWYG / Markdown</span>}>
              <div className="space-y-4">
                <div>
                  <Label>Короткий тизер (для превʼю у списку)</Label>
                  <input className={`w-full rounded-xl px-4 py-2.5 text-xs outline-none ${t.input}`} type="text" value={product.teaser} onChange={(e) => patch({ teaser: e.target.value })} />
                </div>
                <div>
                  <Label>Повний деталізований опис</Label>
                  <textarea className={`w-full rounded-xl p-4 text-xs leading-relaxed outline-none resize-y ${t.input}`} rows={6} value={product.description} onChange={(e) => patch({ description: e.target.value })} />
                </div>
                <div>
                  <Label>Функціональні зони та слоти (позначки характеристик)</Label>
                  <div className="flex flex-wrap gap-2">
                    {product.functionalZones.map((zone) => (
                      <button key={zone} type="button" onClick={() => toggleZone(zone)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] transition-colors ${t.chip}`}>
                        <Check className="w-3.5 h-3.5" /> {zone}
                      </button>
                    ))}
                    <button type="button" onClick={() => toggleZone('Нова зона')} className={`px-2.5 py-1.5 rounded-lg border border-dashed text-[11px] transition-colors ${t.chip}`}>
                      + Додати зону
                    </button>
                  </div>
                </div>
              </div>
            </Section>

            <Section t={t} icon={<Zap className="w-4 h-4" />} title="Параметри матеріалів та LED-підсвічування" sub="Інженерні параметри, електрика та габарити виробу">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Основний матеріал</Label>
                  <select className={`w-full rounded-xl px-3 py-2.5 text-xs outline-none ${t.select}`} value={product.material} onChange={(e) => patch({ material: e.target.value })}>
                    {(['Масив добірного Ясена (Ash Wood)', 'Американський Горіх (Walnut)', 'Масив Дуба (Oak)', 'Термоясен темний'] as const).map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Оздоблення та захист</Label>
                  <input className={`w-full rounded-xl px-3 py-2.5 text-xs outline-none ${t.input}`} type="text" value={product.finish} onChange={(e) => patch({ finish: e.target.value })} />
                </div>
                <div>
                  <Label>Габарити виробу (Ш × Г × В)</Label>
                  <input className={`w-full rounded-xl px-3 py-2.5 text-xs font-mono outline-none ${t.input}`} type="text" value={product.dimensions} onChange={(e) => patch({ dimensions: e.target.value })} />
                </div>
                <div>
                  <Label>Гарантія майстерні</Label>
                  <input className={`w-full rounded-xl px-3 py-2.5 text-xs outline-none ${t.input}`} type="text" value={product.warranty} onChange={(e) => patch({ warranty: e.target.value })} />
                </div>
                <div className={`sm:col-span-2 p-4 rounded-xl border grid grid-cols-1 sm:grid-cols-3 gap-3 ${theme === 'night' ? 'bg-[#09121a] border-cyan-800/30' : 'bg-slate-50 border-slate-200'}`}>
                  <div>
                    <span className={`block text-[10px] uppercase font-semibold mb-1 ${theme === 'night' ? 'text-cyan-400' : 'text-sky-600'}`}>LED-стрічка</span>
                    <input className={`w-full rounded-lg px-2.5 py-1.5 text-xs outline-none ${t.input}`} type="text" value={product.ledStrip} onChange={(e) => patch({ ledStrip: e.target.value })} />
                  </div>
                  <div>
                    <span className={`block text-[10px] uppercase font-semibold mb-1 ${theme === 'night' ? 'text-cyan-400' : 'text-sky-600'}`}>Живлення</span>
                    <input className={`w-full rounded-lg px-2.5 py-1.5 text-xs outline-none ${t.input}`} type="text" value={product.ledPower} onChange={(e) => patch({ ledPower: e.target.value })} />
                  </div>
                  <div>
                    <span className={`block text-[10px] uppercase font-semibold mb-1 ${theme === 'night' ? 'text-cyan-400' : 'text-sky-600'}`}>Керування</span>
                    <input className={`w-full rounded-lg px-2.5 py-1.5 text-xs outline-none ${t.input}`} type="text" value={product.ledControl} onChange={(e) => patch({ ledControl: e.target.value })} />
                  </div>
                </div>
              </div>
            </Section>
          </div>

          {/* Права колонка — медіа та персоналізація */}
          <div className="lg:col-span-4 space-y-5">
            <Section t={t} icon={<ImageIcon className="w-4 h-4" />} title="Медіа картки товару" sub="Головний банер і галерея" right={<span className={`text-[10px] font-mono ${theme === 'night' ? 'text-cyan-400' : 'text-sky-600'}`}>{product.media.length} файлів</span>}>
              <div className="space-y-3">
                {product.media.length > 0 && (
                  <div className="relative rounded-xl overflow-hidden border group">
                    <img src={product.media[0].src} alt={product.media[0].label} className="w-full h-48 object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between">
                      <span className="text-[10px] bg-black/80 text-white px-2 py-0.5 rounded">Головний банер</span>
                      {product.media[0].width ? <span className="text-[10px] text-slate-200 font-mono">{product.media[0].width} × {product.media[0].height}</span> : null}
                    </div>
                  </div>
                )}
                {product.media.length > 1 && (
                  <div className="grid grid-cols-4 gap-2">
                    {product.media.slice(1).map((m) => (
                      <div key={m.id} className="relative group rounded-lg overflow-hidden border border-slate-700">
                        <img src={m.src} alt={m.label} className="w-full aspect-square object-cover" />
                        <button type="button" onClick={() => removeMedia(m.id)} className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Видалити">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {product.media.length > 0 && (
                  <button type="button" onClick={() => patch({ media: product.media.slice(1) })} className="inline-flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300">
                    <Trash2 className="w-3.5 h-3.5" /> Очистити
                  </button>
                )}

                <div>
                  <Label>Палітра тонів дерева (з вітрини)</Label>
                  <div className="flex gap-2">
                    {product.woodTones.map((w: FurnitureWoodTone) => (
                      <div key={w.id} className="flex-1">
                        <div className={`h-14 rounded-lg ring-1 ring-inset ${t.swatchRing}`} style={{ backgroundColor: w.color }} />
                        <p className={`text-[10px] mt-1 text-center ${t.sub}`}>{w.label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <label className={`mt-3 border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors block ${t.dropZone}`}>
                  <Upload className="w-6 h-6 mx-auto mb-1 opacity-80" />
                  <p className="text-[11px] font-medium">Перетягніть нові фото або відеоогляд</p>
                  <p className="text-[10px] opacity-70 mt-0.5">PNG, JPG до 10 МБ</p>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
                </label>
              </div>
            </Section>

            <Section t={t} icon={<Ruler className="w-4 h-4" />} title="Доступні тони та персоналізація" sub="Вибір клієнта при додаванні в кошик">
              <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                {product.availableColors.map((c) => (
                  <label key={c.id} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${c.enabled ? t.chipChecked : t.badge}`}>
                    <input type="checkbox" checked={c.enabled} onChange={() => toggleColor(c.id)} className="hidden" />
                    <span className="w-4 h-4 rounded-full border border-current shrink-0" style={{ backgroundColor: c.enabled ? colorOf(c) : 'transparent' }} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
              <div className={`space-y-2.5 pt-2 ${t.divider} border-t`}>
                <label className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Дозволити лазерне гравіювання</span>
                  <input type="checkbox" checked={product.engraving} onChange={(e) => patch({ engraving: e.target.checked })} className="accent-cyan-500" />
                </label>
                {product.engraving && (
                  <div className="flex items-center gap-2 pl-1">
                    <span className="text-[11px] opacity-70">+</span>
                    <input className={`w-20 rounded-lg px-2 py-1 text-xs outline-none ${t.input}`} type="number" min={0} value={product.engravingPriceUah || ''} onChange={(e) => patch({ engravingPriceUah: Number(e.target.value) || 0 })} />
                    <span className="text-[11px] opacity-70">₴</span>
                  </div>
                )}
                <label className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Вибір кольору смоли (Бурштин / Смарагд / Неон)</span>
                  <input type="checkbox" checked={product.resinColor} onChange={(e) => patch({ resinColor: e.target.checked })} className="accent-cyan-500" />
                </label>
                <label className="flex items-center justify-between text-xs cursor-pointer">
                  <span>Підгонка під індивідуальну модель телефону</span>
                  <input type="checkbox" checked={product.phoneFit} onChange={(e) => patch({ phoneFit: e.target.checked })} className="accent-cyan-500" />
                </label>
              </div>
            </Section>
          </div>
        </div>
      </main>

      {/* Нижня панель */}
      <aside className={`fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl py-3 px-4 sm:px-8 ${t.footer}`}>
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <div className="text-[11px]">
              <span className={`font-semibold ${t.h2}`}>{product.sku || '—'}:</span>
              <span className={`ml-1 opacity-70`}>Всі зміни синхронізовано з локальним сховищем</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap justify-end">
            <button type="button" onClick={onBack} className={`px-4 py-2.5 rounded-xl text-xs font-medium transition-colors ${t.ghostBtn}`}>Скасувати</button>
            <button type="button" onClick={() => setMessage({ tone: 'info', text: 'Попередній перегляд відкриється після публікації виробу на вітрині.' })} className={`px-4 py-2.5 rounded-xl border text-xs font-medium transition-colors ${t.backPill}`}>
              Попередній перегляд на вітрині
            </button>
            <button type="button" onClick={() => setMessage({ tone: 'info', text: 'Зняття з вітрини стане доступним після публікації (архів, не видалення).' })} className={`px-4 py-2.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors ${t.dangerBtn}`}>
              <X className="w-3.5 h-3.5" /> Зняти з вітрини
            </button>
            <button type="button" onClick={() => void saveDraft()} disabled={busy} className={`px-6 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50 ${t.primaryBtn}`}>
              <Save className="w-3.5 h-3.5" /> Зберегти зміни
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
