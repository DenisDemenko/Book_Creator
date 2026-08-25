import React, { useState } from 'react';
import { 
  Clapperboard, 
  Flame, 
  MapPin, 
  Clock, 
  Users, 
  Sparkles, 
  Plus, 
  Trash2, 
  Activity, 
  Check, 
  Edit3, 
  ChevronRight,
  TrendingUp,
  Sliders,
  HelpCircle,
  Save
} from 'lucide-react';
import { Book, Scene, CharacterInScene } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface ScenarioViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onNavigateToSection: (chapterId: string, sectionId: string) => void;
  onSaveBook?: () => void;
}

export const ScenarioView: React.FC<ScenarioViewProps> = ({
  book,
  onUpdateBook,
  onNavigateToSection,
  onSaveBook,
}) => {
  const { t } = useLanguage();
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [isEditingSynopsis, setIsEditingSynopsis] = useState(false);
  const [isAnalyzingDrama, setIsAnalyzingDrama] = useState(false);

  // Extract all scenes from all chapters/sections
  const allScenes: { scene: Scene; chapterId: string; chapterTitle: string; sectionId: string; sectionTitle: string }[] = [];
  book.chapters.forEach((chap) => {
    chap.sections.forEach((sec) => {
      if (sec.scene) {
        allScenes.push({
          scene: sec.scene,
          chapterId: chap.id,
          chapterTitle: chap.title,
          sectionId: sec.id,
          sectionTitle: sec.title,
        });
      }
    });
  });

  const selectedItem = allScenes.find((s) => s.scene.id === selectedSceneId) || allScenes[0];

  // Update scene details
  const handleUpdateScene = (updatedScene: Scene) => {
    const updatedChapters = book.chapters.map((chap) => ({
      ...chap,
      sections: chap.sections.map((sec) => {
        if (sec.scene?.id === updatedScene.id) {
          return { ...sec, scene: updatedScene };
        }
        return sec;
      }),
    }));
    onUpdateBook({ ...book, chapters: updatedChapters });
  };

  // Add character to scene
  const handleAddCharacterToScene = (characterId: string) => {
    if (!selectedItem) return;
    const existing = selectedItem.scene.characters.find((c) => c.characterId === characterId);
    if (existing) return;

    const newCharInScene: CharacterInScene = {
      characterId,
      goal: 'Досягти мети у цій сцені...',
      emotionalState: 'Напружений',
      action: 'Бере участь у діалозі',
      conflict: 'Зіткнення інтересів',
    };

    const updatedScene: Scene = {
      ...selectedItem.scene,
      characters: [...selectedItem.scene.characters, newCharInScene],
    };
    handleUpdateScene(updatedScene);
  };

  // Remove character from scene
  const handleRemoveCharacterFromScene = (characterId: string) => {
    if (!selectedItem) return;
    const updatedScene: Scene = {
      ...selectedItem.scene,
      characters: selectedItem.scene.characters.filter((c) => c.characterId !== characterId),
    };
    handleUpdateScene(updatedScene);
  };

  // Run AI Drama Analysis
  const handleAnalyzeDramaturgy = async () => {
    if (!selectedItem) return;
    setIsAnalyzingDrama(true);
    try {
      const sec = book.chapters
        .flatMap((c) => c.sections)
        .find((s) => s.id === selectedItem.sectionId);

      const res = await fetch('/api/ai/analyze-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sceneTitle: selectedItem.scene.title,
          sceneContent: sec?.content || '',
          characters: selectedItem.scene.characters,
          location: selectedItem.scene.location,
          conflict: selectedItem.scene.conflict,
        }),
      });

      const data = await res.json();
      if (data.dramaturgyAnalysis) {
        handleUpdateScene({
          ...selectedItem.scene,
          intensityScore: data.intensityScore || selectedItem.scene.intensityScore,
          aiDramaturgyNotes: data.dramaturgyAnalysis + `\n\n${t('scenario.aiTipsPrefix')}\n` + (data.keyRecommendations || []).map((r: string) => `• ${r}`).join('\n'),
        });
      }
    } catch (err) {
      console.error('Error analyzing drama:', err);
    } finally {
      setIsAnalyzingDrama(false);
    }
  };

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6">
      
      {/* Header Bento Box */}
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {t('scenario.headerBadge')}
            </span>
            <span className="text-xs text-slate-400">
              {t('scenario.headerSubBadge')}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white font-heading">
            {t('scenario.headerTitle', { title: book.title })}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {onSaveBook && (
            <button
              onClick={onSaveBook}
              data-tour="scenario__1"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md transition-all active:scale-95"
              title={t('scenario.saveTooltip')}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('scenario.saveBtn')}</span>
            </button>
          )}

          <button
            onClick={() => setIsEditingSynopsis(!isEditingSynopsis)}
            data-tour="scenario__2"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{isEditingSynopsis ? t('scenario.collapseSynopsisBtn') : t('scenario.editSynopsisBtn')}</span>
          </button>
        </div>
      </div>

      {/* Synopsis & Logline Panel */}
      {isEditingSynopsis ? (
        <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4">
          <div>
            <label className="text-xs font-bold uppercase text-slate-400 block mb-1">{t('scenario.loglineLabel')}</label>
            <input
              type="text"
              value={book.logline}
              onChange={(e) => onUpdateBook({ ...book, logline: e.target.value })}
              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-cyan-400 focus:outline-hidden"
            />
          </div>
          <div>
            <label className="text-xs font-bold uppercase text-slate-400 block mb-1">{t('scenario.synopsisLabel')}</label>
            <textarea
              rows={4}
              value={book.synopsis}
              onChange={(e) => onUpdateBook({ ...book, synopsis: e.target.value })}
              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-cyan-400 focus:outline-hidden"
            />
          </div>
          <div>
            <label className="text-xs font-bold uppercase text-slate-400 block mb-1">{t('scenario.themeLabel')}</label>
            <input
              type="text"
              value={book.theme}
              onChange={(e) => onUpdateBook({ ...book, theme: e.target.value })}
              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-cyan-400 focus:outline-hidden"
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
            <span className="text-[11px] font-bold text-cyan-400 uppercase">{t('scenario.loglineLabel')}</span>
            <p className="text-xs text-slate-300 italic">{book.logline}</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
            <span className="text-[11px] font-bold text-indigo-400 uppercase">{t('mastery.targetBtnTheme')}</span>
            <p className="text-xs text-slate-300">{book.theme}</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
            <span className="text-[11px] font-bold text-purple-400 uppercase">{t('scenario.genreAudienceLabel')}</span>
            <p className="text-xs text-slate-300">{book.genre} • {book.targetAudience}</p>
          </div>
        </div>
      )}

      {/* EMOTIONAL ARC & PLOT TENSION VISUALIZER */}
      <div className="p-6 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4" data-tour="scenario__3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider font-heading">
              {t('scenario.emotionalArcHeading')}
            </h2>
          </div>
          <span className="text-xs text-slate-400">
            {t('scenario.clickPointHint')}
          </span>
        </div>

        {/* Interactive SVG Emotional Curve */}
        <div className="w-full h-48 bg-slate-900/60 rounded-xl p-4 relative flex items-end border border-slate-800/80">
          <svg className="w-full h-full overflow-visible">
            {/* Grid Lines */}
            <line x1="0" y1="20%" x2="100%" y2="20%" stroke="#334155" strokeDasharray="4" strokeWidth="1" />
            <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#334155" strokeDasharray="4" strokeWidth="1" />
            <line x1="0" y1="80%" x2="100%" y2="80%" stroke="#334155" strokeDasharray="4" strokeWidth="1" />

            {/* Tension Path */}
            {allScenes.length > 1 && (
              <polyline
                fill="none"
                stroke="url(#tensionGradient)"
                strokeWidth="3"
                points={allScenes
                  .map((item, index) => {
                    const x = (index / (allScenes.length - 1)) * 94 + 3; // percentage
                    const y = 100 - (item.scene.intensityScore / 10) * 80 - 10; // percentage
                    return `${x}%,${y}%`;
                  })
                  .join(' ')}
              />
            )}

            {/* Gradient definition */}
            <defs>
              <linearGradient id="tensionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="50%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#f43f5e" />
              </linearGradient>
            </defs>

            {/* Nodes on curve */}
            {allScenes.map((item, index) => {
              const xPercent = (index / Math.max(1, allScenes.length - 1)) * 94 + 3;
              const yPercent = 100 - (item.scene.intensityScore / 10) * 80 - 10;
              const isSelected = item.scene.id === selectedItem?.scene.id;

              return (
                <g
                  key={item.scene.id}
                  onClick={() => setSelectedSceneId(item.scene.id)}
                  className="cursor-pointer group"
                >
                  <circle
                    cx={`${xPercent}%`}
                    cy={`${yPercent}%`}
                    r={isSelected ? '8' : '5'}
                    fill={isSelected ? '#f43f5e' : '#06b6d4'}
                    stroke="#ffffff"
                    strokeWidth={isSelected ? '3' : '1.5'}
                    className="transition-all hover:scale-125"
                  />
                  <text
                    x={`${xPercent}%`}
                    y={`${yPercent - 12}%`}
                    textAnchor="middle"
                    fill={isSelected ? '#38bdf8' : '#94a3b8'}
                    fontSize="10"
                    fontWeight="bold"
                  >
                    {item.scene.intensityScore}/10
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* 3-ACT SCENARIO BREAKDOWN & SCENE DETAIL */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* SCENES LIST COLUMN */}
        <div className="space-y-3" data-tour="scenario__4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('scenario.allScenesHeading', { n: String(allScenes.length) })}
          </h3>
          <div className="space-y-2">
            {allScenes.map((item) => {
              const isSel = item.scene.id === selectedItem?.scene.id;
              return (
                <div
                  key={item.scene.id}
                  onClick={() => setSelectedSceneId(item.scene.id)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    isSel
                      ? 'bg-slate-950 border-cyan-500 shadow-md ring-1 ring-cyan-500/30'
                      : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold uppercase text-cyan-400">
                      {t('scenario.actLabel', { n: String(item.scene.act), chapter: item.chapterTitle })}
                    </span>
                    <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1">
                      <Flame className="w-3 h-3" /> {item.scene.intensityScore}/10
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-200">{item.scene.title}</h4>
                  <p className="text-[11px] text-slate-400 line-clamp-2 mt-1">
                    {item.scene.summary}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ACTIVE SCENE DOSSIER */}
        {selectedItem ? (
          <div className="lg:col-span-2 space-y-4">
            <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
              
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                    {t('scenario.actLabel', { n: String(selectedItem.scene.act), chapter: selectedItem.chapterTitle })}
                  </span>
                  <h3 className="text-base font-bold text-white">
                    {selectedItem.scene.title}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onNavigateToSection(selectedItem.chapterId, selectedItem.sectionId)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs shadow-xs"
                  >
                    <span>{t('scenario.openInEditorBtn')}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Form parameters */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">{t('scenario.sceneTitleLabel')}</label>
                  <input
                    type="text"
                    value={selectedItem.scene.title}
                    onChange={(e) => handleUpdateScene({ ...selectedItem.scene, title: e.target.value })}
                    className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">{t('scenario.locationLabel')}</label>
                  <input
                    type="text"
                    value={selectedItem.scene.location}
                    onChange={(e) => handleUpdateScene({ ...selectedItem.scene, location: e.target.value })}
                    className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">{t('scenario.intensityLabel')}</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={selectedItem.scene.intensityScore}
                    onChange={(e) => handleUpdateScene({ ...selectedItem.scene, intensityScore: Number(e.target.value) })}
                    className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-amber-300 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('scenario.summaryLabel')}</label>
                <textarea
                  rows={2}
                  value={selectedItem.scene.summary}
                  onChange={(e) => handleUpdateScene({ ...selectedItem.scene, summary: e.target.value })}
                  className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('scenario.conflictLabel')}</label>
                <textarea
                  rows={2}
                  value={selectedItem.scene.conflict}
                  onChange={(e) => handleUpdateScene({ ...selectedItem.scene, conflict: e.target.value })}
                  className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>

              {/* Characters inside this Scene */}
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-cyan-400" />
                    {t('scenario.sceneCharactersLabel', { n: String(selectedItem.scene.characters.length) })}
                  </span>

                  {/* Add Character Dropdown */}
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        handleAddCharacterToScene(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    className="text-xs bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2 py-1"
                    defaultValue=""
                  >
                    <option value="" disabled>{t('scenario.addCharacterOption')}</option>
                    {book.characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.surname || ''} ({c.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {selectedItem.scene.characters.map((scChar) => {
                    const char = book.characters.find((c) => c.id === scChar.characterId);
                    return (
                      <div
                        key={scChar.characterId}
                        className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-200">
                            {char?.name} {char?.surname || ''}
                          </span>
                          <button
                            onClick={() => handleRemoveCharacterFromScene(scChar.characterId)}
                            className="text-slate-500 hover:text-rose-400"
                            title={t('scenario.removeFromSceneTooltip')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500">{t('scenario.characterGoalLabel')}</span>
                          <input
                            type="text"
                            value={scChar.goal}
                            onChange={(e) => {
                              const updatedChars = selectedItem.scene.characters.map((c) =>
                                c.characterId === scChar.characterId ? { ...c, goal: e.target.value } : c
                              );
                              handleUpdateScene({ ...selectedItem.scene, characters: updatedChars });
                            }}
                            className="w-full p-1.5 rounded bg-slate-950 border border-slate-800 text-slate-300"
                          />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500">{t('scenario.emotionalStateLabel')}</span>
                          <input
                            type="text"
                            value={scChar.emotionalState}
                            onChange={(e) => {
                              const updatedChars = selectedItem.scene.characters.map((c) =>
                                c.characterId === scChar.characterId ? { ...c, emotionalState: e.target.value } : c
                              );
                              handleUpdateScene({ ...selectedItem.scene, characters: updatedChars });
                            }}
                            className="w-full p-1.5 rounded bg-slate-950 border border-slate-800 text-slate-300"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* AI Dramaturgy Notes Box */}
              <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    {t('scenario.aiAnalysisHeading')}
                  </span>
                  <button
                    onClick={handleAnalyzeDramaturgy}
                    disabled={isAnalyzingDrama}
                    data-tour="scenario__5"
                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-xs"
                  >
                    {isAnalyzingDrama ? t('scenario.analyzing') : t('scenario.runAnalysisBtn')}
                  </button>
                </div>
                <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {selectedItem.scene.aiDramaturgyNotes ||
                    t('scenario.aiNotesPlaceholder')}
                </p>
              </div>

            </div>
          </div>
        ) : null}
      </div>

    </div>
  );
};
