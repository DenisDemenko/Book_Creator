/**
 * Адмін: модель ембедингів для семантичного пошуку (Т1.2).
 *
 * Окреме налаштування, НЕ частина прив'язки «модуль → модель»: дефолт тут
 * (Gemini Embedding 001) — лише для ембедингів пошуку по книзі, а не для
 * інших функцій ШІ (чат, ролі AI-1/2/3, генерація). Див.
 * server/core/search/embeddingModels.ts.
 */

import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

interface EmbeddingModelOption {
  id: string;
  label: string;
  provider: string;
  usdPerMTokens: number;
  note: string | null;
  available: boolean;
}

export const EmbeddingModelSetting: React.FC = () => {
  const [models, setModels] = useState<EmbeddingModelOption[]>([]);
  const [current, setCurrent] = useState('');
  const [defaultId, setDefaultId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/core-embedding-model', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setModels(d.models || []);
        setCurrent(d.modelId || '');
        setDefaultId(d.defaultModelId || '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (modelId: string) => {
    const previous = current;
    setCurrent(modelId);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/core-embedding-model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ modelId: modelId === defaultId ? null : modelId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося зберегти модель ембедингів.');
      setCurrent(data.modelId);
      setChanged(data.modelId !== previous);
    } catch (err: any) {
      setCurrent(previous);
      setError(err?.message || 'Не вдалося зберегти модель ембедингів.');
    } finally {
      setSaving(false);
    }
  };

  if (!models.length) return null;
  const selected = models.find((m) => m.id === current);

  return (
    <div className="nm-outset rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-3" data-embedding-model-setting>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-[var(--on-surface)] flex items-center gap-1.5">
          <Search className="w-3.5 h-3.5" /> Модель ембедингів (семантичний пошук)
        </div>
        <div className="text-[10px] text-[var(--outline)] leading-snug">
          За замовчуванням — {models.find((m) => m.id === defaultId)?.label || defaultId}. Цей вибір діє ЛИШЕ на пошук
          абзаців за змістом, а не на інші функції ШІ: у чата, ролей AI-1/2/3 і генерації — свої моделі нижче.
        </div>
        {selected?.note && <div className="text-[10px] text-amber-500 leading-snug mt-0.5">{selected.note}</div>}
        {changed && (
          <div className="text-[10px] text-amber-500 leading-snug mt-0.5">
            Вектори попередньої моделі з новою не порівнюються: книги переобчисляться у фоні під час першого пошуку, доти
            пошук іде за словами й сутностями.
          </div>
        )}
      </div>
      <select
        value={current}
        disabled={saving}
        onChange={(e) => void save(e.target.value)}
        className="ml-auto min-w-[220px] nm-inset rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-[var(--on-surface)] bg-transparent outline-none cursor-pointer disabled:opacity-50"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.available && m.id !== current}>
            {m.label}
            {m.id === defaultId ? ' — за замовчуванням' : ''} · ${m.usdPerMTokens}/1M
            {m.available ? '' : ' (без ключа)'}
          </option>
        ))}
      </select>
      {error && <div className="w-full text-[10px] text-rose-400">{error}</div>}
    </div>
  );
};

export default EmbeddingModelSetting;
