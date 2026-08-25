import React, { useState, useEffect } from 'react';
import { 
  X, 
  Sparkles, 
  Wand2, 
  Cpu, 
  Check, 
  Image as ImageIcon, 
  RefreshCw, 
  Layers, 
  Sliders, 
  UserPlus, 
  User, 
  Save, 
  Eye, 
  Zap, 
  Flame, 
  CheckCircle2,
  Palette,
  Terminal,
  Bot,
  AlertCircle
} from 'lucide-react';
import { Character, CharacterInScene } from '../types';
import { normalizeCharacter } from '../utils/characterNormalize';
import { useLanguage } from '../i18n/LanguageContext';

interface GenerateCharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
  characterToEnhance?: Character | null;
  allCharacters: Character[];
  onApplyAvatarToCharacter?: (characterId: string, avatarUrl: string, modelName: string) => void;
  onAddNewCharacterWithArt?: (newChar: Character, addToCurrentScene?: boolean) => void;
  genre?: string;
  visualBible?: any;
  /** Ідентифікатор книги — для логування витрат AI-ядра. */
  bookId?: string;
  /**
   * Рушій ТЕКСТУ, обраний письменником у чаті («рушій книги»,
   * book.preferredAiModelId) — окремий від `selectedModel` тут-таки (той —
   * рушій КАРТИНКИ: nano-banana/seedream). Визначає, ЯКА модель складає
   * текстовий промпт і біографію персонажа (server/coreAiRegistry.ts).
   */
  preferredAiModelId?: string;
}

export type GenerationModel = 'nano-banana-2-lite' | 'nano-banana-2' | 'nano-banana-pro' | 'seedream';
export type StylePreset = 'cyberpunk-photoreal' | 'cinematic' | 'graphic-novel' | 'anime' | 'oil-portrait' | 'dark-noir';

export const GenerateCharacterModal: React.FC<GenerateCharacterModalProps> = ({
  isOpen,
  onClose,
  characterToEnhance,
  allCharacters,
  onApplyAvatarToCharacter,
  onAddNewCharacterWithArt,
  genre = 'Кіберпанк / Наукова фантастика',
  visualBible,
  bookId,
  preferredAiModelId,
}) => {
  const { t } = useLanguage();
  if (!isOpen) return null;

  // Selected target character or "new character" mode
  const [mode, setMode] = useState<'existing' | 'new'>(characterToEnhance ? 'existing' : 'new');
  const [selectedCharId, setSelectedCharId] = useState<string>(characterToEnhance?.id || allCharacters[0]?.id || '');
  
  // Model engine
  const [selectedModel, setSelectedModel] = useState<GenerationModel>('nano-banana-2');
  
  // Style preset
  const [stylePreset, setStylePreset] = useState<StylePreset>('cyberpunk-photoreal');
  
  // Prompt Strategy: 'auto' | 'custom'
  const [promptStrategy, setPromptStrategy] = useState<'auto' | 'custom'>('auto');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [negativePrompt, setNegativePrompt] = useState<string>('blurry, low quality, distorted anatomy, extra limbs, bad eyes, disfigured, cartoonish, watermark, signature');

  // New character generation options
  const [newCharRole, setNewCharRole] = useState<Character['role']>('ally');
  const [newCharIdea, setNewCharIdea] = useState<string>('');
  const [addToSceneAfterCreate, setAddToSceneAfterCreate] = useState<boolean>(true);

  // Status & output
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isCraftingPrompt, setIsCraftingPrompt] = useState<boolean>(false);
  const [generatedResult, setGeneratedResult] = useState<{
    /** Порожній рядок — дозьє (якщо є) згенеровано, а портрет НЕ вдався (див. artError). Раніше сюди мовчки потрапляв undefined, і картинка показувалась «успішною» з битим src. */
    imageUrl: string;
    promptUsed: string;
    modelUsed: string;
    characterDossier?: Character;
    /** Помилка САМЕ генерації портрета — коли дозьє вже готове, але картинки нема (напр. немає ключа для image-рушія). */
    artError?: string;
  } | null>(null);
  /** Помилка, яка зупинила генерацію ДО отримання будь-якого результату (немає навіть дозьє). */
  const [generationError, setGenerationError] = useState<string | null>(null);

  const activeChar = allCharacters.find((c) => c.id === selectedCharId) || characterToEnhance || allCharacters[0];

  // Auto-craft prompt when character or model changes if in auto mode
  const handleCraftPrompt = async (targetChar?: Character) => {
    const char = targetChar || activeChar;
    if (!char) return;

    setIsCraftingPrompt(true);
    try {
      const res = await fetch('/api/ai/craft-character-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character: char,
          model: selectedModel,
          stylePreset: stylePreset,
          genre: genre,
          modelId: preferredAiModelId,
          bookId,
        }),
      });
      const data = await res.json();
      if (data.prompt) {
        setCustomPrompt(data.prompt);
        if (data.negativePrompt) {
          setNegativePrompt(data.negativePrompt);
        }
      }
    } catch (err) {
      console.error('Error crafting prompt:', err);
    } finally {
      setIsCraftingPrompt(false);
    }
  };

  // Trigger prompt craft on initial open if we have an active character
  useEffect(() => {
    if (activeChar && !customPrompt) {
      handleCraftPrompt(activeChar);
    }
  }, [selectedCharId, selectedModel, stylePreset]);

  // Main Generation Handler
  const handleExecuteGeneration = async () => {
    setIsGenerating(true);
    setGeneratedResult(null);
    setGenerationError(null);

    try {
      if (mode === 'new') {
        // 1. First generate character dossier with AI
        const charRes = await fetch('/api/ai/generate-character', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: newCharRole,
            promptDescription: newCharIdea || `Персонаж для книги у жанрі ${genre}`,
            genre: genre,
            modelId: preferredAiModelId,
            bookId,
          }),
        });
        const charData = await charRes.json();
        // Раніше відповідь довіряли беззастережно: помилка сервера
        // (напр. 503 "немає ключа") пролітала як щойно СТВОРЕНИЙ
        // персонаж — { error, kind } з довільними полями, які код нижче
        // мовчки трактував як ім'я/зовнішність/біографію.
        if (!charRes.ok || charData?.error) {
          throw new Error(charData?.error || 'Не вдалося згенерувати персонажа.');
        }
        // normalizeCharacter: JSON тут будує МОДЕЛЬ за текстовою
        // інструкцією-схемою, не код, що можна перевірити компілятором.
        // Модель, яка гірше тримає інструкцію, легко поверне персонажа без
        // `tags` чи `personality.goals` — без нормалізації такий запис
        // назавжди ламає рендер картки персонажа після збереження.
        const createdDossier: Character = normalizeCharacter(charData);
        createdDossier.id = `char-${Date.now()}`;
        createdDossier.bookId = activeChar?.bookId || 'book-1';

        // 2. Generate portrait art for this new hero
        const artRes = await fetch('/api/ai/generate-character-art', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character: createdDossier,
            prompt: customPrompt || undefined,
            model: selectedModel,
            stylePreset: stylePreset,
            genre: genre,
            visualBible: visualBible,
            textModelId: preferredAiModelId,
            bookId,
          }),
        });
        const artData = await artRes.json();
        // Дозьє вже реальне — не відкидаємо його через невдалий портрет
        // (типово: немає ключа image-рушія). Показуємо як часткову
        // невдачу з чесним поясненням, а не як биту картинку під
        // зеленим написом "успішно згенеровано".
        if (!artRes.ok || artData?.error || !artData?.imageUrl) {
          setGeneratedResult({
            imageUrl: '',
            promptUsed: customPrompt,
            modelUsed: selectedModel,
            characterDossier: createdDossier,
            artError: artData?.error || 'Не вдалося згенерувати портрет.',
          });
          return;
        }
        createdDossier.avatarUrl = artData.imageUrl;

        setGeneratedResult({
          imageUrl: artData.imageUrl,
          promptUsed: artData.promptUsed || customPrompt,
          modelUsed: artData.modelUsed || selectedModel,
          characterDossier: createdDossier,
        });
      } else {
        // Generate art for existing character
        const artRes = await fetch('/api/ai/generate-character-art', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character: activeChar,
            prompt: customPrompt || undefined,
            model: selectedModel,
            stylePreset: stylePreset,
            genre: genre,
            visualBible: visualBible,
            textModelId: preferredAiModelId,
            bookId,
          }),
        });
        const artData = await artRes.json();
        if (!artRes.ok || artData?.error || !artData?.imageUrl) {
          throw new Error(artData?.error || 'Не вдалося згенерувати портрет.');
        }

        setGeneratedResult({
          imageUrl: artData.imageUrl,
          promptUsed: artData.promptUsed || customPrompt,
          modelUsed: artData.modelUsed || selectedModel,
        });
      }
    } catch (err) {
      console.error('Error during generation:', err);
      setGenerationError(err instanceof Error ? err.message : 'Сталася помилка під час генерації.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Apply result
  const handleApplyResult = () => {
    if (!generatedResult) return;

    if (mode === 'new' && generatedResult.characterDossier) {
      if (onAddNewCharacterWithArt) {
        onAddNewCharacterWithArt(generatedResult.characterDossier, addToSceneAfterCreate);
      }
    } else if (activeChar && onApplyAvatarToCharacter) {
      onApplyAvatarToCharacter(activeChar.id, generatedResult.imageUrl, generatedResult.modelUsed);
    }
    onClose();
  };

  const modelOptions: { id: GenerationModel; name: string; tag: string; icon: string; desc: string }[] = [
    {
      id: 'nano-banana-2-lite',
      name: t('generateCharacterModal.modelLiteName'),
      tag: t('generateCharacterModal.modelLiteTag'),
      icon: '⚡',
      desc: t('generateCharacterModal.modelLiteDesc'),
    },
    {
      id: 'nano-banana-2',
      name: t('generateCharacterModal.modelStandardName'),
      tag: t('generateCharacterModal.modelStandardTag'),
      icon: '🍌',
      desc: t('generateCharacterModal.modelStandardDesc'),
    },
    {
      id: 'nano-banana-pro',
      name: t('generateCharacterModal.modelProName'),
      tag: t('generateCharacterModal.modelProTag'),
      icon: '💎',
      desc: t('generateCharacterModal.modelProDesc'),
    },
    {
      id: 'seedream',
      name: t('generateCharacterModal.modelSeedreamName'),
      tag: t('generateCharacterModal.modelSeedreamTag'),
      icon: '🌱',
      desc: t('generateCharacterModal.modelSeedreamDesc'),
    },
  ];

  const styleOptions: { id: StylePreset; label: string; icon: string }[] = [
    { id: 'cyberpunk-photoreal', label: t('generateCharacterModal.styleCyberpunk'), icon: '🏙️' },
    { id: 'cinematic', label: t('generateCharacterModal.styleCinematic'), icon: '🎬' },
    { id: 'graphic-novel', label: t('generateCharacterModal.styleGraphicNovel'), icon: '🎨' },
    { id: 'anime', label: t('generateCharacterModal.styleAnime'), icon: '⛩️' },
    { id: 'oil-portrait', label: t('generateCharacterModal.styleOilPortrait'), icon: '🖌️' },
    { id: 'dark-noir', label: t('generateCharacterModal.styleDarkNoir'), icon: '🌑' },
  ];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-950 border border-slate-800 rounded-3xl max-w-3xl w-full flex flex-col max-h-[92vh] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>{t('generateCharacterModal.heading')}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  AI Multi-Model
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {t('generateCharacterModal.subheading')}
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

        {/* Mode Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/80 px-6 pt-3 gap-3">
          <button
            onClick={() => {
              setMode('existing');
              setGeneratedResult(null);
            }}
            className={`pb-3 text-xs font-bold border-b-2 flex items-center gap-2 transition-all ${
              mode === 'existing'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <User className="w-4 h-4" />
            <span>{t('generateCharacterModal.tabExisting')}</span>
          </button>

          <button
            onClick={() => {
              setMode('new');
              setGeneratedResult(null);
            }}
            className={`pb-3 text-xs font-bold border-b-2 flex items-center gap-2 transition-all ${
              mode === 'new'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>{t('generateCharacterModal.tabNew')}</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-slate-200">
          
          {/* 1. TARGET CHARACTER SELECTION (If mode === 'existing') */}
          {mode === 'existing' && (
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <label className="text-xs font-bold text-slate-300 block">
                {t('generateCharacterModal.chooseCharacterLabel')}
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {allCharacters.map((char) => {
                  const isSelected = char.id === selectedCharId;
                  return (
                    <div
                      key={char.id}
                      onClick={() => {
                        setSelectedCharId(char.id);
                        handleCraftPrompt(char);
                      }}
                      className={`p-2.5 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500/50 text-white shadow-sm'
                          : 'bg-slate-950 border-slate-800/80 hover:border-slate-700 text-slate-400'
                      }`}
                    >
                      {char.avatarUrl ? (
                        <img
                          src={char.avatarUrl}
                          alt={char.name}
                          className="w-9 h-9 rounded-xl object-cover border border-slate-700 shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400 font-bold shrink-0">
                          {char.name.charAt(0)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-200 truncate">{char.name} {char.surname || ''}</div>
                        <div className="text-[10px] text-amber-400/90 truncate">{char.profession || char.role}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {activeChar && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1 text-[11px] text-slate-300">
                  <span className="font-bold text-amber-400">{t('generateCharacterModal.descriptionInBookLabel')}</span>
                  <span>
                    {activeChar.appearance?.hair ? t('generateCharacterModal.hairPrefix', { v: activeChar.appearance.hair }) : ''}
                    {activeChar.appearance?.eyes ? t('generateCharacterModal.eyesPrefix', { v: activeChar.appearance.eyes }) : ''}
                    {activeChar.appearance?.clothing ? t('generateCharacterModal.clothingPrefix', { v: activeChar.appearance.clothing }) : ''}
                    {activeChar.appearance?.distinguishingMarks ? t('generateCharacterModal.marksPrefix', { v: activeChar.appearance.distinguishingMarks }) : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 1b. NEW HERO CONFIG (If mode === 'new') */}
          {mode === 'new' && (
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <label className="text-xs font-bold text-slate-300 block">
                {t('generateCharacterModal.newCharParamsLabel')}
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">{t('generateCharacterModal.dramaturgyRoleLabel')}</label>
                  <select
                    value={newCharRole}
                    onChange={(e) => setNewCharRole(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-medium focus:border-amber-400 focus:outline-hidden"
                  >
                    <option value="protagonist">{t('generateCharacterModal.roleProtagonist')}</option>
                    <option value="antagonist">{t('generateCharacterModal.roleAntagonist')}</option>
                    <option value="deuteragonist">{t('generateCharacterModal.roleDeuteragonist')}</option>
                    <option value="mentor">{t('generateCharacterModal.roleMentor')}</option>
                    <option value="ally">{t('generateCharacterModal.roleAlly')}</option>
                    <option value="rival">{t('generateCharacterModal.roleRival')}</option>
                    <option value="minor">{t('generateCharacterModal.roleMinor')}</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">{t('generateCharacterModal.ideaConceptLabel')}</label>
                  <input
                    type="text"
                    value={newCharIdea}
                    onChange={(e) => setNewCharIdea(e.target.value)}
                    placeholder={t('generateCharacterModal.ideaPlaceholder')}
                    className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:border-amber-400 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="add-to-scene-chk"
                  checked={addToSceneAfterCreate}
                  onChange={(e) => setAddToSceneAfterCreate(e.target.checked)}
                  className="rounded border-slate-700 text-amber-500 focus:ring-amber-400"
                />
                <label htmlFor="add-to-scene-chk" className="text-[11px] text-slate-300 cursor-pointer">
                  {t('generateCharacterModal.addToSceneLabel')}
                </label>
              </div>
            </div>
          )}

          {/* 2. Вибір двигуна генерації */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-300 block flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('generateCharacterModal.chooseModelLabel')}</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {modelOptions.map((model) => {
                const isSelected = model.id === selectedModel;
                return (
                  <div
                    key={model.id}
                    onClick={() => setSelectedModel(model.id)}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'bg-amber-500/10 border-amber-500 text-white shadow-md'
                        : 'bg-slate-900/80 border-slate-800/80 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs flex items-center gap-1.5">
                          <span>{model.icon}</span>
                          <span>{model.name}</span>
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                          isSelected ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {model.tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {model.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. STYLE PRESET SELECTION */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 block flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('generateCharacterModal.artStyleLabel')}</span>
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {styleOptions.map((st) => (
                <button
                  key={st.id}
                  onClick={() => setStylePreset(st.id)}
                  className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all ${
                    stylePreset === st.id
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <span>{st.icon}</span>
                  <span>{st.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 4. PROMPT CRAFTING SECTION */}
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-amber-400" />
                <span className="font-bold text-xs text-white">
                  {t('generateCharacterModal.promptEngineeringLabel')}
                </span>
              </div>

              {activeChar && (
                <button
                  onClick={() => handleCraftPrompt(activeChar)}
                  disabled={isCraftingPrompt}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold transition-all disabled:opacity-50"
                  title={t('generateCharacterModal.craftPromptTooltip')}
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>{isCraftingPrompt ? t('generateCharacterModal.craftingPrompt') : t('generateCharacterModal.craftFromBookDescBtn')}</span>
                </button>
              )}
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 block mb-1">
                {t('generateCharacterModal.promptFieldLabel')}
              </label>
              <textarea
                rows={3}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Detailed portrait prompt with lighting, atmosphere, clothing, camera angle, 8k render..."
                className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 font-mono focus:border-amber-400 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 block mb-1">
                {t('generateCharacterModal.negativePromptLabel')}
              </label>
              <input
                type="text"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 font-mono focus:border-amber-400 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Помилка ДО отримання будь-якого результату — немає навіть дозьє. */}
          {generationError && (
            <div className="p-4 rounded-2xl bg-rose-950/40 border-2 border-rose-500/50 space-y-1.5 shadow-xl animate-fade-in">
              <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" />
                <span>Генерація не вдалася</span>
              </span>
              <p className="text-rose-200 text-[11px] leading-relaxed">{generationError}</p>
            </div>
          )}

          {/* 5. GENERATED RESULT PREVIEW */}
          {generatedResult && (
            <div
              className={`p-4 rounded-2xl bg-slate-900 border-2 space-y-4 shadow-xl animate-fade-in ${
                generatedResult.artError ? 'border-amber-500/50' : 'border-emerald-500/50'
              }`}
            >
              <div className="flex items-center justify-between">
                {generatedResult.artError ? (
                  <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4" />
                    <span>Дозьє готове, портрет — ні</span>
                  </span>
                ) : (
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{t('generateCharacterModal.generatedWithModel', { model: generatedResult.modelUsed })}</span>
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4">
                {generatedResult.imageUrl ? (
                  <img
                    src={generatedResult.imageUrl}
                    alt="Generated Hero Art"
                    className="w-32 h-32 rounded-2xl object-cover border-2 border-amber-400 shadow-2xl shrink-0"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-2xl border-2 border-dashed border-slate-700 shadow-2xl shrink-0 flex items-center justify-center text-slate-600">
                    <ImageIcon className="w-8 h-8" />
                  </div>
                )}

                {/* min-w-0: без нього flex-дочірній елемент не стискається нижче ширини свого вмісту, і довгий текст біографії виходив за межі картки замість переносу. */}
                <div className="space-y-1.5 text-xs flex-1 min-w-0">
                  {generatedResult.characterDossier ? (
                    <div>
                      <div className="font-bold text-white text-sm">
                        {generatedResult.characterDossier.name} {generatedResult.characterDossier.surname || ''}
                      </div>
                      <div className="text-amber-400 text-xs">
                        {generatedResult.characterDossier.profession} • {generatedResult.characterDossier.role}
                      </div>
                      <p className="text-slate-300 text-[11px] line-clamp-2 mt-1">
                        {generatedResult.characterDossier.biography}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div className="font-bold text-white text-sm">
                        {activeChar?.name} {activeChar?.surname || ''}
                      </div>
                      <p className="text-slate-400 text-[11px]">
                        {t('generateCharacterModal.newArtReadyNote')}
                      </p>
                    </div>
                  )}

                  {generatedResult.artError ? (
                    <p className="text-amber-300 text-[11px] leading-relaxed">{generatedResult.artError}</p>
                  ) : (
                    <div className="text-[10px] text-slate-500 font-mono truncate">
                      {t('generateCharacterModal.promptUsedLabel', { prompt: generatedResult.promptUsed })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-[11px] text-slate-400 flex items-center gap-2">
            <Bot className="w-4 h-4 text-amber-400" />
            <span>
              {t('generateCharacterModal.selectedModelLabel', { model: selectedModel, style: stylePreset })}
            </span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
            >
              {t('generateCharacterModal.closeBtn')}
            </button>

            {!generatedResult ? (
              <button
                onClick={handleExecuteGeneration}
                disabled={isGenerating}
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs transition-all shadow-lg active:scale-95 disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{t('generateCharacterModal.generatingArtWithModel', { model: selectedModel })}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>{mode === 'new' ? t('generateCharacterModal.generateNewHeroBtn') : t('generateCharacterModal.generateHeroArtBtn')}</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleApplyResult}
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-all shadow-lg active:scale-95"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>{t('generateCharacterModal.applyAndSaveBtn')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
