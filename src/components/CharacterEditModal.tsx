import React, { useState } from 'react';
import { 
  X, 
  Save, 
  User, 
  Sparkles, 
  Trash2, 
  Plus, 
  Image as ImageIcon, 
  BrainCircuit, 
  Eye, 
  Shirt, 
  Heart, 
  Zap, 
  Tag,
  ShieldCheck,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import { Character, Book } from '../types';
import { normalizeCharacter } from '../utils/characterNormalize';
import { useLanguage } from '../i18n/LanguageContext';
import { collectCharacterMentions, formatMentionsForPrompt } from '../utils/characterMentions';

/** Одна знахідка «Хранителя цілісності» — форма відповіді сервера (server/characterConsistencyPrompt.ts), продубльована тут: клієнт не імпортує типи з server/. */
interface ConsistencyFinding {
  severity: 'low' | 'medium' | 'high';
  field: string;
  location: string;
  quote: string;
  issue: string;
}
interface ConsistencyResult {
  summary: string;
  findings: ConsistencyFinding[];
}
const CONSISTENCY_SEVERITY_CLS: Record<ConsistencyFinding['severity'], string> = {
  low: 'border-slate-600 bg-slate-700/40 text-slate-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  high: 'border-red-500/40 bg-red-500/10 text-red-200',
};

/** Один пункт «Детектора дрейфу поведінки» — форма відповіді сервера (server/behaviorDriftPrompt.ts), продубльована тут з тієї самої причини. */
interface DriftPatternResult {
  pattern: string;
  status: 'consistent' | 'drift' | 'unclear';
  location: string;
  quote: string;
  note: string;
}
interface DriftResult {
  summary: string;
  patterns: DriftPatternResult[];
}
const DRIFT_STATUS_CLS: Record<DriftPatternResult['status'], string> = {
  consistent: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  drift: 'border-red-500/40 bg-red-500/10 text-red-200',
  unclear: 'border-slate-600 bg-slate-700/40 text-slate-300',
};

interface CharacterEditModalProps {
  character: Character;
  book: Book;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedCharacter: Character) => void;
}

export const CharacterEditModal: React.FC<CharacterEditModalProps> = ({
  character,
  book,
  isOpen,
  onClose,
  onSave,
}) => {
  const { t } = useLanguage();
  if (!isOpen) return null;

  // normalizeCharacter: `character` тут може бути вже пошкодженим записом
  // (AI-персонаж, збережений без tags/personality.goals до виправлення
  // джерела) — без нормалізації p.strengths.filter(...) і подібні виклики
  // нижче кидають TypeError, крах підхоплює ErrorBoundary.
  const [charData, setCharData] = useState<Character>(normalizeCharacter({ ...character }));
  const [activeTab, setActiveTab] = useState<'general' | 'appearance' | 'psychology' | 'biography' | 'consistency' | 'drift'>('general');
  const [newTag, setNewTag] = useState<string>('');
  const [newStrength, setNewStrength] = useState<string>('');
  const [newWeakness, setNewWeakness] = useState<string>('');
  const [newFear, setNewFear] = useState<string>('');
  const [newGoal, setNewGoal] = useState<string>('');

  // AI Art generation in modal
  const [isGeneratingArt, setIsGeneratingArt] = useState<boolean>(false);
  const [selectedArtModel, setSelectedArtModel] = useState<'nano-banana-2-lite' | 'nano-banana-2' | 'nano-banana-pro'>('nano-banana-2');

  // «Хранитель цілісності персонажа» — крос-книжкова перевірка суперечностей
  const [isCheckingConsistency, setIsCheckingConsistency] = useState<boolean>(false);
  const [consistencyResult, setConsistencyResult] = useState<ConsistencyResult | null>(null);
  const [consistencyError, setConsistencyError] = useState<string | null>(null);

  // «Детектор дрейфу поведінки» — вужча перевірка: лише заявлені behaviorPatterns
  const [isCheckingDrift, setIsCheckingDrift] = useState<boolean>(false);
  const [driftResult, setDriftResult] = useState<DriftResult | null>(null);
  const [driftError, setDriftError] = useState<string | null>(null);

  const handleCheckConsistency = async () => {
    setIsCheckingConsistency(true);
    setConsistencyError(null);
    setConsistencyResult(null);
    try {
      const { mentions, totalFound } = collectCharacterMentions(book, {
        id: charData.id,
        name: charData.name,
        surname: charData.surname,
        alias: charData.alias,
      });
      if (totalFound === 0) {
        setConsistencyError(t('characterEditModal.consistencyNoMentions'));
        return;
      }
      const mentionsText = formatMentionsForPrompt(mentions);
      const relationshipsSummary = (charData.relationships || [])
        .map((r) => {
          const targetChar = book.characters.find((c) => c.id === r.targetCharacterId);
          const targetName = targetChar ? `${targetChar.name} ${targetChar.surname || ''}`.trim() : r.targetCharacterId;
          return `${targetName} — ${r.type}${r.description ? `: ${r.description}` : ''}`;
        })
        .join('\n');

      const res = await fetch('/api/ai/character-consistency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: book.id,
          character: charData,
          relationshipsSummary,
          mentions: mentionsText,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConsistencyError(data?.error || t('characterEditModal.consistencyError'));
        return;
      }
      setConsistencyResult(data.result);
    } catch (err) {
      console.error('Error checking character consistency:', err);
      setConsistencyError(t('characterEditModal.consistencyError'));
    } finally {
      setIsCheckingConsistency(false);
    }
  };

  const handleCheckDrift = async () => {
    setIsCheckingDrift(true);
    setDriftError(null);
    setDriftResult(null);
    try {
      if ((charData.behaviorPatterns || []).length === 0) {
        setDriftError(t('characterEditModal.driftNoPatterns'));
        return;
      }
      const { mentions, totalFound } = collectCharacterMentions(book, {
        id: charData.id,
        name: charData.name,
        surname: charData.surname,
        alias: charData.alias,
      });
      if (totalFound === 0) {
        setDriftError(t('characterEditModal.driftNoMentions'));
        return;
      }
      const mentionsText = formatMentionsForPrompt(mentions);

      const res = await fetch('/api/ai/behavior-drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: book.id,
          character: charData,
          mentions: mentionsText,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDriftError(data?.error || t('characterEditModal.driftError'));
        return;
      }
      setDriftResult(data.result);
    } catch (err) {
      console.error('Error checking behavior drift:', err);
      setDriftError(t('characterEditModal.driftError'));
    } finally {
      setIsCheckingDrift(false);
    }
  };

  const handleGenerateArtInModal = async () => {
    setIsGeneratingArt(true);
    try {
      const res = await fetch('/api/ai/generate-character-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character: charData,
          model: selectedArtModel,
          stylePreset: 'cyberpunk-photoreal',
        }),
      });
      const data = await res.json();
      if (data.imageUrl) {
        setCharData((prev) => ({
          ...prev,
          avatarUrl: data.imageUrl,
        }));
      }
    } catch (err) {
      console.error('Error generating art in modal:', err);
    } finally {
      setIsGeneratingArt(false);
    }
  };

  const handleSave = () => {
    onSave(charData);
    onClose();
  };

  const roleLabels: Record<Character['role'], string> = {
    protagonist: t('characterEditModal.roleProtagonist'),
    antagonist: t('characterEditModal.roleAntagonist'),
    deuteragonist: t('characterEditModal.roleDeuteragonist'),
    mentor: t('characterEditModal.roleMentor'),
    ally: t('characterEditModal.roleAlly'),
    rival: t('characterEditModal.roleRival'),
    minor: t('characterEditModal.roleMinor'),
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-950 border border-slate-800 rounded-2xl max-w-2xl w-full flex flex-col max-h-[90vh] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-3">
            {charData.avatarUrl ? (
              <img
                src={charData.avatarUrl}
                alt={charData.name}
                className="w-10 h-10 rounded-xl object-cover border border-amber-500/40 shadow-sm"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400 font-bold">
                {charData.name.charAt(0)}
              </div>
            )}
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>{t('characterEditModal.editingDossier', { name: `${charData.name} ${charData.surname || ''}` })}</span>
              </h3>
              <p className="text-xs text-amber-400/90 font-medium">
                {roleLabels[charData.role] || charData.role} {charData.alias ? `(«${charData.alias}»)` : ''}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/80 px-4 pt-2 gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('general')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'general'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>{t('characterEditModal.tabGeneral')}</span>
          </button>

          <button
            onClick={() => setActiveTab('appearance')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'appearance'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{t('characterEditModal.tabAppearance')}</span>
          </button>

          <button
            onClick={() => setActiveTab('psychology')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'psychology'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BrainCircuit className="w-3.5 h-3.5" />
            <span>{t('characterEditModal.tabPsychology')}</span>
          </button>

          <button
            onClick={() => setActiveTab('biography')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'biography'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t('characterEditModal.tabBiography')}</span>
          </button>

          <button
            onClick={() => setActiveTab('consistency')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'consistency'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{t('characterEditModal.tabConsistency')}</span>
          </button>

          <button
            onClick={() => setActiveTab('drift')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'drift'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>{t('characterEditModal.tabDrift')}</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-slate-200">
          
          {/* 1. GENERAL TAB */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">{t('characterEditModal.nameLabel')}</label>
                  <input
                    type="text"
                    value={charData.name}
                    onChange={(e) => setCharData({ ...charData, name: e.target.value })}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-400 focus:outline-hidden text-white font-medium"
                    placeholder="Марк, Олена..."
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">{t('characterEditModal.surnameLabel')}</label>
                  <input
                    type="text"
                    value={charData.surname || ''}
                    onChange={(e) => setCharData({ ...charData, surname: e.target.value })}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-400 focus:outline-hidden text-white font-medium"
                    placeholder="Ковальчук, Вальц..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">{t('characterEditModal.aliasLabel')}</label>
                  <input
                    type="text"
                    value={charData.alias || ''}
                    onChange={(e) => setCharData({ ...charData, alias: e.target.value })}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-400 focus:outline-hidden text-white"
                    placeholder="Грім, Фантом..."
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">{t('characterEditModal.dramaturgyRoleLabel')}</label>
                  <select
                    value={charData.role}
                    onChange={(e) => setCharData({ ...charData, role: e.target.value as any })}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-400 focus:outline-hidden text-white font-medium"
                  >
                    <option value="protagonist">{t('characterEditModal.roleProtagonist')}</option>
                    <option value="deuteragonist">{t('characterEditModal.roleDeuteragonist')}</option>
                    <option value="antagonist">{t('characterEditModal.roleAntagonist')}</option>
                    <option value="mentor">{t('characterEditModal.roleMentor')}</option>
                    <option value="ally">{t('characterEditModal.roleAlly')}</option>
                    <option value="rival">{t('characterEditModal.roleRival')}</option>
                    <option value="minor">{t('characterEditModal.roleMinor')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">{t('characterEditModal.ageLabel')}</label>
                  <input
                    type="number"
                    value={charData.age || ''}
                    onChange={(e) => setCharData({ ...charData, age: parseInt(e.target.value) || undefined })}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-400 focus:outline-hidden text-white"
                    placeholder="28"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">{t('characterEditModal.genderLabel')}</label>
                  <input
                    type="text"
                    value={charData.gender || ''}
                    onChange={(e) => setCharData({ ...charData, gender: e.target.value })}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-400 focus:outline-hidden text-white"
                    placeholder="Жіноча / Чоловіча / ШІ"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">{t('characterEditModal.professionLabel')}</label>
                  <input
                    type="text"
                    value={charData.profession || ''}
                    onChange={(e) => setCharData({ ...charData, profession: e.target.value })}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-400 focus:outline-hidden text-white"
                    placeholder="Нейроархітекторка"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">{t('characterEditModal.avatarUrlLabel')}</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={charData.avatarUrl || ''}
                    onChange={(e) => setCharData({ ...charData, avatarUrl: e.target.value })}
                    className="flex-1 p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-400 focus:outline-hidden text-white font-mono text-[11px]"
                    placeholder="https://images.unsplash.com/..."
                  />
                  {charData.avatarUrl && (
                    <img
                      src={charData.avatarUrl}
                      alt="Preview"
                      className="w-10 h-10 rounded-xl object-cover border border-amber-500/50 shadow-sm shrink-0"
                    />
                  )}
                </div>

                {/* AI Portrait Generator Bar */}
                <div className="mt-2.5 p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-[11px] text-slate-300">{t('characterEditModal.modelLabel')}</span>
                    <select
                      value={selectedArtModel}
                      onChange={(e) => setSelectedArtModel(e.target.value as any)}
                      className="p-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-amber-300 font-semibold focus:outline-hidden"
                    >
                      <option value="nano-banana-2-lite">{t('characterEditModal.modelLiteOption')}</option>
                      <option value="nano-banana-2">{t('characterEditModal.modelStandardOption')}</option>
                      <option value="nano-banana-pro">{t('characterEditModal.modelProOption')}</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleGenerateArtInModal}
                    disabled={isGeneratingArt}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-[11px] flex items-center gap-1.5 transition-all shadow-sm active:scale-95 disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isGeneratingArt ? t('characterEditModal.generatingArt') : t('characterEditModal.generateHeroArt')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. APPEARANCE TAB */}
          {activeTab === 'appearance' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">{t('characterEditModal.heightLabel')}</label>
                  <input
                    type="text"
                    value={charData.appearance?.height || ''}
                    onChange={(e) => setCharData({
                      ...charData,
                      appearance: { ...(charData.appearance || {}), height: e.target.value }
                    })}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white"
                    placeholder="174 см"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">{t('characterEditModal.buildLabel')}</label>
                  <input
                    type="text"
                    value={charData.appearance?.build || ''}
                    onChange={(e) => setCharData({
                      ...charData,
                      appearance: { ...(charData.appearance || {}), build: e.target.value }
                    })}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white"
                    placeholder="Струнка, атлетична..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">{t('characterEditModal.hairLabel')}</label>
                  <input
                    type="text"
                    value={charData.appearance?.hair || ''}
                    onChange={(e) => setCharData({
                      ...charData,
                      appearance: { ...(charData.appearance || {}), hair: e.target.value }
                    })}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white"
                    placeholder="Коротке платинове, неонові пасма..."
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">{t('characterEditModal.eyesLabel')}</label>
                  <input
                    type="text"
                    value={charData.appearance?.eyes || ''}
                    onChange={(e) => setCharData({
                      ...charData,
                      appearance: { ...(charData.appearance || {}), eyes: e.target.value }
                    })}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white"
                    placeholder="Бурштинові, уважні, кіберімплант..."
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">{t('characterEditModal.clothingLabel')}</label>
                <input
                  type="text"
                  value={charData.appearance?.clothing || ''}
                  onChange={(e) => setCharData({
                    ...charData,
                    appearance: { ...(charData.appearance || {}), clothing: e.target.value }
                  })}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white"
                  placeholder="Довгий плащ із оптоволоконної тканини, важкі черевики..."
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">{t('characterEditModal.distinguishingMarksLabel')}</label>
                <textarea
                  rows={2}
                  value={charData.appearance?.distinguishingMarks || ''}
                  onChange={(e) => setCharData({
                    ...charData,
                    appearance: { ...(charData.appearance || {}), distinguishingMarks: e.target.value }
                  })}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white"
                  placeholder="Платиновий порт зв'язку на правій скроні..."
                />
              </div>
            </div>
          )}

          {/* 3. PSYCHOLOGY & GOALS TAB */}
          {activeTab === 'psychology' && (
            <div className="space-y-4">
              <div>
                <label className="block text-slate-400 mb-1">{t('characterEditModal.motivationLabel')}</label>
                <textarea
                  rows={2}
                  value={charData.personality?.motivation || ''}
                  onChange={(e) => setCharData({
                    ...charData,
                    personality: { ...(charData.personality || { strengths: [], weaknesses: [], fears: [], desires: [], goals: [], motivation: '', internalConflict: '' }), motivation: e.target.value }
                  })}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white"
                  placeholder="Відновити правду про проект Оберіг та захистити спогади жителів міста..."
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">{t('characterEditModal.internalConflictLabel')}</label>
                <textarea
                  rows={2}
                  value={charData.personality?.internalConflict || ''}
                  onChange={(e) => setCharData({
                    ...charData,
                    personality: { ...(charData.personality || { strengths: [], weaknesses: [], fears: [], desires: [], goals: [], motivation: '', internalConflict: '' }), internalConflict: e.target.value }
                  })}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white"
                  placeholder="Коливання між безпекою власної кар'єри та совістю..."
                />
              </div>

              {/* Strengths */}
              <div>
                <label className="block text-slate-400 mb-1">{t('characterEditModal.strengthsLabel')}</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newStrength}
                    onChange={(e) => setNewStrength(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newStrength.trim()) {
                        e.preventDefault();
                        const p = charData.personality || { strengths: [], weaknesses: [], fears: [], desires: [], goals: [], motivation: '', internalConflict: '' };
                        setCharData({
                          ...charData,
                          personality: { ...p, strengths: [...(p.strengths || []), newStrength.trim()] }
                        });
                        setNewStrength('');
                      }
                    }}
                    placeholder={t('characterEditModal.addTraitPlaceholder')}
                    className="flex-1 p-2 rounded-lg bg-slate-900 border border-slate-800 text-white"
                  />
                  <button
                    onClick={() => {
                      if (!newStrength.trim()) return;
                      const p = charData.personality || { strengths: [], weaknesses: [], fears: [], desires: [], goals: [], motivation: '', internalConflict: '' };
                      setCharData({
                        ...charData,
                        personality: { ...p, strengths: [...(p.strengths || []), newStrength.trim()] }
                      });
                      setNewStrength('');
                    }}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 font-bold"
                  >
                    +
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(charData.personality?.strengths || []).map((s, idx) => (
                    <span key={idx} className="px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                      <span>{s}</span>
                      <button
                        onClick={() => {
                          const p = charData.personality!;
                          setCharData({
                            ...charData,
                            personality: { ...p, strengths: p.strengths.filter((_, i) => i !== idx) }
                          });
                        }}
                        className="hover:text-white"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 4. BIOGRAPHY & TAGS TAB */}
          {activeTab === 'biography' && (
            <div className="space-y-4">
              <div>
                <label className="block text-slate-400 mb-1">{t('characterEditModal.biographyLabel')}</label>
                <textarea
                  rows={6}
                  value={charData.biography || ''}
                  onChange={(e) => setCharData({ ...charData, biography: e.target.value })}
                  className="w-full p-3 rounded-xl bg-slate-900 border border-slate-800 text-white font-serif-book leading-relaxed focus:border-amber-400 focus:outline-hidden"
                  placeholder={t('characterEditModal.biographyPlaceholder')}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">{t('characterEditModal.characterTagsLabel')}</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTag.trim()) {
                        e.preventDefault();
                        setCharData({ ...charData, tags: [...(charData.tags || []), newTag.trim()] });
                        setNewTag('');
                      }
                    }}
                    placeholder={t('characterEditModal.addTagPlaceholder')}
                    className="flex-1 p-2 rounded-lg bg-slate-900 border border-slate-800 text-white"
                  />
                  <button
                    onClick={() => {
                      if (!newTag.trim()) return;
                      setCharData({ ...charData, tags: [...(charData.tags || []), newTag.trim()] });
                      setNewTag('');
                    }}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 font-bold"
                  >
                    +
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(charData.tags || []).map((tag, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      <span>{tag}</span>
                      <button
                        onClick={() => setCharData({ ...charData, tags: charData.tags.filter((_, i) => i !== idx) })}
                        className="hover:text-white ml-0.5"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Поведінкові шаблони персонажа в діалогах */}
              <div className="pt-2 border-t border-slate-800">
                <label className="block text-slate-400 mb-1">
                  {t('characterEditModal.behaviorPatternsLabel')}
                </label>
                <textarea
                  rows={5}
                  value={(charData.behaviorPatterns || []).join('\n')}
                  onChange={(e) =>
                    setCharData({
                      ...charData,
                      behaviorPatterns: e.target.value
                        .split(/\n|[;|]/)
                        .map((s) => s.trim())
                        .filter((s) => s.length > 0),
                    })
                  }
                  className="w-full p-3 rounded-xl bg-slate-900 border border-slate-800 text-white font-serif-book leading-relaxed focus:border-amber-400 focus:outline-hidden"
                  placeholder={t('characterEditModal.behaviorPatternsPlaceholder')}
                />
                <p className="text-[10px] text-slate-500 mt-1">{t('characterEditModal.behaviorPatternsHint')}</p>
              </div>
            </div>
          )}

          {/* 5. CONSISTENCY GUARDIAN TAB */}
          {activeTab === 'consistency' && (
            <div className="space-y-4">
              <p className="text-slate-400 leading-relaxed">{t('characterEditModal.consistencyIntro')}</p>

              <button
                type="button"
                onClick={handleCheckConsistency}
                disabled={isCheckingConsistency}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold transition-all shadow-sm active:scale-95 disabled:opacity-50"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{isCheckingConsistency ? t('characterEditModal.consistencyChecking') : t('characterEditModal.consistencyCheckBtn')}</span>
              </button>

              {consistencyError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{consistencyError}</span>
                </div>
              )}

              {consistencyResult && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <h4 className="text-slate-400 font-semibold mb-1">{t('characterEditModal.consistencySummaryTitle')}</h4>
                    <p className="text-slate-200 leading-relaxed">{consistencyResult.summary}</p>
                  </div>

                  <div>
                    <h4 className="text-slate-400 font-semibold mb-2">{t('characterEditModal.consistencyFindingsTitle')}</h4>
                    {consistencyResult.findings.length === 0 ? (
                      <p className="text-slate-500">{t('characterEditModal.consistencyNoFindings')}</p>
                    ) : (
                      <div className="space-y-2">
                        {consistencyResult.findings.map((f, idx) => (
                          <div key={idx} className={`p-3 rounded-xl border ${CONSISTENCY_SEVERITY_CLS[f.severity]}`}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-bold">{f.field}</span>
                              <span className="px-2 py-0.5 rounded-md border border-current/40 text-[10px] uppercase tracking-wide">
                                {t(`characterEditModal.consistencySeverity${f.severity.charAt(0).toUpperCase()}${f.severity.slice(1)}`)}
                              </span>
                            </div>
                            <p className="text-slate-300 mb-1">{f.issue}</p>
                            {f.location && (
                              <p className="text-[11px] text-slate-500">
                                <span className="font-semibold">{t('characterEditModal.consistencyLocationPrefix')}</span> {f.location}
                              </p>
                            )}
                            {f.quote && (
                              <p className="text-[11px] text-slate-500 italic">
                                <span className="font-semibold not-italic">{t('characterEditModal.consistencyQuotePrefix')}</span> «{f.quote}»
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 6. BEHAVIOR DRIFT TAB */}
          {activeTab === 'drift' && (
            <div className="space-y-4">
              <p className="text-slate-400 leading-relaxed">{t('characterEditModal.driftIntro')}</p>

              <button
                type="button"
                onClick={handleCheckDrift}
                disabled={isCheckingDrift}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold transition-all shadow-sm active:scale-95 disabled:opacity-50"
              >
                <Activity className="w-4 h-4" />
                <span>{isCheckingDrift ? t('characterEditModal.driftChecking') : t('characterEditModal.driftCheckBtn')}</span>
              </button>

              {driftError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{driftError}</span>
                </div>
              )}

              {driftResult && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <h4 className="text-slate-400 font-semibold mb-1">{t('characterEditModal.driftSummaryTitle')}</h4>
                    <p className="text-slate-200 leading-relaxed">{driftResult.summary}</p>
                  </div>

                  <div className="space-y-2">
                    {driftResult.patterns.map((p, idx) => (
                      <div key={idx} className={`p-3 rounded-xl border ${DRIFT_STATUS_CLS[p.status]}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-bold">{p.pattern}</span>
                          <span className="px-2 py-0.5 rounded-md border border-current/40 text-[10px] uppercase tracking-wide shrink-0">
                            {t(`characterEditModal.driftStatus${p.status.charAt(0).toUpperCase()}${p.status.slice(1)}`)}
                          </span>
                        </div>
                        {p.note && <p className="text-slate-300 mb-1">{p.note}</p>}
                        {p.location && (
                          <p className="text-[11px] text-slate-500">
                            <span className="font-semibold">{t('characterEditModal.consistencyLocationPrefix')}</span> {p.location}
                          </p>
                        )}
                        {p.quote && (
                          <p className="text-[11px] text-slate-500 italic">
                            <span className="font-semibold not-italic">{t('characterEditModal.consistencyQuotePrefix')}</span> «{p.quote}»
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-colors"
          >
            {t('characterEditModal.cancelBtn')}
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-all shadow-md active:scale-95"
          >
            <Save className="w-4 h-4" />
            <span>{t('characterEditModal.saveCharacterChangesBtn')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
