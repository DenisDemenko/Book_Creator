import React, { useState } from 'react';
import { 
  X, 
  Check, 
  UserPlus, 
  Users, 
  Sparkles, 
  Search, 
  Plus, 
  ShieldAlert, 
  UserCheck 
} from 'lucide-react';
import { Character, CharacterInScene } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface AddParticipantsModalProps {
  allCharacters: Character[];
  currentSceneCharacters: CharacterInScene[];
  chapterTitle: string;
  sectionTitle: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (
    updatedParticipants: CharacterInScene[],
    logInfo: { chapterTitle: string; sectionTitle: string; addedCharacterNames: string[] }
  ) => void;
  onCreateNewCharacter?: () => void;
}

export const AddParticipantsModal: React.FC<AddParticipantsModalProps> = ({
  allCharacters,
  currentSceneCharacters,
  chapterTitle,
  sectionTitle,
  isOpen,
  onClose,
  onConfirm,
  onCreateNewCharacter,
}) => {
  const { t } = useLanguage();

  if (!isOpen) return null;

  const [searchQuery, setSearchQuery] = useState('');
  // Map of characterId -> CharacterInScene object
  const [selectedMap, setSelectedMap] = useState<Record<string, CharacterInScene>>(() => {
    const map: Record<string, CharacterInScene> = {};
    currentSceneCharacters.forEach((item) => {
      map[item.characterId] = { ...item };
    });
    return map;
  });

  const toggleCharacter = (char: Character) => {
    setSelectedMap((prev) => {
      const next = { ...prev };
      if (next[char.id]) {
        delete next[char.id];
      } else {
        next[char.id] = {
          characterId: char.id,
          goal: `Діє згідно з мотивацією: ${char.personality?.motivation || 'Участь у подіях сцени'}`,
          emotionalState: 'Зосереджений',
          action: 'Бере активну участь у діалозі / дії',
          conflict: char.personality?.internalConflict || 'Локальна напруга у сцені',
        };
      }
      return next;
    });
  };

  const handleApply = () => {
    const updatedParticipants: CharacterInScene[] = Object.values(selectedMap);
    const addedNames = updatedParticipants.map((p) => {
      const char = allCharacters.find((c) => c.id === p.characterId);
      return char ? `${char.name} ${char.surname || ''}`.trim() : 'Персонаж';
    });

    onConfirm(updatedParticipants, {
      chapterTitle,
      sectionTitle,
      addedCharacterNames: addedNames,
    });
    onClose();
  };

  const filteredCharacters = allCharacters.filter((c) => {
    const q = searchQuery.toLowerCase();
    const fullName = `${c.name} ${c.surname || ''} ${c.alias || ''}`.toLowerCase();
    return fullName.includes(q) || (c.tags || []).some((t) => t.toLowerCase().includes(q));
  });

  const roleBadges: Record<Character['role'], { label: string; color: string }> = {
    protagonist: { label: t('addParticipantsModal.roleProtagonist'), color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
    antagonist: { label: t('addParticipantsModal.roleAntagonist'), color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
    deuteragonist: { label: t('addParticipantsModal.roleDeuteragonist'), color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
    mentor: { label: t('addParticipantsModal.roleMentor'), color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
    ally: { label: t('addParticipantsModal.roleAlly'), color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
    rival: { label: t('addParticipantsModal.roleRival'), color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
    minor: { label: t('addParticipantsModal.roleMinor'), color: 'bg-slate-700/50 text-slate-300 border-slate-600' },
  };

  const selectedCount = Object.keys(selectedMap).length;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-950 border border-slate-800 rounded-2xl max-w-xl w-full flex flex-col max-h-[85vh] shadow-2xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {t('addParticipantsModal.modalTitle')}
              </h3>
              <p className="text-xs text-slate-400">
                {sectionTitle} • <span className="text-slate-300">{chapterTitle}</span>
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

        {/* Search and Action Bar */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-950 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('addParticipantsModal.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-amber-400 focus:outline-hidden"
            />
          </div>

          {onCreateNewCharacter && (
            <button
              onClick={() => {
                onClose();
                onCreateNewCharacter();
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-amber-400 whitespace-nowrap transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('addParticipantsModal.newCharacterBtn')}</span>
            </button>
          )}
        </div>

        {/* Character List with small photos */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 text-xs">
          {filteredCharacters.length === 0 ? (
            <div className="p-8 text-center text-slate-500 space-y-2">
              <Users className="w-8 h-8 mx-auto text-slate-600" />
              <p>{t('addParticipantsModal.emptyStateText')}</p>
            </div>
          ) : (
            filteredCharacters.map((char) => {
              const isSelected = !!selectedMap[char.id];
              const badge = roleBadges[char.role] || roleBadges.minor;

              return (
                <div
                  key={char.id}
                  onClick={() => toggleCharacter(char)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-amber-500/10 border-amber-500/50 text-white shadow-sm'
                      : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Small Avatar Thumbnail */}
                    {char.avatarUrl ? (
                      <img
                        src={char.avatarUrl}
                        alt={char.name}
                        className="w-10 h-10 rounded-xl object-cover border border-slate-700 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400 font-bold shrink-0">
                        {char.name.charAt(0)}
                      </div>
                    )}

                    {/* Info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-100 text-sm">
                          {char.name} {char.surname || ''}
                        </span>
                        {char.alias && (
                          <span className="text-slate-400 text-xs italic">
                            («{char.alias}»)
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${badge.color}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {char.profession || char.biography || t('addParticipantsModal.fallbackCharacterDesc')}
                      </p>
                    </div>
                  </div>

                  {/* Selection Checkbox Pill */}
                  <div className="shrink-0 flex items-center">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all ${
                        isSelected
                          ? 'bg-amber-500 border-amber-400 text-slate-950'
                          : 'bg-slate-950 border-slate-800 text-transparent'
                      }`}
                    >
                      <Check className="w-4 h-4 stroke-[3]" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer with Audit Log info notice */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>
              {t('addParticipantsModal.selectedCountPrefix')} <b className="text-white font-mono">{selectedCount}</b>. {t('addParticipantsModal.selectedCountSuffix')}
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
            >
              {t('addParticipantsModal.cancelBtn')}
            </button>

            <button
              onClick={handleApply}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-all shadow-md active:scale-95"
            >
              <UserCheck className="w-4 h-4" />
              <span>{t('addParticipantsModal.confirmBtn')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
