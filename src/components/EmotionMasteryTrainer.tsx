import React, { useMemo, useState } from 'react';
import { Heart, Sparkles, Loader2, AlertTriangle, Quote, TrendingUp, Gauge } from 'lucide-react';
import type { Book, Character } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useWriterBook } from '../context/WriterBookContext';

interface EmotionMasteryTrainerProps {
  book: Book;
}

interface EmotionCandidateOut {
  name: string;
  probability: number;
  intensity: number;
}

interface EvidenceOut {
  criterion: string;
  quote: string;
  explanation: string;
}

interface EmotionAnalysisResult {
  character: string;
  primaryEmotion: EmotionCandidateOut;
  secondaryEmotions: EmotionCandidateOut[];
  hiddenEmotions: EmotionCandidateOut[];
  mastery: Record<string, number>;
  evidence: EvidenceOut[];
  thresholdImpact: number;
  timeline: { emotion: string; intensity: number }[];
  confidence: number;
  masteryScore: number;
  masteryLevel: string;
}

const MASTERY_ORDER = [
  'trigger', 'stakes', 'body', 'thoughts', 'behavior', 'specificity', 'subtext', 'dynamics', 'individuality', 'reader_effect',
];

/** Короткий текстовий профіль персонажа для промту — без переказу всієї картки. */
function buildCharacterProfile(c: Character): string {
  const parts: string[] = [];
  if (c.role) parts.push(`роль: ${c.role}`);
  if (c.profession) parts.push(`професія: ${c.profession}`);
  if (c.personality?.motivation) parts.push(`мотивація: ${c.personality.motivation}`);
  if (c.personality?.internalConflict) parts.push(`внутрішній конфлікт: ${c.personality.internalConflict}`);
  if (c.personality?.fears?.length) parts.push(`страхи: ${c.personality.fears.join(', ')}`);
  return parts.join('; ');
}

function buildRelationshipContext(c: Character, all: Character[]): string {
  if (!c.relationships?.length) return '';
  return c.relationships
    .map((r) => {
      const target = all.find((x) => x.id === r.targetCharacterId);
      const name = target ? target.name : r.targetCharacterId;
      return `${name} (${r.type})${r.description ? ' — ' + r.description : ''}`;
    })
    .join('; ');
}

export const EmotionMasteryTrainer: React.FC<EmotionMasteryTrainerProps> = ({ book }) => {
  const { t, lang } = useLanguage();
  const { bookExcerpts, activeExcerptId } = useWriterBook();

  const [characterId, setCharacterId] = useState<string>(book.characters[0]?.id || '');
  const [excerptId, setExcerptId] = useState<string>(activeExcerptId || bookExcerpts[0]?.id || '');
  const [customFragment, setCustomFragment] = useState('');
  const [useCustom, setUseCustom] = useState(bookExcerpts.length === 0);
  const [sceneSummary, setSceneSummary] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EmotionAnalysisResult | null>(null);

  const character = useMemo(() => book.characters.find((c) => c.id === characterId) || null, [book.characters, characterId]);
  const excerpt = useMemo(() => bookExcerpts.find((e) => e.id === excerptId) || null, [bookExcerpts, excerptId]);
  const fragment = useCustom ? customFragment : excerpt?.text || '';

  const masteryLabel = (key: string) => t(`emotionMasteryTrainer.criterion_${key}`);

  async function analyze() {
    if (!character || fragment.trim().length < 100) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/emotion-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          bookId: book.id,
          sceneId: excerpt?.sectionId || null,
          characterId: character.id,
          characterName: character.name,
          characterProfile: buildCharacterProfile(character),
          relationshipContext: buildRelationshipContext(character, book.characters),
          sceneSummary,
          bookTitle: book.title,
          genre: book.genre,
          fragment,
          locale: book.language || (lang === 'en' ? 'en' : 'uk'),
        }),
      });
      const body = await res.json().catch(() => ({ error: t('emotionMasteryTrainer.badResponse') }));
      if (!res.ok) throw new Error(body?.error || `${t('emotionMasteryTrainer.httpError')} ${res.status}`);
      setResult(body.result as EmotionAnalysisResult);
    } catch (e) {
      setError((e as Error).message || t('emotionMasteryTrainer.genericError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="nova-glass-dark rounded-2xl border border-rose-500/20 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Heart className="w-4 h-4 text-rose-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('emotionMasteryTrainer.title')}</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">{t('emotionMasteryTrainer.intro')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5">{t('emotionMasteryTrainer.pickCharacter')}</label>
            <select
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs text-white"
            >
              {book.characters.length === 0 && <option value="">{t('emotionMasteryTrainer.noCharacters')}</option>}
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
              <label className="block text-[11px] font-medium text-slate-400 mb-1.5">{t('emotionMasteryTrainer.pickExcerpt')}</label>
              <select
                value={excerptId}
                onChange={(e) => setExcerptId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2 px-3 text-xs text-white"
              >
                {bookExcerpts.length === 0 && <option value="">{t('emotionMasteryTrainer.noExcerpts')}</option>}
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
            {useCustom ? t('emotionMasteryTrainer.pastedFragment') : t('emotionMasteryTrainer.sectionFragment')}
          </label>
          <button
            type="button"
            onClick={() => setUseCustom((v) => !v)}
            className="text-[11px] text-cyan-300/80 hover:text-cyan-200 underline"
          >
            {useCustom ? t('emotionMasteryTrainer.switchToExcerpt') : t('emotionMasteryTrainer.switchToCustom')}
          </button>
        </div>
        <textarea
          value={fragment}
          onChange={(e) => (useCustom ? setCustomFragment(e.target.value) : undefined)}
          readOnly={!useCustom}
          rows={7}
          placeholder={t('emotionMasteryTrainer.fragmentPlaceholder')}
          className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/40 resize-y"
        />
        <div className="text-[11px] text-slate-500 mt-1">
          {t('emotionMasteryTrainer.charsCount', { count: fragment.trim().length })}
        </div>

        <div className="mt-3">
          <label className="block text-[11px] font-medium text-slate-400 mb-1.5">{t('emotionMasteryTrainer.sceneSummaryLabel')}</label>
          <input
            type="text"
            value={sceneSummary}
            onChange={(e) => setSceneSummary(e.target.value)}
            placeholder={t('emotionMasteryTrainer.sceneSummaryPlaceholder')}
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
          className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          <span>{busy ? t('emotionMasteryTrainer.analyzing') : t('emotionMasteryTrainer.analyzeBtn')}</span>
        </button>
      </div>

      {result && (
        <div className="nova-glass-dark rounded-2xl border border-emerald-500/30 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-bold text-slate-100">
                {result.masteryScore}/100 <span className="text-xs font-normal text-slate-500">({result.masteryLevel})</span>
              </div>
              <div className="text-[11px] text-slate-500">
                {t('emotionMasteryTrainer.confidenceLabel')}: {Math.round(result.confidence * 100)}% ·{' '}
                {t('emotionMasteryTrainer.thresholdImpactLabel')}: {result.thresholdImpact}/10
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-rose-500/30">
              <div className="text-[10px] uppercase tracking-wider text-rose-400/80 mb-1">{t('emotionMasteryTrainer.primaryEmotion')}</div>
              <div className="text-sm font-semibold text-slate-100">{result.primaryEmotion.name}</div>
              <div className="text-[11px] text-slate-500">
                {t('emotionMasteryTrainer.intensityShort')} {result.primaryEmotion.intensity}/10 ·{' '}
                {t('emotionMasteryTrainer.probabilityShort')} {Math.round(result.primaryEmotion.probability * 100)}%
              </div>
            </div>
            {result.secondaryEmotions.length > 0 && (
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">{t('emotionMasteryTrainer.secondaryEmotions')}</div>
                {result.secondaryEmotions.map((c, i) => (
                  <div key={i} className="text-xs text-slate-300">
                    {c.name} <span className="text-slate-600">({c.intensity}/10)</span>
                  </div>
                ))}
              </div>
            )}
            {result.hiddenEmotions.length > 0 && (
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">{t('emotionMasteryTrainer.hiddenEmotions')}</div>
                {result.hiddenEmotions.map((c, i) => (
                  <div key={i} className="text-xs text-slate-300">
                    {c.name} <span className="text-slate-600">({c.intensity}/10)</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Gauge className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('emotionMasteryTrainer.masteryHeading')}</span>
            </div>
            {MASTERY_ORDER.map((key) => (
              <div key={key}>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>{masteryLabel(key)}</span>
                  <span className="font-mono">{result.mastery[key] ?? 0}/10</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-rose-500 to-amber-400"
                    style={{ width: `${((result.mastery[key] ?? 0) / 10) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {result.evidence.length > 0 && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex items-center gap-2">
                <Quote className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('emotionMasteryTrainer.evidenceHeading')}</span>
              </div>
              {result.evidence.map((ev, i) => (
                <div key={i} className="text-xs">
                  <span className="text-amber-400/90 font-semibold">{masteryLabel(ev.criterion) || ev.criterion}: </span>
                  <span className="text-slate-300 italic">«{ev.quote}»</span>
                  {ev.explanation && <span className="text-slate-500"> — {ev.explanation}</span>}
                </div>
              ))}
            </div>
          )}

          {result.timeline.length > 1 && (
            <div className="pt-2 border-t border-slate-800">
              <div className="flex items-center gap-2 mb-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('emotionMasteryTrainer.timelineHeading')}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {result.timeline.map((tl, i) => (
                  <span key={i} className="text-[10px] px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
                    {tl.emotion} ({tl.intensity})
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setResult(null)}
            className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
          >
            {t('emotionMasteryTrainer.newAnalysisBtn')}
          </button>
        </div>
      )}
    </div>
  );
};
