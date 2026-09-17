import React, { useEffect, useMemo, useState } from 'react';
import { DoorOpen, Sparkles, Loader2, AlertTriangle, CheckCircle2, Save, Trash2, Quote } from 'lucide-react';
import type { Book, Character } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useWriterBook } from '../context/WriterBookContext';

interface ThresholdTrainerProps {
  book: Book;
}

type ThresholdType =
  | 'physical' | 'psychological' | 'social' | 'moral' | 'relationship'
  | 'professional' | 'intellectual' | 'spiritual' | 'existential';

const THRESHOLD_TYPES: ThresholdType[] = [
  'physical', 'psychological', 'social', 'moral', 'relationship', 'professional', 'intellectual', 'spiritual', 'existential',
];

interface RiskProfile {
  physical: number;
  emotional: number;
  social: number;
  material: number;
  existential: number;
}

interface ThresholdCandidateOut {
  isThresholdCandidate: boolean;
  character: string;
  title: string;
  description: string;
  types: ThresholdType[];
  beforeState: string;
  choice: string;
  crossingAction: string;
  afterState: string;
  risks: RiskProfile;
  cost: number;
  irreversibility: number;
  transformation: number;
  awareness: number;
  agency: number;
  evidenceQuote: string;
  confidence: number;
}

interface ThresholdPreview {
  score: number;
  strength: string;
  isRealThreshold: boolean;
}

interface SavedThreshold {
  id: string;
  title: string;
  description: string;
  types: ThresholdType[];
  score: number;
  status: string;
  updatedAt: string;
}

/** Короткий текстовий профіль персонажа для промту — той самий підхід, що й у EmotionMasteryTrainer. */
function buildCharacterProfile(c: Character): string {
  const parts: string[] = [];
  if (c.role) parts.push(`роль: ${c.role}`);
  if (c.profession) parts.push(`професія: ${c.profession}`);
  if (c.personality?.motivation) parts.push(`мотивація: ${c.personality.motivation}`);
  if (c.personality?.internalConflict) parts.push(`внутрішній конфлікт: ${c.personality.internalConflict}`);
  return parts.join('; ');
}

export const ThresholdTrainer: React.FC<ThresholdTrainerProps> = ({ book }) => {
  const { t, lang } = useLanguage();
  const { bookExcerpts, activeExcerptId } = useWriterBook();

  const [characterId, setCharacterId] = useState<string>(book.characters[0]?.id || '');
  const [excerptId, setExcerptId] = useState<string>(activeExcerptId || bookExcerpts[0]?.id || '');
  const [customFragment, setCustomFragment] = useState('');
  const [useCustom, setUseCustom] = useState(bookExcerpts.length === 0);
  const [sceneSummary, setSceneSummary] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ThresholdCandidateOut | null>(null);
  const [preview, setPreview] = useState<ThresholdPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [items, setItems] = useState<SavedThreshold[]>([]);

  const character = useMemo(() => book.characters.find((c) => c.id === characterId) || null, [book.characters, characterId]);
  const excerpt = useMemo(() => bookExcerpts.find((e) => e.id === excerptId) || null, [bookExcerpts, excerptId]);
  const fragment = useCustom ? customFragment : excerpt?.text || '';

  const loadItems = async () => {
    try {
      const res = await fetch(`/api/thresholds?bookId=${encodeURIComponent(book.id)}`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const body = await res.json();
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch {
      /* історія — довідка, її відсутність не має ламати екран */
    }
  };

  useEffect(() => {
    void loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  async function analyze() {
    if (!character || fragment.trim().length < 100) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/ai/threshold-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          bookId: book.id,
          characterId: character.id,
          characterName: character.name,
          characterProfile: buildCharacterProfile(character),
          sceneSummary,
          bookTitle: book.title,
          genre: book.genre,
          fragment,
          locale: book.language || (lang === 'en' ? 'en' : 'uk'),
        }),
      });
      const body = await res.json().catch(() => ({ error: t('thresholdTrainer.badResponse') }));
      if (!res.ok) throw new Error(body?.error || `${t('thresholdTrainer.httpError')} ${res.status}`);
      setCandidate(body.result as ThresholdCandidateOut);
      setPreview(body.preview as ThresholdPreview | null);
    } catch (e) {
      setError((e as Error).message || t('thresholdTrainer.genericError'));
    } finally {
      setBusy(false);
    }
  }

  function updateCandidate<K extends keyof ThresholdCandidateOut>(key: K, value: ThresholdCandidateOut[K]) {
    setCandidate((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function toggleType(tp: ThresholdType) {
    setCandidate((prev) => {
      if (!prev) return prev;
      const has = prev.types.includes(tp);
      const next = has ? prev.types.filter((x) => x !== tp) : [...prev.types, tp].slice(0, 3);
      return { ...prev, types: next };
    });
  }

  async function saveThreshold() {
    if (!candidate) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          bookId: book.id,
          characterId: characterId || null,
          title: candidate.title,
          description: candidate.description,
          types: candidate.types,
          beforeState: candidate.beforeState,
          choice: candidate.choice,
          crossingAction: candidate.crossingAction,
          afterState: candidate.afterState,
          risks: candidate.risks,
          cost: candidate.cost,
          irreversibility: candidate.irreversibility,
          transformation: candidate.transformation,
          awareness: candidate.awareness,
          agency: candidate.agency,
          confidence: candidate.confidence,
          status: 'crossed',
        }),
      });
      const body = await res.json().catch(() => ({ error: t('thresholdTrainer.badResponse') }));
      if (!res.ok) throw new Error(body?.error || `${t('thresholdTrainer.httpError')} ${res.status}`);
      setSaved(true);
      setCandidate(null);
      setPreview(null);
      void loadItems();
    } catch (e) {
      setError((e as Error).message || t('thresholdTrainer.genericError'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteThreshold(id: string) {
    try {
      await fetch(`/api/thresholds/${id}`, { method: 'DELETE', credentials: 'same-origin' });
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      /* видалення — не критична дія, помилку не показуємо окремо */
    }
  }

  const riskKeys: (keyof RiskProfile)[] = ['physical', 'emotional', 'social', 'material', 'existential'];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="nova-glass-dark rounded-2xl border border-violet-500/20 p-5">
        <div className="flex items-center gap-2 mb-3">
          <DoorOpen className="w-4 h-4 text-violet-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('thresholdTrainer.title')}</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">{t('thresholdTrainer.intro')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5">{t('thresholdTrainer.pickCharacter')}</label>
            <select
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs text-white"
            >
              {book.characters.length === 0 && <option value="">{t('thresholdTrainer.noCharacters')}</option>}
              {book.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.surname ? ` ${c.surname}` : ''}
                </option>
              ))}
            </select>
          </div>

          {!useCustom && (
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1.5">{t('thresholdTrainer.pickExcerpt')}</label>
              <select
                value={excerptId}
                onChange={(e) => setExcerptId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs text-white"
              >
                {bookExcerpts.length === 0 && <option value="">{t('thresholdTrainer.noExcerpts')}</option>}
                {bookExcerpts.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.chapterTitle} → {ex.sectionTitle}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] font-medium text-slate-400">
            {useCustom ? t('thresholdTrainer.pastedFragment') : t('thresholdTrainer.sectionFragment')}
          </label>
          <button
            type="button"
            onClick={() => setUseCustom((v) => !v)}
            className="text-[11px] text-cyan-300/80 hover:text-cyan-200 underline"
          >
            {useCustom ? t('thresholdTrainer.switchToExcerpt') : t('thresholdTrainer.switchToCustom')}
          </button>
        </div>
        <textarea
          value={fragment}
          onChange={(e) => (useCustom ? setCustomFragment(e.target.value) : undefined)}
          readOnly={!useCustom}
          rows={7}
          placeholder={t('thresholdTrainer.fragmentPlaceholder')}
          className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-y"
        />
        <div className="text-[11px] text-slate-500 mt-1">
          {t('thresholdTrainer.charsCount', { count: fragment.trim().length })}
        </div>

        <div className="mt-3">
          <label className="block text-[11px] font-medium text-slate-400 mb-1.5">{t('thresholdTrainer.sceneSummaryLabel')}</label>
          <input
            type="text"
            value={sceneSummary}
            onChange={(e) => setSceneSummary(e.target.value)}
            placeholder={t('thresholdTrainer.sceneSummaryPlaceholder')}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs text-slate-200"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={analyze}
          disabled={busy || !character || fragment.trim().length < 100}
          className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          <span>{busy ? t('thresholdTrainer.analyzing') : t('thresholdTrainer.analyzeBtn')}</span>
        </button>
      </div>

      {saved && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{t('thresholdTrainer.savedMessage')}</span>
        </div>
      )}

      {candidate && !candidate.isThresholdCandidate && (
        <div className="nova-glass-dark rounded-2xl border border-slate-800 p-5">
          <p className="text-sm text-slate-300">{t('thresholdTrainer.notAThreshold')}</p>
          {candidate.description && <p className="text-xs text-slate-500 mt-2">{candidate.description}</p>}
        </div>
      )}

      {candidate && candidate.isThresholdCandidate && (
        <div className="nova-glass-dark rounded-2xl border border-amber-500/30 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-100">{t('thresholdTrainer.candidateHeading')}</h4>
            {preview && (
              <div className="text-right">
                <div className="text-sm font-bold text-amber-400">{preview.score}/10</div>
                <div className="text-[10px] text-slate-500">{preview.strength}</div>
              </div>
            )}
          </div>
          {preview && !preview.isRealThreshold && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{t('thresholdTrainer.weakCandidateWarning')}</span>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">{t('thresholdTrainer.fieldTitle')}</label>
            <input
              type="text"
              value={candidate.title}
              onChange={(e) => updateCandidate('title', e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-sm text-slate-200"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">{t('thresholdTrainer.fieldDescription')}</label>
            <textarea
              value={candidate.description}
              onChange={(e) => updateCandidate('description', e.target.value)}
              rows={2}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-sm text-slate-200 resize-y"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5">{t('thresholdTrainer.fieldTypes')}</label>
            <div className="flex flex-wrap gap-1.5">
              {THRESHOLD_TYPES.map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => toggleType(tp)}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition ${
                    candidate.types.includes(tp)
                      ? 'bg-violet-500/20 border-violet-400 text-violet-300'
                      : 'bg-slate-900 border-slate-700 hover:border-violet-400/60 text-slate-400'
                  }`}
                >
                  {t(`thresholdTrainer.type_${tp}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">{t('thresholdTrainer.fieldBeforeState')}</label>
              <textarea
                value={candidate.beforeState}
                onChange={(e) => updateCandidate('beforeState', e.target.value)}
                rows={2}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs text-slate-200 resize-y"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">{t('thresholdTrainer.fieldAfterState')}</label>
              <textarea
                value={candidate.afterState}
                onChange={(e) => updateCandidate('afterState', e.target.value)}
                rows={2}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs text-slate-200 resize-y"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">{t('thresholdTrainer.fieldChoice')}</label>
              <textarea
                value={candidate.choice}
                onChange={(e) => updateCandidate('choice', e.target.value)}
                rows={2}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs text-slate-200 resize-y"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">{t('thresholdTrainer.fieldCrossingAction')}</label>
              <textarea
                value={candidate.crossingAction}
                onChange={(e) => updateCandidate('crossingAction', e.target.value)}
                rows={2}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs text-slate-200 resize-y"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5">{t('thresholdTrainer.riskProfileHeading')}</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {riskKeys.map((rk) => (
                <div key={rk}>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>{t(`thresholdTrainer.risk_${rk}`)}</span>
                    <span className="font-mono">{candidate.risks[rk]}/10</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={candidate.risks[rk]}
                    onChange={(e) => updateCandidate('risks', { ...candidate.risks, [rk]: Number(e.target.value) })}
                    className="w-full accent-violet-500"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(['cost', 'irreversibility', 'transformation', 'awareness', 'agency'] as const).map((key) => (
              <div key={key}>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>{t(`thresholdTrainer.field_${key}`)}</span>
                  <span className="font-mono">{candidate[key]}/10</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={candidate[key]}
                  onChange={(e) => updateCandidate(key, Number(e.target.value) as any)}
                  className="w-full accent-amber-500"
                />
              </div>
            ))}
          </div>

          {candidate.evidenceQuote && (
            <div className="flex items-start gap-2 text-xs text-slate-400 pt-2 border-t border-slate-800">
              <Quote className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span className="italic">«{candidate.evidenceQuote}»</span>
            </div>
          )}

          <button
            type="button"
            onClick={saveThreshold}
            disabled={saving || !candidate.title.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{saving ? t('thresholdTrainer.saving') : t('thresholdTrainer.saveBtn')}</span>
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="nova-glass-dark rounded-2xl border border-slate-800 p-5">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">{t('thresholdTrainer.savedListHeading')}</h4>
          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-200 truncate">{it.title}</div>
                  <div className="text-[10px] text-slate-500">
                    {t('thresholdTrainer.scoreShort')}: {it.score}/10
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteThreshold(it.id)}
                  className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 transition shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
