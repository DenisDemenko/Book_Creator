import React, { useEffect, useMemo, useState } from 'react';
import {
  AlignLeft,
  ArrowRight,
  BookOpen,
  Columns3,
  Eye,
  Flame,
  GitBranch,
  LayoutGrid,
  MapPin,
  PanelRightClose,
  PanelRightOpen,
  Search,
  SlidersHorizontal,
  Sparkles,
  Users,
} from 'lucide-react';
import type { Book, Scene } from '../../types';

type WorkspaceMode = 'text' | 'cards' | 'plot';

interface SceneItem {
  scene: Scene;
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
  content: string;
}

export interface ScreenplaySelectedSceneContext {
  sceneId: string;
  chapterId: string;
  sectionId: string;
  title: string;
  summary: string;
  conflict: string;
  location: string;
  intensityScore: number;
  content: string;
}

interface ScreenplayWorkspaceViewProps {
  book: Book;
  onNavigateToSection?: (chapterId: string, sectionId: string) => void;
  onOpenCharacters?: () => void;
  onOpenRelationships?: () => void;
  onOpenDiagnostics?: () => void;
  onSelectedSceneChange?: (scene: ScreenplaySelectedSceneContext | null) => void;
  className?: string;
}

const modeButtonClass = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
    active ? 'bg-slate-100 text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
  }`;

const getSceneHeading = (scene: Scene) => scene.location?.trim().toUpperCase() || scene.title?.trim().toUpperCase() || 'СЦЕНА';
const getPlotTrack = (scene: Scene) => (scene.act === 1 ? 'A' : scene.act === 2 ? 'B' : 'C');

export const ScreenplayWorkspaceView: React.FC<ScreenplayWorkspaceViewProps> = ({
  book,
  onNavigateToSection,
  onOpenCharacters,
  onOpenRelationships,
  onOpenDiagnostics,
  onSelectedSceneChange,
  className = '',
}) => {
  const [mode, setMode] = useState<WorkspaceMode>('text');
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [query, setQuery] = useState('');

  const scenes = useMemo<SceneItem[]>(() => {
    const rows: SceneItem[] = [];
    book.chapters.forEach((chapter) => {
      chapter.sections.forEach((section) => {
        if (!section.scene) return;
        rows.push({
          scene: section.scene,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          sectionId: section.id,
          sectionTitle: section.title,
          content: section.content || '',
        });
      });
    });
    return rows;
  }, [book.chapters]);

  const filteredScenes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return scenes;
    return scenes.filter((item) => [item.scene.title, item.scene.summary, item.scene.location, item.chapterTitle, item.sectionTitle]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(needle));
  }, [query, scenes]);

  const selected = scenes.find((item) => item.scene.id === selectedSceneId) || filteredScenes[0] || scenes[0] || null;

  useEffect(() => {
    if (!onSelectedSceneChange) return;
    if (!selected) {
      onSelectedSceneChange(null);
      return;
    }
    onSelectedSceneChange({
      sceneId: selected.scene.id,
      chapterId: selected.chapterId,
      sectionId: selected.sectionId,
      title: selected.scene.title || selected.sectionTitle,
      summary: selected.scene.summary || '',
      conflict: selected.scene.conflict || '',
      location: selected.scene.location || '',
      intensityScore: selected.scene.intensityScore ?? 0,
      content: selected.content || '',
    });
  }, [onSelectedSceneChange, selected?.scene.id, selected?.scene.title, selected?.scene.summary, selected?.scene.conflict, selected?.scene.location, selected?.scene.intensityScore, selected?.content, selected?.chapterId, selected?.sectionId, selected?.sectionTitle]);

  const selectScene = (item: SceneItem) => setSelectedSceneId(item.scene.id);
  const openInText = (item: SceneItem) => {
    setSelectedSceneId(item.scene.id);
    setMode('text');
    onNavigateToSection?.(item.chapterId, item.sectionId);
  };

  return (
    <section className={`flex min-h-0 flex-1 flex-col bg-slate-950 text-slate-100 ${className}`} data-story-experience="screenplay">
      <header className="border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur lg:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">
              <span>Screenplay Studio</span><span className="text-slate-600">/</span><span className="truncate text-slate-500">{book.title}</span>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="truncate text-lg font-bold text-white">Сценарний простір</h1>
              <span className="hidden rounded-full border border-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400 sm:inline-flex">{scenes.length} сцен</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1">
              <button type="button" onClick={() => setMode('text')} className={modeButtonClass(mode === 'text')}><AlignLeft className="h-3.5 w-3.5" />Текст</button>
              <button type="button" onClick={() => setMode('cards')} className={modeButtonClass(mode === 'cards')}><LayoutGrid className="h-3.5 w-3.5" />Картки</button>
              <button type="button" onClick={() => setMode('plot')} className={modeButtonClass(mode === 'plot')}><GitBranch className="h-3.5 w-3.5" />Лінії</button>
            </div>
            <button type="button" onClick={() => setInspectorOpen((value) => !value)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:text-white">
              {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}<span className="hidden sm:inline">Inspector</span>
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onOpenCharacters} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-900 hover:text-white"><Users className="h-3.5 w-3.5" />Персонажі</button>
          <button type="button" onClick={onOpenRelationships} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-900 hover:text-white"><Columns3 className="h-3.5 w-3.5" />Зв’язки</button>
          <button type="button" onClick={onOpenDiagnostics} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-900 hover:text-white"><Sparkles className="h-3.5 w-3.5" />Діагностика</button>
          <span className="mx-1 hidden h-4 w-px bg-slate-800 md:block" />
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500"><Eye className="h-3.5 w-3.5" />AI лише пропонує — рішення за автором</span>
        </div>
      </header>

      {mode === 'text' && (
        <div className={`grid min-h-0 flex-1 ${inspectorOpen ? 'xl:grid-cols-[260px_minmax(0,1fr)_310px]' : 'xl:grid-cols-[260px_minmax(0,1fr)]'}`}>
          <aside className="min-h-0 border-r border-slate-800 bg-slate-950">
            <div className="border-b border-slate-800 p-3">
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Знайти сцену…" className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-500/70" /></div>
            </div>
            <div className="max-h-[calc(100vh-250px)] space-y-1 overflow-y-auto p-2">
              {filteredScenes.map((item, index) => {
                const active = selected?.scene.id === item.scene.id;
                return <button type="button" key={item.scene.id} onClick={() => selectScene(item)} onDoubleClick={() => openInText(item)} className={`w-full rounded-xl border p-3 text-left transition-colors ${active ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-transparent hover:border-slate-800 hover:bg-slate-900'}`}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide"><span className={active ? 'text-cyan-300' : 'text-slate-500'}>{String(index + 1).padStart(2, '0')} · ACT {item.scene.act || 1}</span><span className="inline-flex items-center gap-1 text-amber-300"><Flame className="h-3 w-3" />{item.scene.intensityScore ?? 0}/10</span></div>
                  <div className="truncate text-xs font-bold text-slate-100">{item.scene.title || item.sectionTitle}</div>
                  <div className="mt-1 flex items-center gap-1 truncate text-[10px] text-slate-500"><MapPin className="h-3 w-3 shrink-0" />{item.scene.location || item.chapterTitle}</div>
                </button>;
              })}
              {!filteredScenes.length && <div className="p-4 text-center text-xs text-slate-500">Нічого не знайдено.</div>}
            </div>
          </aside>

          <main className="min-w-0 bg-slate-900/45">
            {selected ? <div className="mx-auto max-w-4xl px-5 py-7 lg:px-10 lg:py-10">
              <div className="mb-5 flex items-start justify-between gap-4"><div><div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Scene {String(Math.max(1, scenes.findIndex((item) => item.scene.id === selected.scene.id) + 1)).padStart(2, '0')}</div><h2 className="text-xl font-bold text-white">{selected.scene.title || selected.sectionTitle}</h2></div><button type="button" onClick={() => openInText(selected)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-500/60 hover:text-white">Відкрити у «Книга & Текст» <ArrowRight className="h-3.5 w-3.5" /></button></div>
              <article className="min-h-[520px] rounded-2xl border border-slate-800 bg-slate-950 px-6 py-8 shadow-2xl shadow-black/20 sm:px-10 lg:px-14">
                <div className="mb-6 font-mono text-sm font-bold uppercase tracking-wide text-slate-100">{getSceneHeading(selected.scene)}</div>
                {selected.content?.trim() ? <div className="prose prose-invert max-w-none text-sm leading-7 prose-p:text-slate-200" dangerouslySetInnerHTML={{ __html: selected.content }} /> : <div className="flex min-h-80 flex-col items-center justify-center text-center"><BookOpen className="mb-3 h-9 w-9 text-slate-700" /><p className="max-w-sm text-sm font-semibold text-slate-300">У цій сцені поки немає тексту.</p><p className="mt-1 max-w-sm text-xs text-slate-500">Відкрийте сцену в основному редакторі й продовжуйте писати без дублювання тексту.</p></div>}
              </article>
            </div> : <div className="flex h-full min-h-[520px] items-center justify-center text-sm text-slate-500">Додайте першу сцену, щоб відкрити сценарний простір.</div>}
          </main>

          {inspectorOpen && <aside className="min-h-0 border-l border-slate-800 bg-slate-950 p-4">
            <div className="mb-4 flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Inspector</div><h3 className="mt-0.5 text-sm font-bold text-white">{selected?.scene.title || 'Сцена'}</h3></div><SlidersHorizontal className="h-4 w-4 text-slate-600" /></div>
            {selected && <div className="space-y-4">
              <InspectorField label="Мета сцени" value={selected.scene.summary || 'Не задано'} />
              <InspectorField label="Конфлікт" value={selected.scene.conflict || 'Не задано'} />
              <InspectorField label="Локація" value={selected.scene.location || 'Не задано'} />
              <InspectorField label="Сюжетна лінія" value={`${getPlotTrack(selected.scene)} — ${selected.scene.act ? `акт ${selected.scene.act}` : 'основна'}`} />
              <InspectorField label="Інтенсивність" value={`${selected.scene.intensityScore ?? 0}/10`} />
              <div><div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Персонажі</div><div className="flex flex-wrap gap-1.5">{selected.scene.characters.length ? selected.scene.characters.map((character) => <span key={character.characterId} className="rounded-full border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] text-slate-300">{book.characters.find((item) => item.id === character.characterId)?.name || character.characterId}</span>) : <span className="text-xs text-slate-600">Не додані</span>}</div></div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"><div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-300"><Sparkles className="h-3 w-3" />AI proposal</div><p className="text-xs leading-5 text-slate-400">Пропозиції відкриваються окремо й не застосовуються автоматично.</p></div>
            </div>}
          </aside>}
        </div>
      )}

      {mode === 'cards' && <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6"><div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">{scenes.map((item, index) => <button type="button" key={item.scene.id} onClick={() => selectScene(item)} onDoubleClick={() => openInText(item)} className="group min-h-44 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-500/50 hover:shadow-xl hover:shadow-black/20"><div className="mb-3 flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">{String(index + 1).padStart(2, '0')} · ACT {item.scene.act || 1}</span><span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300"><Flame className="h-3 w-3" />{item.scene.intensityScore ?? 0}/10</span></div><h3 className="text-sm font-bold text-white">{item.scene.title || item.sectionTitle}</h3><p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-400">{item.scene.summary || 'Короткий опис сцени ще не додано.'}</p><div className="mt-4 flex flex-wrap gap-1.5"><span className="rounded-full border border-slate-800 px-2 py-1 text-[10px] text-slate-500">{getPlotTrack(item.scene)}-line</span>{item.scene.location && <span className="max-w-40 truncate rounded-full border border-slate-800 px-2 py-1 text-[10px] text-slate-500">{item.scene.location}</span>}{!!item.scene.characters?.length && <span className="rounded-full border border-slate-800 px-2 py-1 text-[10px] text-slate-500">{item.scene.characters.length} гер.</span>}</div></button>)}</div></div>}

      {mode === 'plot' && <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6"><div className="min-w-[860px] rounded-2xl border border-slate-800 bg-slate-900 p-4"><div className="mb-4 flex items-center justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Plot Lines</div><h2 className="mt-1 text-base font-bold text-white">Сюжетні лінії по сценах</h2></div><span className="text-xs text-slate-500">Натисніть сцену, щоб перейти до тексту</span></div>{(['A', 'B', 'C'] as const).map((track) => <div key={track} className="grid grid-cols-[110px_1fr] items-center gap-3 border-t border-slate-800 py-3 first:border-t-0"><div><div className="text-xs font-bold text-white">{track}-line</div><div className="text-[10px] text-slate-500">{track === 'A' ? 'Основна' : track === 'B' ? 'Другий акт' : 'Фінальна'}</div></div><div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(scenes.length, 1)}, minmax(66px, 1fr))` }}>{scenes.map((item, index) => { const onTrack = getPlotTrack(item.scene) === track; return <button type="button" key={`${track}-${item.scene.id}`} onClick={() => openInText(item)} className={`h-14 rounded-lg border px-2 text-left transition ${onTrack ? 'border-violet-400/45 bg-violet-400/15 text-violet-100 hover:bg-violet-400/20' : 'border-slate-800 bg-slate-950 text-slate-700 hover:border-slate-700'}`} title={item.scene.title || item.sectionTitle}><span className="block text-[9px] font-bold">{String(index + 1).padStart(2, '0')}</span>{onTrack && <span className="mt-1 block truncate text-[10px]">{item.scene.title || item.sectionTitle}</span>}</button>; })}</div></div>)}</div></div>}
    </section>
  );
};

const InspectorField: React.FC<{ label: string; value: string }> = ({ label, value }) => <div><div className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div><div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs leading-5 text-slate-300">{value}</div></div>;
