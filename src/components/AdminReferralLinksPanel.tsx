import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2, RefreshCw, Ticket } from 'lucide-react';

/**
 * Реферальні посилання зі знижкою на товар вітрини (запит власника 14.11.2026).
 *
 * ЩО ТУТ ВІДБУВАЄТЬСЯ НАСПРАВДІ. Знижку рахує й гасить вітрина — за промокодом
 * у кошику. Студія лише просить міст створити код і складає посилання з ним:
 * `…/catalog/<slug>?promo=КОД`. Тому тут немає ні власного лічильника погашень,
 * ні «вимкнути знижку»: другий облік тих самих грошей розійшовся б із вітриною
 * першого ж дня, і невідомо було б, котрий із двох брехливий.
 *
 * НУЛЬ ВІДСОТКІВ — окремий випадок, і це не дірка. Промокод «−0%» нічого не
 * робить, але назавжди лишається в переліку кодів вітрини. Тому при 0% код не
 * створюється взагалі: посилання йде з `?ref=`, який вітрина вже розуміє як
 * мітку джерела переходу.
 */

interface ListingOption {
  slug: string;
  title: string | null;
  kind: string;
  at: string;
}

interface PromoCodeRow {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  maxRedemptions: number | null;
  redemptionCount: number;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
}

interface CreatedLink {
  percent: number;
  code: string | null;
  url: string;
  note?: string;
}

const KIND_LABELS: Record<string, string> = {
  book: 'Книга',
  course: 'Курс',
  product: 'Виріб',
  instruction: 'Інструкція',
};

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('uk-UA');
};

export const AdminReferralLinksPanel: React.FC = () => {
  const [listings, setListings] = useState<ListingOption[]>([]);
  const [codes, setCodes] = useState<PromoCodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [slug, setSlug] = useState('');
  const [percent, setPercent] = useState(20);
  const [label, setLabel] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/referral-links', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Помилка ${res.status}`);
      setListings(Array.isArray(data.listings) ? data.listings : []);
      setCodes(Array.isArray(data.codes) ? data.codes : []);
      setSlug((current) => current || data.listings?.[0]?.slug || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося прочитати дані вітрини.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    setCreated(null);
    setCopied(false);
    try {
      const res = await fetch('/api/admin/referral-links', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          percent,
          label,
          maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
          expiresAt: expiresAt || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Помилка ${res.status}`);
      setCreated(data as CreatedLink);
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося створити посилання.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* без дозволу на буфер — посилання видно й так, його можна виділити */
    }
  };

  const input = 'w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-700 text-xs text-slate-200 outline-none focus:border-amber-400';

  return (
    <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5" data-referral-panel>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <Ticket className="w-3.5 h-3.5 text-amber-300" /> Реферальні посилання зі знижкою
        </h4>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-50"
          aria-label="Оновити"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400 mb-3">
        Посилання на товар вітрини з промокодом: знижку від 0 до 100% вітрина застосує сама, коли покупець
        відкриє кошик. <b className="text-slate-300">Нуль відсотків</b> — посилання без знижки, лише мітка джерела.
        Погашення рахує вітрина, тут вони лише видно.
      </p>

      {error && <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-200">{error}</div>}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Товар вітрини</span>
          <select className={input} value={slug} onChange={(e) => setSlug(e.target.value)} data-referral-listing>
            {listings.length === 0 && <option value="">Опублікованих товарів ще немає</option>}
            {listings.map((item) => (
              <option key={item.slug} value={item.slug}>
                {(KIND_LABELS[item.kind] || item.kind) + ' · ' + (item.title || item.slug)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Знижка, %</span>
          <input
            type="number"
            min={0}
            max={100}
            className={input}
            value={percent}
            onChange={(e) => setPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            data-referral-percent
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Назва (для коду)</span>
          <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Блогери, розсилка…" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Скільки разів можна використати</span>
          <input className={input} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value.replace(/\D/g, ''))} placeholder="без обмеження" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Діє до</span>
          <input type="date" className={input} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </label>
      </div>

      <button
        type="button"
        onClick={() => void create()}
        disabled={busy || !slug}
        className="mt-3 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold disabled:opacity-50"
        data-referral-create
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
        {busy ? 'Створюю…' : 'Створити посилання'}
      </button>

      {created && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3" data-referral-result>
          <p className="text-[11px] text-emerald-200">
            {created.code ? `Промокод ${created.code} — знижка ${created.percent}%.` : created.note}
          </p>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <a href={created.url} target="_blank" rel="noreferrer" className="text-xs text-amber-300 underline break-all">
              {created.url}
            </a>
            <button
              type="button"
              onClick={() => void copy()}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-700 text-[10px] font-bold text-slate-300"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Скопійовано' : 'Копіювати'}
            </button>
          </div>
        </div>
      )}

      {codes.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Коди вітрини</p>
          <div className="space-y-1.5">
            {codes.slice(0, 12).map((code) => (
              <div key={code.id} className="flex items-center gap-3 rounded-lg bg-slate-950/50 border border-slate-800 px-2.5 py-1.5 flex-wrap" data-referral-code={code.code}>
                <span className="font-mono text-xs text-slate-200">{code.code}</span>
                <span className="text-[10px] text-amber-300">
                  {code.type === 'percent' ? `−${code.value}%` : `−${(code.value / 100).toFixed(2)} грн`}
                </span>
                <span className="text-[10px] text-slate-500">
                  використано {code.redemptionCount}
                  {code.maxRedemptions ? ` з ${code.maxRedemptions}` : ''}
                </span>
                {code.expiresAt && <span className="text-[10px] text-slate-500">до {when(code.expiresAt)}</span>}
                {!code.active && <span className="text-[10px] text-rose-300">вимкнено</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
