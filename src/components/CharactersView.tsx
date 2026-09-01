import React, { useState, useMemo } from 'react';
import { 
  Users, 
  UserPlus, 
  Sparkles, 
  Heart, 
  ShieldAlert, 
  Smile, 
  Zap, 
  Trash2, 
  Edit3, 
  Image as ImageIcon, 
  Layers, 
  HeartHandshake, 
  Swords, 
  EyeOff, 
  Check, 
  Wand2,
  Tag,
  Share2,
  Save,
  Plus,
  X,
  UserCheck,
  BrainCircuit,
  Eye,
  Shirt,
  Sparkle,
  Flower2,
  Gauge
} from 'lucide-react';
import { Book, Character, CharacterRelationship } from '../types';
import { normalizeCharacter, normalizeCharacterOrUndefined } from '../utils/characterNormalize';
import { GenerateCharacterModal } from './GenerateCharacterModal';
import { useLanguage } from '../i18n/LanguageContext';
import { computeAllCharacterDensities, type DensityLabel } from '../utils/characterDensity';

/** Ключ перекладу й колір смужки-індикатора для кожного рівня густоти втілення персонажа в тексті. */
const DENSITY_LABEL_KEY: Record<DensityLabel, string> = {
  faint: 'charactersView.densityFaint',
  sketch: 'charactersView.densitySketch',
  present: 'charactersView.densityPresent',
  vivid: 'charactersView.densityVivid',
};
const DENSITY_BAR_CLS: Record<DensityLabel, string> = {
  faint: 'bg-slate-600',
  sketch: 'bg-amber-400',
  present: 'bg-emerald-400',
  vivid: 'bg-violet-400',
};

interface CharactersViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onSaveBook?: () => void;
}

export const CharactersView: React.FC<CharactersViewProps> = ({ 
  book, 
  onUpdateBook,
  onSaveBook
}) => {
  const { t } = useLanguage();
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>(book.characters[0]?.id || '');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiPromptRole, setAiPromptRole] = useState<'protagonist' | 'antagonist' | 'mentor' | 'ally' | 'rival'>('antagonist');
  const [aiPromptDesc, setAiPromptDesc] = useState('');
  const [activeTab, setActiveTab] = useState<'dossier' | 'psychology' | 'appearance' | 'relationships' | 'skandhas' | 'generator'>('dossier');

  // AI: 5 скандх (буддійська модель персонажа)
  const [isGeneratingSkandhas, setIsGeneratingSkandhas] = useState(false);
  const [skandhasAiError, setSkandhasAiError] = useState<string | null>(null);
  const [skandhaEvent, setSkandhaEvent] = useState('');
  const [skandhaCycleSteps, setSkandhaCycleSteps] = useState<{ label: string; text: string }[] | null>(null);
  const [isGeneratingCycle, setIsGeneratingCycle] = useState(false);
  const [cycleAiError, setCycleAiError] = useState<string | null>(null);
  
  // AI Art Generator Modal state
  const [showGenerateModal, setShowGenerateModal] = useState<boolean>(false);
  const [charToEnhanceWithArt, setCharToEnhanceWithArt] = useState<Character | null>(null);

  // Local temporary tag input
  const [newTagInput, setNewTagInput] = useState<string>('');
  const [newStrengthInput, setNewStrengthInput] = useState<string>('');
  const [newWeaknessInput, setNewWeaknessInput] = useState<string>('');
  const [newFearInput, setNewFearInput] = useState<string>('');
  const [newGoalInput, setNewGoalInput] = useState<string>('');
  // Окреме поле додавання власного шаблону поведінки
  const [newPatternInput, setNewPatternInput] = useState<string>('');
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<boolean>(false);
  // AI генерація характерних шаблонів поведінки в діалогах
  const [isGeneratingPatterns, setIsGeneratingPatterns] = useState<boolean>(false);
  const [patternsAiError, setPatternsAiError] = useState<string | null>(null);

  // normalizeCharacterOrUndefined: рятує від краху вкладки персонажі, ЯКІ
  // ВЖЕ збережені без tags/personality.goals тощо (з часів до виправлення
  // джерела в GenerateCharacterModal.tsx/handleAiGenerateCharacter вище) —
  // без цього selectedChar.tags.map(...) і подібні виклики нижче кидають
  // TypeError, і крах підхоплює ErrorBoundary для всієї вкладки.
  const selectedChar = normalizeCharacterOrUndefined(
    book.characters.find((c) => c.id === selectedCharacterId) || book.characters[0]
  );

  // «Густота втілення» — суто обчислювана (без AI) метрика присутності
  // персонажа в реальному тексті книги, а не лише в картці. Рахується для
  // ВСІХ персонажів одразу (список карток) і повторно береться для того,
  // хто зараз відкритий у вкладці «Досьє». `useMemo` на `book` — інакше
  // regex-прохід по всій книзі повторювався б на кожен рендер картки.
  const densityByCharId = useMemo(() => computeAllCharacterDensities(book, book.characters), [book]);
  const selectedCharDensity = selectedChar ? densityByCharId.get(selectedChar.id) : undefined;

  // Trigger manual save
  const handleSaveClick = () => {
    if (onSaveBook) {
      onSaveBook();
    }
    setSaveSuccessNotice(true);
    setTimeout(() => setSaveSuccessNotice(false), 2000);
  };

  // Update character
  const handleUpdateCharacter = (updated: Character, reason?: string) => {
    const updatedList = book.characters.map((c) => (c.id === updated.id ? updated : c));
    onUpdateBook(
      { ...book, characters: updatedList },
      'Зміна персонажа',
      reason || `Оновлено дані героя ${updated.name} ${updated.surname || ''} (${updated.role})`
    );
  };

  // Add new empty character
  const handleAddNewCharacter = () => {
    const newId = `char-${Date.now()}`;
    const newChar: Character = {
      id: newId,
      bookId: book.id,
      name: 'Новий',
      surname: 'Герой',
      alias: 'Незнайомець',
      role: 'ally',
      age: 28,
      gender: 'Чоловіча',
      profession: 'Мандрівник / Спеціаліст',
      appearance: {
        height: '180 см',
        build: 'Атлетична',
        hair: 'Темне',
        eyes: 'Карі',
        clothing: 'Практичний міський одяг',
        distinguishingMarks: 'Невеликий шрам',
      },
      personality: {
        strengths: ['Цілеспрямованість', 'Вірність слову'],
        weaknesses: ['Впертість'],
        fears: ['Зрада близьких'],
        desires: ['Справедливість'],
        goals: ['Знайти істину'],
        motivation: 'Бажання захистити рідне місто',
        internalConflict: 'Вибір між обовʼязком та особистими почуттями',
      },
      biography: 'Опис життєвого шляху та передісторії нового героя...',
      relationships: [],
      tags: ['Новий персонаж', 'Головна лінія'],
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=600&q=80',
    };

    const updatedList = [...book.characters, newChar];
    onUpdateBook(
      { ...book, characters: updatedList },
      'Створення персонажа',
      `Додано нового персонажа: ${newChar.name} (${newChar.role})`
    );
    setSelectedCharacterId(newId);
    setActiveTab('dossier');
  };

  // Delete character
  const handleDeleteCharacter = (charId: string) => {
    if (book.characters.length <= 1) {
      alert(t('charactersView.minOneCharacterAlert'));
      return;
    }
    const targetChar = book.characters.find((c) => c.id === charId);
    const filtered = book.characters.filter((c) => c.id !== charId);
    onUpdateBook(
      { ...book, characters: filtered },
      'Видалення персонажа',
      `Видалено героя: ${targetChar?.name || charId}`
    );
    setSelectedCharacterId(filtered[0].id);
  };

  // Auto-generate character with AI
  const handleAiGenerateCharacter = async () => {
    setIsGeneratingAi(true);
    try {
      const res = await fetch('/api/ai/generate-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: aiPromptRole,
          promptDescription: aiPromptDesc || `Харизматичний ${aiPromptRole} для книги ${book.title}`,
          genre: book.genre,
        }),
      });

      const data = await res.json();
      if (data.name) {
        // normalizeCharacter замість `data.personality || {дефолт}`: останнє
        // не рятує, якщо модель повернула ЧАСТКОВИЙ об'єкт (є strengths,
        // немає goals) — весь об'єкт лишається «правдивим», і повний
        // дефолт-фолбек просто не спрацьовує, а рендер картки персонажа
        // однаково падає на відсутньому полі.
        const newChar: Character = normalizeCharacter({
          id: `char-${Date.now()}`,
          bookId: book.id,
          name: data.name,
          surname: data.surname || '',
          alias: data.alias || '',
          role: data.role || aiPromptRole,
          age: data.age || 30,
          gender: data.gender || 'Жіноча',
          profession: data.profession || 'Фахівець',
          appearance: data.appearance || {
            height: '175 см',
            build: 'Струнка',
            hair: 'Попелясте',
            eyes: 'Зелені',
            clothing: 'Футуристичний тренч',
          },
          personality: data.personality || {
            strengths: ['Гострий розум', 'Інтуїція'],
            weaknesses: ['Саркастичність'],
            fears: ['Втрата контролю'],
            desires: ['Свобода'],
            goals: ['Розкрити таємницю'],
            motivation: 'Пошук правди',
            internalConflict: 'Тягар минулих помилок',
          },
          biography: data.biography || 'Детальна передісторія персонажа...',
          relationships: [],
          tags: data.tags?.length ? data.tags : ['AI Створено', 'Ключовий герой'],
          avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
        });

        const updatedList = [...book.characters, newChar];
        onUpdateBook(
          { ...book, characters: updatedList },
          'AI Генерація персонажа',
          `Згенеровано ШІ персонажа: ${newChar.name} ${newChar.surname} (${newChar.role})`
        );
        setSelectedCharacterId(newChar.id);
        setActiveTab('dossier');
        setAiPromptDesc('');
      }
    } catch (err) {
      console.error('Error generating character:', err);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // Add relationship
  const handleAddRelationship = (targetId: string, type: CharacterRelationship['type']) => {
    if (!selectedChar || selectedChar.id === targetId) return;
    const existing = selectedChar.relationships.find((r) => r.targetCharacterId === targetId);
    if (existing) return;

    const newRel: CharacterRelationship = {
      targetCharacterId: targetId,
      type: type,
      description: 'Опис взаємин та динаміки...',
    };

    handleUpdateCharacter(
      {
        ...selectedChar,
        relationships: [...selectedChar.relationships, newRel],
      },
      `Додано зв'язок персонажа ${selectedChar.name}`
    );
  };

  // Remove relationship
  const handleRemoveRelationship = (targetId: string) => {
    if (!selectedChar) return;
    handleUpdateCharacter(
      {
        ...selectedChar,
        relationships: selectedChar.relationships.filter((r) => r.targetCharacterId !== targetId),
      },
      `Видалено зв'язок персонажа ${selectedChar.name}`
    );
  };

  // Add personality trait helper
  const handleAddPersonalityTrait = (
    field: 'strengths' | 'weaknesses' | 'fears' | 'goals',
    val: string
  ) => {
    if (!selectedChar || !val.trim()) return;
    const currentList = selectedChar.personality[field] || [];
    if (currentList.includes(val.trim())) return;

    handleUpdateCharacter({
      ...selectedChar,
      personality: {
        ...selectedChar.personality,
        [field]: [...currentList, val.trim()],
      },
    });
  };

  // Remove personality trait helper
  const handleRemovePersonalityTrait = (
    field: 'strengths' | 'weaknesses' | 'fears' | 'goals',
    idx: number
  ) => {
    if (!selectedChar) return;
    const currentList = selectedChar.personality[field] || [];
    handleUpdateCharacter({
      ...selectedChar,
      personality: {
        ...selectedChar.personality,
        [field]: currentList.filter((_, i) => i !== idx),
      },
    });
  };

  // ---- Характерні шаблони поведінки в діалогах ----

  /** Розбирає введений текст на окремі шаблони за роздільниками
   *  (новий рядок, «;», «|», «.», «!», «?» — але крапку лишаємо в кінці
   *  речення, тож ділимо лише за \n, ; та |). */
  const parseBehaviorPatterns = (raw: string): string[] =>
    raw
      .split(/\n|[;|]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  /** Оновлює поведінкові шаблони з текстового поля (кожен рядок — шаблон). */
  const handleBehaviorPatternsChange = (raw: string) => {
    if (!selectedChar) return;
    handleUpdateCharacter({
      ...selectedChar,
      behaviorPatterns: parseBehaviorPatterns(raw),
    });
  };

  /** Додає окремий шаблон до списку. */
  const handleAddBehaviorPattern = (pattern: string) => {
    if (!selectedChar || !pattern.trim()) return;
    const current = selectedChar.behaviorPatterns || [];
    handleUpdateCharacter({
      ...selectedChar,
      behaviorPatterns: [...current, pattern.trim()],
    });
  };

  /** Видаляє окремий шаблон зі списку. */
  const handleRemoveBehaviorPattern = (idx: number) => {
    if (!selectedChar) return;
    const current = selectedChar.behaviorPatterns || [];
    handleUpdateCharacter({
      ...selectedChar,
      behaviorPatterns: current.filter((_, i) => i !== idx),
    });
  };

  /**
   * AI-генерація шаблонів поведінки персонажа в діалогах. Якщо в
   * персонажа задано Big Five — сервер повертає бібліотеку патернів,
   * згруповану за 5 ситуаційними тригерами, замість вільного списку.
   */
  const handleAiGenerateBehaviorPatterns = async () => {
    if (!selectedChar || isGeneratingPatterns) return;
    setIsGeneratingPatterns(true);
    setPatternsAiError(null);
    try {
      const res = await fetch('/api/ai/generate-behavior-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${selectedChar.name} ${selectedChar.surname || ''}`.trim(),
          alias: selectedChar.alias || '',
          role: selectedChar.role,
          genre: book.genre,
          biography: selectedChar.biography,
          personality: selectedChar.personality,
          bigFive: selectedChar.bigFive || null,
          profession: selectedChar.profession,
          count: 8,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPatternsAiError(data?.error || t('charactersView.patternsAiError'));
        return;
      }
      if (data?.library) {
        const currentLib = selectedChar.behaviorPatternLibrary || [];
        const merged = (
          ['question', 'stress_conflict', 'lying_hiding', 'interest_sympathy', 'calm_conversation'] as const
        ).map((trigger) => {
          const existing = currentLib.find((g) => g.trigger === trigger)?.patterns || [];
          const fresh: string[] = Array.isArray(data.library[trigger]) ? data.library[trigger] : [];
          return { trigger, patterns: [...existing, ...fresh] };
        });
        handleUpdateCharacter(
          { ...selectedChar, behaviorPatternLibrary: merged },
          `Згенеровано AI бібліотеку патернів поведінки персонажа ${selectedChar.name}`
        );
      } else if (Array.isArray(data?.patterns) && data.patterns.length > 0) {
        const current = selectedChar.behaviorPatterns || [];
        handleUpdateCharacter(
          {
            ...selectedChar,
            behaviorPatterns: [...current, ...data.patterns],
          },
          `Згенеровано AI шаблони поведінки персонажа ${selectedChar.name}`
        );
      }
    } catch (err) {
      console.error('Error generating behavior patterns:', err);
      setPatternsAiError(t('charactersView.patternsAiError'));
    } finally {
      setIsGeneratingPatterns(false);
    }
  };

  // ---- 5 скандх (буддійська модель персонажа) ----

  /** Оновлює одне поле скандх персонажа. */
  const handleUpdateSkandha = (field: 'rupa' | 'vedana' | 'sanjna' | 'sankhara' | 'vinnana', value: string) => {
    if (!selectedChar) return;
    handleUpdateCharacter({
      ...selectedChar,
      skandhas: {
        rupa: selectedChar.skandhas?.rupa || '',
        vedana: selectedChar.skandhas?.vedana || '',
        sanjna: selectedChar.skandhas?.sanjna || '',
        sankhara: selectedChar.skandhas?.sankhara || '',
        vinnana: selectedChar.skandhas?.vinnana || '',
        [field]: value,
      },
    });
  };

  /** AI-аналіз персонажа через 5 скандх — заповнює всі 5 полів разом. */
  const handleAiGenerateSkandhas = async () => {
    if (!selectedChar || isGeneratingSkandhas) return;
    setIsGeneratingSkandhas(true);
    setSkandhasAiError(null);
    try {
      const res = await fetch('/api/ai/generate-skandhas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${selectedChar.name} ${selectedChar.surname || ''}`.trim(),
          role: selectedChar.role,
          genre: book.genre,
          biography: selectedChar.biography,
          personality: selectedChar.personality,
          bigFive: selectedChar.bigFive || null,
          bookId: book.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSkandhasAiError(data?.error || t('charactersView.skandhasAiError'));
        return;
      }
      if (data?.skandhas) {
        handleUpdateCharacter(
          { ...selectedChar, skandhas: data.skandhas },
          `Згенеровано AI-аналіз персонажа ${selectedChar.name} через 5 скандх`
        );
      }
    } catch (err) {
      console.error('Error generating skandhas:', err);
      setSkandhasAiError(t('charactersView.skandhasAiError'));
    } finally {
      setIsGeneratingSkandhas(false);
    }
  };

  /** Будує сценарний цикл реакції персонажа (Подія → Тіло → Відчуття → Інтерпретація → Імпульс → Дія → Нова подія). */
  const handleAiGenerateSkandhaCycle = async () => {
    if (!selectedChar || isGeneratingCycle || !skandhaEvent.trim()) return;
    setIsGeneratingCycle(true);
    setCycleAiError(null);
    try {
      const res = await fetch('/api/ai/generate-skandha-cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${selectedChar.name} ${selectedChar.surname || ''}`.trim(),
          skandhas: selectedChar.skandhas || {},
          event: skandhaEvent,
          bookId: book.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCycleAiError(data?.error || t('charactersView.skandhaCycleAiError'));
        return;
      }
      setSkandhaCycleSteps(Array.isArray(data?.steps) ? data.steps : []);
    } catch (err) {
      console.error('Error generating skandha cycle:', err);
      setCycleAiError(t('charactersView.skandhaCycleAiError'));
    } finally {
      setIsGeneratingCycle(false);
    }
  };

  const BEHAVIOR_TRIGGER_LABELS: Record<string, string> = {
    question: 'На запитання співрозмовника',
    stress_conflict: 'У стресі / конфлікті',
    lying_hiding: 'Коли бреше або приховує',
    interest_sympathy: 'Коли зацікавлений або симпатизує',
    calm_conversation: 'У спокійній розмові',
  };

  /** Видаляє один патерн з бібліотеки за тригером. */
  const handleRemoveLibraryPattern = (trigger: string, idx: number) => {
    if (!selectedChar) return;
    const lib = selectedChar.behaviorPatternLibrary || [];
    handleUpdateCharacter({
      ...selectedChar,
      behaviorPatternLibrary: lib.map((g) =>
        g.trigger === trigger ? { ...g, patterns: g.patterns.filter((_, i) => i !== idx) } : g
      ),
    });
  };

  const getRoleBadge = (role: Character['role']) => {
    switch (role) {
      case 'protagonist':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">{t('charactersView.roleProtagonistBadge')}</span>;
      case 'antagonist':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">{t('charactersView.roleAntagonistBadge')}</span>;
      case 'mentor':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">{t('charactersView.roleMentorBadge')}</span>;
      case 'ally':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">{t('charactersView.roleAllyBadge')}</span>;
      case 'rival':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">{t('charactersView.roleRivalBadge')}</span>;
      default:
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">{t('charactersView.roleMinorBadge')}</span>;
    }
  };

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto bg-slate-950 text-slate-100 space-y-6">
      
      {/* Top Banner */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 text-amber-400 border border-slate-700">
              {t('charactersView.headerBadge')}
            </span>
            <span className="text-xs text-slate-400">
              {t('charactersView.headerSubBadge')}
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 font-heading">
            {t('charactersView.headerTitle', { title: book.title, n: String(book.characters.length) })}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Main Save Button */}
          <button
            onClick={handleSaveClick}
            data-tour="characters__1"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors whitespace-nowrap"
            title={t('charactersView.saveAllTooltip')}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saveSuccessNotice ? t('charactersView.savedNotice') : t('charactersView.saveChangesBtn')}</span>
          </button>

          <button
            onClick={() => {
              setCharToEnhanceWithArt(null);
              setShowGenerateModal(true);
            }}
            data-tour="characters__2"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-md transition-all active:scale-95"
            title={t('charactersView.generateNewHeroTooltip')}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t('charactersView.generateNewHeroBtn')}</span>
          </button>

          <button
            onClick={handleAddNewCharacter}
            data-tour="characters__3"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5 text-slate-400" />
            <span>{t('charactersView.newCharacterBtn')}</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Left Characters list, Right Character Profile */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Character Cards (4 cols) */}
        <div className="lg:col-span-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1 flex items-center justify-between">
            <span>{t('charactersView.characterListLabel')}</span>
            <span className="text-[11px] text-slate-500">{t('charactersView.selectToEditHint')}</span>
          </div>

          <div className="space-y-2.5">
            {book.characters.map((char) => {
              const isSel = char.id === selectedChar?.id;
              const density = densityByCharId.get(char.id);
              return (
                <div
                  key={char.id}
                  onClick={() => {
                    setSelectedCharacterId(char.id);
                    if (activeTab === 'generator') setActiveTab('dossier');
                  }}
                  data-tour={isSel ? 'characters__4' : undefined}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition-all duration-200 flex items-center gap-3.5 ${
                    isSel
                      ? 'bg-slate-950 border-cyan-500/80 shadow-lg ring-1 ring-cyan-500/40'
                      : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-950/90'
                  }`}
                >
                  {/* Avatar */}
                  <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-slate-800 shrink-0 border border-slate-700">
                    {char.avatarUrl ? (
                      <img
                        src={char.avatarUrl}
                        alt={char.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center font-bold text-slate-500 text-lg">
                        {char.name[0]}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <h3 className="text-sm font-bold text-white truncate">
                        {char.name} {char.surname || ''}
                      </h3>
                      {getRoleBadge(char.role)}
                    </div>
                    <p className="text-xs text-slate-400 truncate">
                      {char.alias ? `«${char.alias}» • ` : ''}
                      {char.profession || t('charactersView.noProfessionFallback')}
                    </p>
                    {density && (
                      <div
                        className="mt-1.5 h-1 w-full rounded-full bg-slate-800/80 overflow-hidden"
                        title={t('charactersView.densityTooltip', {
                          score: density.score,
                          mentions: density.totalMentions,
                          chapters: density.chaptersWithMentions,
                          total: density.totalChapters,
                        })}
                      >
                        <div
                          className={`h-full rounded-full transition-all ${DENSITY_BAR_CLS[density.label]}`}
                          style={{ width: `${Math.max(4, density.score)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Character Tabs & Editors (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          
          {/* Sub Navigation Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveTab('dossier')}
              data-tour="characters__5"
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'dossier'
                  ? 'bg-slate-800 text-amber-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>{t('charactersView.tabDossier')}</span>
            </button>

            <button
              onClick={() => setActiveTab('psychology')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'psychology'
                  ? 'bg-slate-800 text-amber-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BrainCircuit className="w-3.5 h-3.5" />
              <span>{t('charactersView.tabPsychology')}</span>
            </button>

            <button
              onClick={() => setActiveTab('appearance')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'appearance'
                  ? 'bg-slate-800 text-amber-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{t('charactersView.tabAppearance')}</span>
            </button>

            <button
              onClick={() => setActiveTab('relationships')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'relationships'
                  ? 'bg-slate-800 text-amber-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <HeartHandshake className="w-3.5 h-3.5" />
              <span>{t('charactersView.tabRelationships', { n: String(selectedChar?.relationships.length || 0) })}</span>
            </button>

            <button
              onClick={() => setActiveTab('skandhas')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'skandhas'
                  ? 'bg-slate-800 text-amber-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Flower2 className="w-3.5 h-3.5 text-rose-300" />
              <span>{t('charactersView.tabSkandhas')}</span>
            </button>

            <button
              onClick={() => setActiveTab('generator')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'generator'
                  ? 'bg-slate-800 text-amber-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('charactersView.tabGenerator')}</span>
            </button>
          </div>

          {/* TAB 1: DOSSIER (Імена, прізвища, позивні, роль, біографія, теги) */}
          {activeTab === 'dossier' && selectedChar && (
            <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-6">
              
              {/* Header Info Bar */}
              <div className="flex flex-col sm:flex-row items-start justify-between gap-4 pb-4 border-b border-slate-800">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-slate-800 border border-slate-700 shrink-0">
                    <img
                      src={selectedChar.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=600&q=80'}
                      alt={selectedChar.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-slate-100">
                        {selectedChar.name} {selectedChar.surname || ''}
                      </h2>
                      {getRoleBadge(selectedChar.role)}
                    </div>
                    <p className="text-xs text-slate-400">
                      {t('charactersView.aliasLabel')}<span className="text-amber-400 font-mono">«{selectedChar.alias || '—'}»</span> • {selectedChar.age || 30} {t('charactersView.yearsAbbr')} • {selectedChar.profession}
                    </p>
                    {selectedCharDensity && (
                      <div
                        className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-800/70 border border-slate-700 text-[11px] text-slate-300"
                        title={t('charactersView.densityTooltip', {
                          score: selectedCharDensity.score,
                          mentions: selectedCharDensity.totalMentions,
                          chapters: selectedCharDensity.chaptersWithMentions,
                          total: selectedCharDensity.totalChapters,
                        })}
                      >
                        <Gauge className="w-3 h-3 text-slate-400" />
                        <span>{t('charactersView.densityLabel')}:</span>
                        <span className="font-mono font-bold text-slate-100">{selectedCharDensity.score}</span>
                        <span className="text-slate-500">— {t(DENSITY_LABEL_KEY[selectedCharDensity.label])}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveClick}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-colors"
                  >
                    <Save className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t('charactersView.saveBtn')}</span>
                  </button>

                  <button
                    onClick={() => handleDeleteCharacter(selectedChar.id)}
                    className="p-2 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-900 transition-all"
                    title={t('charactersView.deleteCharacterTooltip')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Character Identity Form (Клавіатура & Телефон) */}
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-slate-300 font-bold block mb-1">
                      {t('charactersView.nameLabelBare')} <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={selectedChar.name}
                      onChange={(e) => handleUpdateCharacter({ ...selectedChar, name: e.target.value })}
                      placeholder={t('charactersView.namePlaceholder')}
                      className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-400 text-white font-bold focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-slate-300 font-bold block mb-1">{t('charactersView.surnameLabel')}</label>
                    <input
                      type="text"
                      value={selectedChar.surname || ''}
                      onChange={(e) => handleUpdateCharacter({ ...selectedChar, surname: e.target.value })}
                      placeholder={t('charactersView.surnamePlaceholder')}
                      className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-400 text-slate-200 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-slate-300 font-bold block mb-1">{t('charactersView.aliasFieldLabel')}</label>
                    <input
                      type="text"
                      value={selectedChar.alias || ''}
                      onChange={(e) => handleUpdateCharacter({ ...selectedChar, alias: e.target.value })}
                      placeholder={t('charactersView.aliasPlaceholder')}
                      className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-400 text-cyan-300 focus:outline-hidden font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-slate-400 block mb-1">{t('charactersView.plotRoleLabel')}</label>
                    <select
                      value={selectedChar.role}
                      onChange={(e) => handleUpdateCharacter({ ...selectedChar, role: e.target.value as any })}
                      className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-400 text-slate-200 focus:outline-hidden"
                    >
                      <option value="protagonist">{t('charactersView.roleProtagonistOpt')}</option>
                      <option value="antagonist">{t('charactersView.roleAntagonistOpt')}</option>
                      <option value="deuteragonist">{t('charactersView.roleDeuteragonistOpt')}</option>
                      <option value="mentor">{t('charactersView.roleMentorOpt')}</option>
                      <option value="ally">{t('charactersView.roleAllyOpt')}</option>
                      <option value="rival">{t('charactersView.roleRivalOpt')}</option>
                      <option value="minor">{t('charactersView.roleMinorOpt')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">{t('charactersView.ageLabel')}</label>
                    <input
                      type="number"
                      value={selectedChar.age || 25}
                      onChange={(e) => handleUpdateCharacter({ ...selectedChar, age: parseInt(e.target.value) || 0 })}
                      className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-400 text-slate-200 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">{t('charactersView.genderLabel')}</label>
                    <input
                      type="text"
                      value={selectedChar.gender || 'Чоловіча'}
                      onChange={(e) => handleUpdateCharacter({ ...selectedChar, gender: e.target.value })}
                      placeholder={t('charactersView.genderPlaceholder')}
                      className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-400 text-slate-200 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">{t('charactersView.professionLabel')}</label>
                    <input
                      type="text"
                      value={selectedChar.profession || ''}
                      onChange={(e) => handleUpdateCharacter({ ...selectedChar, profession: e.target.value })}
                      placeholder={t('charactersView.professionPlaceholder')}
                      className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-400 text-slate-200 focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Avatar URL editor */}
                <div>
                  <label className="text-slate-400 block mb-1">{t('charactersView.avatarUrlLabel')}</label>
                  <input
                    type="text"
                    value={selectedChar.avatarUrl || ''}
                    onChange={(e) => handleUpdateCharacter({ ...selectedChar, avatarUrl: e.target.value })}
                    placeholder="https://images.unsplash.com/..."
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-400 text-slate-300 font-mono text-[11px] focus:outline-hidden"
                  />
                </div>

                {/* Biography Textarea */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-300 font-bold block">
                      {t('charactersView.biographyLabel')}
                    </label>
                    <span className="text-[11px] text-slate-500">{t('charactersView.biographyHint')}</span>
                  </div>
                  <textarea
                    rows={5}
                    value={selectedChar.biography}
                    onChange={(e) => handleUpdateCharacter({ ...selectedChar, biography: e.target.value })}
                    placeholder={t('charactersView.biographyPlaceholder')}
                    className="w-full p-3 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-400 text-slate-200 leading-relaxed text-xs focus:outline-hidden"
                  />
                </div>

                {/* Tags Management */}
                <div>
                  <label className="text-slate-400 block mb-1.5">{t('charactersView.characterTagsLabel')}</label>
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {selectedChar.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 text-cyan-300 border border-slate-700 text-[11px] flex items-center gap-1"
                      >
                        <Tag className="w-3 h-3 text-cyan-400" />
                        <span>{tag}</span>
                        <button
                          onClick={() => {
                            const newTags = selectedChar.tags.filter((_, i) => i !== idx);
                            handleUpdateCharacter({ ...selectedChar, tags: newTags });
                          }}
                          className="hover:text-rose-400 ml-1"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 max-w-md">
                    <input
                      type="text"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newTagInput.trim()) {
                          handleUpdateCharacter({
                            ...selectedChar,
                            tags: [...selectedChar.tags, newTagInput.trim()],
                          });
                          setNewTagInput('');
                        }
                      }}
                      placeholder={t('charactersView.addTagPlaceholder')}
                      className="flex-1 p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-cyan-400 focus:outline-hidden"
                    />
                    <button
                      onClick={() => {
                        if (newTagInput.trim()) {
                          handleUpdateCharacter({
                            ...selectedChar,
                            tags: [...selectedChar.tags, newTagInput.trim()],
                          });
                          setNewTagInput('');
                        }
                      }}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold border border-slate-700"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Поведінкові шаблони персонажа в діалогах (знизу вікна) */}
                <div className="pt-3 border-t border-slate-800/70">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Wand2 className="w-4 h-4 text-violet-400 shrink-0" />
                      <label className="text-slate-300 font-bold block">
                        {t('charactersView.behaviorPatternsLabel')}
                      </label>
                      <span className="px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/30 text-violet-300 text-[10px] font-bold shrink-0">
                        {(selectedChar.behaviorPatterns || []).length}
                      </span>
                    </div>

                    <button
                      onClick={handleAiGenerateBehaviorPatterns}
                      disabled={isGeneratingPatterns}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-400 hover:to-fuchsia-400 text-white font-bold text-[11px] shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t('charactersView.patternsAiTooltip')}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {isGeneratingPatterns
                          ? t('charactersView.patternsAiGenerating')
                          : t('charactersView.patternsAiBtn')}
                      </span>
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
                    {t('charactersView.behaviorPatternsHint')}
                  </p>

                  {patternsAiError && (
                    <div className="mb-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px]">
                      {patternsAiError}
                    </div>
                  )}

                  <textarea
                    rows={6}
                    value={(selectedChar.behaviorPatterns || []).join('\n')}
                    onChange={(e) => handleBehaviorPatternsChange(e.target.value)}
                    placeholder={t('charactersView.behaviorPatternsPlaceholder')}
                    className="w-full p-3 rounded-xl bg-slate-900 border border-slate-800 focus:border-violet-400 text-slate-200 leading-relaxed text-xs font-mono focus:outline-hidden resize-y"
                  />

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(selectedChar.behaviorPatterns || []).map((pattern, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-start gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 text-slate-200 border border-violet-500/25 text-[11px] leading-snug max-w-full"
                      >
                        <span className="min-w-0">{pattern}</span>
                        <button
                          onClick={() => handleRemoveBehaviorPattern(idx)}
                          className="text-slate-500 hover:text-rose-400 ml-0.5 shrink-0 mt-0.5"
                          title={t('charactersView.patternsRemoveTitle')}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 max-w-md mt-2">
                    <input
                      type="text"
                      value={newPatternInput}
                      onChange={(e) => setNewPatternInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newPatternInput.trim()) {
                          handleAddBehaviorPattern(newPatternInput);
                          setNewPatternInput('');
                        }
                      }}
                      placeholder={t('charactersView.patternsAddPlaceholder')}
                      className="flex-1 p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-violet-400 focus:outline-hidden"
                    />
                    <button
                      onClick={() => {
                        if (newPatternInput.trim()) {
                          handleAddBehaviorPattern(newPatternInput);
                          setNewPatternInput('');
                        }
                      }}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold border border-slate-700"
                      title={t('charactersView.patternsAddTitle')}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Бібліотека патернів за 5 тригерами (з'являється, коли задано Big Five) */}
                  {(selectedChar.behaviorPatternLibrary || []).some((g) => g.patterns.length > 0) && (
                    <div className="mt-4 pt-3 border-t border-slate-800/70 space-y-3">
                      <p className="text-[11px] text-slate-500">
                        Бібліотека патернів за ситуацією (згенеровано на основі Big Five) — скопіюй потрібний рядок у текст сцени.
                      </p>
                      {(selectedChar.behaviorPatternLibrary || [])
                        .filter((g) => g.patterns.length > 0)
                        .map((group) => (
                          <div key={group.trigger} className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
                            <span className="text-[11px] font-bold text-indigo-300 block mb-1.5">
                              {BEHAVIOR_TRIGGER_LABELS[group.trigger] || group.trigger}
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {group.patterns.map((pattern, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-start gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 text-slate-200 border border-indigo-500/25 text-[11px] leading-snug max-w-full"
                                >
                                  <span className="min-w-0">{pattern}</span>
                                  <button
                                    onClick={() => handleRemoveLibraryPattern(group.trigger, idx)}
                                    className="text-slate-500 hover:text-rose-400 ml-0.5 shrink-0 mt-0.5"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: PSYCHOLOGY & MOTIVATION */}
          {activeTab === 'psychology' && selectedChar && (
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-5 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <BrainCircuit className="w-4 h-4 text-indigo-400" />
                  {t('charactersView.psychologyHeading')}
                </h3>
                <button
                  onClick={handleSaveClick}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 font-bold text-xs border border-cyan-500/30 transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{t('charactersView.saveChangesBtn')}</span>
                </button>
              </div>

              <div className="space-y-4 text-xs">
                {/* Motivation & Conflict */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-slate-300 font-bold block mb-1">{t('charactersView.coreMotivationLabel')}</label>
                    <textarea
                      rows={3}
                      value={selectedChar.personality.motivation}
                      onChange={(e) =>
                        handleUpdateCharacter({
                          ...selectedChar,
                          personality: { ...selectedChar.personality, motivation: e.target.value },
                        })
                      }
                      placeholder={t('charactersView.motivationPlaceholder')}
                      className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-indigo-400 text-slate-200 text-xs focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-slate-300 font-bold block mb-1">{t('charactersView.internalConflictLabel')}</label>
                    <textarea
                      rows={3}
                      value={selectedChar.personality.internalConflict}
                      onChange={(e) =>
                        handleUpdateCharacter({
                          ...selectedChar,
                          personality: { ...selectedChar.personality, internalConflict: e.target.value },
                        })
                      }
                      placeholder={t('charactersView.internalConflictPlaceholder')}
                      className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-indigo-400 text-slate-200 text-xs focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Strengths & Weaknesses */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Strengths */}
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                    <span className="font-bold text-emerald-400 text-xs block">
                      {t('charactersView.strengthsVirtuesLabel')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(selectedChar.personality.strengths || []).map((s, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-emerald-950/40 text-emerald-300 border border-emerald-800 text-[11px] flex items-center gap-1">
                          {s}
                          <button onClick={() => handleRemovePersonalityTrait('strengths', idx)} className="hover:text-rose-400">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1.5 pt-1">
                      <input
                        type="text"
                        value={newStrengthInput}
                        onChange={(e) => setNewStrengthInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleAddPersonalityTrait('strengths', newStrengthInput);
                            setNewStrengthInput('');
                          }
                        }}
                        placeholder={t('charactersView.addVirtuePlaceholder')}
                        className="flex-1 p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200"
                      />
                      <button
                        onClick={() => {
                          handleAddPersonalityTrait('strengths', newStrengthInput);
                          setNewStrengthInput('');
                        }}
                        className="px-2 py-1 bg-slate-800 text-slate-200 rounded-lg text-xs"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Weaknesses */}
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                    <span className="font-bold text-rose-400 text-xs block">
                      {t('charactersView.weaknessesFlawsLabel')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(selectedChar.personality.weaknesses || []).map((w, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-rose-950/40 text-rose-300 border border-rose-800 text-[11px] flex items-center gap-1">
                          {w}
                          <button onClick={() => handleRemovePersonalityTrait('weaknesses', idx)} className="hover:text-rose-400">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1.5 pt-1">
                      <input
                        type="text"
                        value={newWeaknessInput}
                        onChange={(e) => setNewWeaknessInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleAddPersonalityTrait('weaknesses', newWeaknessInput);
                            setNewWeaknessInput('');
                          }
                        }}
                        placeholder={t('charactersView.addWeaknessPlaceholder')}
                        className="flex-1 p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200"
                      />
                      <button
                        onClick={() => {
                          handleAddPersonalityTrait('weaknesses', newWeaknessInput);
                          setNewWeaknessInput('');
                        }}
                        className="px-2 py-1 bg-slate-800 text-slate-200 rounded-lg text-xs"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* Fears & Goals */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Fears */}
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                    <span className="font-bold text-amber-400 text-xs block">
                      {t('charactersView.fearsPhobiasLabel')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(selectedChar.personality.fears || []).map((f, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-amber-950/40 text-amber-300 border border-amber-800 text-[11px] flex items-center gap-1">
                          {f}
                          <button onClick={() => handleRemovePersonalityTrait('fears', idx)} className="hover:text-rose-400">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1.5 pt-1">
                      <input
                        type="text"
                        value={newFearInput}
                        onChange={(e) => setNewFearInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleAddPersonalityTrait('fears', newFearInput);
                            setNewFearInput('');
                          }
                        }}
                        placeholder={t('charactersView.addFearPlaceholder')}
                        className="flex-1 p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200"
                      />
                      <button
                        onClick={() => {
                          handleAddPersonalityTrait('fears', newFearInput);
                          setNewFearInput('');
                        }}
                        className="px-2 py-1 bg-slate-800 text-slate-200 rounded-lg text-xs"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Goals */}
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                    <span className="font-bold text-cyan-400 text-xs block">
                      {t('charactersView.goalsAspirationsLabel')}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(selectedChar.personality.goals || []).map((g, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-cyan-950/40 text-cyan-300 border border-cyan-800 text-[11px] flex items-center gap-1">
                          {g}
                          <button onClick={() => handleRemovePersonalityTrait('goals', idx)} className="hover:text-rose-400">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1.5 pt-1">
                      <input
                        type="text"
                        value={newGoalInput}
                        onChange={(e) => setNewGoalInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleAddPersonalityTrait('goals', newGoalInput);
                            setNewGoalInput('');
                          }
                        }}
                        placeholder={t('charactersView.addGoalPlaceholder')}
                        className="flex-1 p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200"
                      />
                      <button
                        onClick={() => {
                          handleAddPersonalityTrait('goals', newGoalInput);
                          setNewGoalInput('');
                        }}
                        className="px-2 py-1 bg-slate-800 text-slate-200 rounded-lg text-xs"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* Big Five — структуровані риси темпераменту, керують AI-генерацією бібліотеки патернів поведінки */}
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                  <span className="font-bold text-indigo-300 text-xs block">
                    {t('charactersView.bigFiveLabel')}
                  </span>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {t('charactersView.bigFiveHint')}
                  </p>
                  {(
                    [
                      ['extraversion', t('charactersView.bigFiveExtraversion')],
                      ['neuroticism', t('charactersView.bigFiveNeuroticism')],
                      ['agreeableness', t('charactersView.bigFiveAgreeableness')],
                      ['openness', t('charactersView.bigFiveOpenness')],
                      ['conscientiousness', t('charactersView.bigFiveConscientiousness')],
                    ] as const
                  ).map(([trait, label]) => {
                    const value = selectedChar.bigFive?.[trait] ?? 50;
                    return (
                      <div key={trait}>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-0.5">
                          <span>{label}</span>
                          <span className="font-mono text-slate-300">{value}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={value}
                          onChange={(e) =>
                            handleUpdateCharacter({
                              ...selectedChar,
                              bigFive: {
                                openness: selectedChar.bigFive?.openness ?? 50,
                                conscientiousness: selectedChar.bigFive?.conscientiousness ?? 50,
                                extraversion: selectedChar.bigFive?.extraversion ?? 50,
                                agreeableness: selectedChar.bigFive?.agreeableness ?? 50,
                                neuroticism: selectedChar.bigFive?.neuroticism ?? 50,
                                [trait]: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full accent-indigo-400"
                        />
                      </div>
                    );
                  })}
                </div>

              </div>
            </div>
          )}

          {/* TAB 3: APPEARANCE & STYLE */}
          {activeTab === 'appearance' && selectedChar && (
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-5 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Eye className="w-4 h-4 text-cyan-400" />
                  {t('charactersView.appearanceHeading')}
                </h3>
                <button
                  onClick={handleSaveClick}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 font-bold text-xs border border-cyan-500/30 transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{t('charactersView.saveChangesBtn')}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">{t('charactersView.heightLabel')}</label>
                  <input
                    type="text"
                    value={selectedChar.appearance.height || ''}
                    onChange={(e) =>
                      handleUpdateCharacter({
                        ...selectedChar,
                        appearance: { ...selectedChar.appearance, height: e.target.value },
                      })
                    }
                    placeholder={t('charactersView.heightPlaceholder')}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:border-cyan-400 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">{t('charactersView.buildLabel')}</label>
                  <input
                    type="text"
                    value={selectedChar.appearance.build || ''}
                    onChange={(e) =>
                      handleUpdateCharacter({
                        ...selectedChar,
                        appearance: { ...selectedChar.appearance, build: e.target.value },
                      })
                    }
                    placeholder={t('charactersView.buildPlaceholder')}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:border-cyan-400 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">{t('charactersView.hairLabel')}</label>
                  <input
                    type="text"
                    value={selectedChar.appearance.hair || ''}
                    onChange={(e) =>
                      handleUpdateCharacter({
                        ...selectedChar,
                        appearance: { ...selectedChar.appearance, hair: e.target.value },
                      })
                    }
                    placeholder={t('charactersView.hairPlaceholder')}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:border-cyan-400 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">{t('charactersView.eyesLabel')}</label>
                  <input
                    type="text"
                    value={selectedChar.appearance.eyes || ''}
                    onChange={(e) =>
                      handleUpdateCharacter({
                        ...selectedChar,
                        appearance: { ...selectedChar.appearance, eyes: e.target.value },
                      })
                    }
                    placeholder={t('charactersView.eyesPlaceholder')}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:border-cyan-400 focus:outline-hidden"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="text-slate-400 block mb-1">{t('charactersView.clothingLabel')}</label>
                  <input
                    type="text"
                    value={selectedChar.appearance.clothing || ''}
                    onChange={(e) =>
                      handleUpdateCharacter({
                        ...selectedChar,
                        appearance: { ...selectedChar.appearance, clothing: e.target.value },
                      })
                    }
                    placeholder={t('charactersView.clothingPlaceholder')}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:border-cyan-400 focus:outline-hidden"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="text-slate-400 block mb-1">{t('charactersView.marksLabel')}</label>
                  <textarea
                    rows={2}
                    value={selectedChar.appearance.distinguishingMarks || ''}
                    onChange={(e) =>
                      handleUpdateCharacter({
                        ...selectedChar,
                        appearance: { ...selectedChar.appearance, distinguishingMarks: e.target.value },
                      })
                    }
                    placeholder={t('charactersView.marksPlaceholder')}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:border-cyan-400 focus:outline-hidden text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: RELATIONSHIPS MATRIX */}
          {activeTab === 'relationships' && selectedChar && (
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {t('charactersView.relationshipsOfLabel', { name: selectedChar.name })}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {t('charactersView.relationshipsDesc')}
                  </p>
                </div>

                {/* Add new relation dropdown */}
                <div className="flex items-center gap-2">
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        handleAddRelationship(e.target.value, 'alliance');
                        e.target.value = '';
                      }
                    }}
                    className="text-xs bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5"
                    defaultValue=""
                  >
                    <option value="" disabled>{t('charactersView.addRelationOption')}</option>
                    {book.characters
                      .filter((c) => c.id !== selectedChar.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.surname} ({c.role})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Relationships Cards */}
              <div className="space-y-3 pt-2">
                {selectedChar.relationships.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs space-y-2 border border-dashed border-slate-800 rounded-xl">
                    <HeartHandshake className="w-8 h-8 mx-auto text-slate-600" />
                    <p>{t('charactersView.noRelationships')}</p>
                  </div>
                ) : (
                  selectedChar.relationships.map((rel) => {
                    const target = book.characters.find((c) => c.id === rel.targetCharacterId);
                    return (
                      <div
                        key={rel.targetCharacterId}
                        className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-slate-200 text-xs">
                              {target?.name} {target?.surname}
                            </span>
                            <select
                              value={rel.type}
                              onChange={(e) => {
                                const updatedRels = selectedChar.relationships.map((r) =>
                                  r.targetCharacterId === rel.targetCharacterId
                                    ? { ...r, type: e.target.value as any }
                                    : r
                                );
                                handleUpdateCharacter({ ...selectedChar, relationships: updatedRels });
                              }}
                              className="text-xs bg-slate-950 border border-slate-700 text-cyan-300 rounded px-2 py-1"
                            >
                              <option value="alliance">{t('charactersView.relAlliance')}</option>
                              <option value="friendship">{t('charactersView.relFriendship')}</option>
                              <option value="love">{t('charactersView.relLove')}</option>
                              <option value="conflict">{t('charactersView.relConflict')}</option>
                              <option value="rivalry">{t('charactersView.relRivalry')}</option>
                              <option value="family">{t('charactersView.relFamily')}</option>
                              <option value="secret">{t('charactersView.relSecret')}</option>
                            </select>
                          </div>

                          <button
                            onClick={() => handleRemoveRelationship(rel.targetCharacterId)}
                            className="text-slate-500 hover:text-rose-400 text-xs"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <input
                          type="text"
                          value={rel.description}
                          onChange={(e) => {
                            const updatedRels = selectedChar.relationships.map((r) =>
                              r.targetCharacterId === rel.targetCharacterId
                                ? { ...r, description: e.target.value }
                                : r
                            );
                            handleUpdateCharacter({ ...selectedChar, relationships: updatedRels });
                          }}
                          placeholder={t('charactersView.relationDescPlaceholder')}
                          className="w-full p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300"
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB: 5 СКАНДХ (буддійська модель персонажа) */}
          {activeTab === 'skandhas' && selectedChar && (
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-5 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Flower2 className="w-4 h-4 text-rose-300" />
                  {t('charactersView.skandhasHeading')}
                </h3>
                <button
                  onClick={handleSaveClick}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 font-bold text-xs border border-cyan-500/30 transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{t('charactersView.saveChangesBtn')}</span>
                </button>
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">{t('charactersView.skandhasIntro')}</p>

              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={handleAiGenerateSkandhas}
                  disabled={isGeneratingSkandhas}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-rose-500 to-fuchsia-500 hover:from-rose-400 hover:to-fuchsia-400 text-white font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isGeneratingSkandhas ? t('charactersView.skandhasAiGenerating') : t('charactersView.skandhasAiBtn')}</span>
                </button>
              </div>
              {skandhasAiError && (
                <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px]">
                  {skandhasAiError}
                </div>
              )}

              <div className="space-y-3 text-xs">
                {(
                  [
                    ['rupa', t('charactersView.skandhaRupaLabel'), t('charactersView.skandhaRupaPlaceholder')],
                    ['vedana', t('charactersView.skandhaVedanaLabel'), t('charactersView.skandhaVedanaPlaceholder')],
                    ['sanjna', t('charactersView.skandhaSanjnaLabel'), t('charactersView.skandhaSanjnaPlaceholder')],
                    ['sankhara', t('charactersView.skandhaSankharaLabel'), t('charactersView.skandhaSankharaPlaceholder')],
                    ['vinnana', t('charactersView.skandhaVinnanaLabel'), t('charactersView.skandhaVinnanaPlaceholder')],
                  ] as const
                ).map(([field, label, placeholder]) => (
                  <div key={field}>
                    <label className="text-slate-300 font-bold block mb-1">{label}</label>
                    <textarea
                      rows={2}
                      value={selectedChar.skandhas?.[field] || ''}
                      onChange={(e) => handleUpdateSkandha(field, e.target.value)}
                      placeholder={placeholder}
                      className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-rose-400 text-slate-200 text-xs leading-relaxed focus:outline-hidden"
                    />
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-slate-800/70 space-y-2">
                <span className="font-bold text-rose-300 text-xs block">{t('charactersView.skandhaCycleHeading')}</span>
                <p className="text-[11px] text-slate-500 leading-relaxed">{t('charactersView.skandhaCycleHint')}</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={skandhaEvent}
                    onChange={(e) => setSkandhaEvent(e.target.value)}
                    placeholder={t('charactersView.skandhaCycleEventPlaceholder')}
                    className="flex-1 p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-rose-400 focus:outline-hidden"
                  />
                  <button
                    onClick={handleAiGenerateSkandhaCycle}
                    disabled={isGeneratingCycle || !skandhaEvent.trim()}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 whitespace-nowrap transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-rose-300" />
                    <span>{isGeneratingCycle ? t('charactersView.skandhasAiGenerating') : t('charactersView.skandhaCycleBtn')}</span>
                  </button>
                </div>
                {cycleAiError && (
                  <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px]">
                    {cycleAiError}
                  </div>
                )}
                {skandhaCycleSteps && skandhaCycleSteps.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {skandhaCycleSteps.map((step, idx) => (
                      <div key={idx} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex items-start gap-2">
                        <span className="text-[10px] font-bold text-rose-300 uppercase tracking-wider shrink-0 w-24">{step.label}</span>
                        <span className="text-[11px] text-slate-300 leading-relaxed">{step.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: AI GENERATOR */}
          {activeTab === 'generator' && (
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-purple-500/40 space-y-4 shadow-xl">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-bold text-white">
                  {t('charactersView.aiGeneratorHeading')}
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                {t('charactersView.aiGeneratorDesc')}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">{t('charactersView.novelRoleLabel')}</label>
                  <select
                    value={aiPromptRole}
                    onChange={(e) => setAiPromptRole(e.target.value as any)}
                    className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                  >
                    <option value="antagonist">{t('charactersView.aiRoleAntagonist')}</option>
                    <option value="mentor">{t('charactersView.aiRoleMentor')}</option>
                    <option value="ally">{t('charactersView.aiRoleAlly')}</option>
                    <option value="rival">{t('charactersView.aiRoleRival')}</option>
                    <option value="protagonist">{t('charactersView.aiRoleProtagonist')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  {t('charactersView.appearanceWishLabel')}
                </label>
                <textarea
                  rows={3}
                  value={aiPromptDesc}
                  onChange={(e) => setAiPromptDesc(e.target.value)}
                  placeholder={t('charactersView.appearanceWishPlaceholder')}
                  className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-purple-400 focus:outline-hidden"
                />
              </div>

              <button
                onClick={handleAiGenerateCharacter}
                disabled={isGeneratingAi}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-bold text-xs shadow-lg transition-all"
              >
                {isGeneratingAi ? t('charactersView.generatingCharacter') : t('charactersView.generateFullDossierBtn')}
              </button>
            </div>
          )}

        </div>
      </div>

      {/* AI CHARACTER & ART GENERATION MODAL (Nano Banana, Leonardo.ai) */}
      {showGenerateModal && (
        <GenerateCharacterModal
          isOpen={showGenerateModal}
          onClose={() => {
            setShowGenerateModal(false);
            setCharToEnhanceWithArt(null);
          }}
          characterToEnhance={charToEnhanceWithArt}
          allCharacters={book.characters}
          genre={book.genre}
          visualBible={book.visualBible}
          bookId={book.id}
          preferredAiModelId={book.preferredAiModelId}
          onApplyAvatarToCharacter={(characterId, avatarUrl, modelName) => {
            const updated = book.characters.map((c) =>
              c.id === characterId ? { ...c, avatarUrl } : c
            );
            onUpdateBook(
              { ...book, characters: updated },
              'Оновлено арт героя',
              `Згенеровано новий арт персонажа (Модель: ${modelName})`
            );
          }}
          onAddNewCharacterWithArt={(newChar) => {
            const updated = [...book.characters, newChar];
            onUpdateBook(
              { ...book, characters: updated },
              'Створено нового героя з AI артом',
              `Створено нового персонажа «${newChar.name} ${newChar.surname || ''}» (${newChar.role})`
            );
            setSelectedCharacterId(newChar.id);
          }}
        />
      )}

    </div>
  );
};
