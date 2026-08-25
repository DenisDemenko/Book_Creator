import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Network,
  Plus,
  Link2,
  Link2Off,
  StickyNote,
  Trash2,
  Save,
  X,
  Crosshair,
  Lightbulb,
} from 'lucide-react';
import {
  Book,
  CharacterRelationship,
  MindBoardPos,
  MindBoardSticky,
  UserRole,
} from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface MindBoardViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  currentRole?: UserRole;
  onNavigateToTab?: (tab: 'characters' | 'editor' | 'scenario') => void;
}

/** Розмір поля дошки в пікселях — по ньому рахуються типові позиції. */
const BOARD_W = 2000;
const BOARD_H = 1400;
const CENTER: MindBoardPos = { x: BOARD_W / 2, y: BOARD_H / 2 - 120 };
/** Радіус кола, по якому розкладаються герої навколо задуму. */
const ORBIT_RX = 420;
const ORBIT_RY = 300;

const RELATION_TYPES: CharacterRelationship['type'][] = [
  'love',
  'friendship',
  'family',
  'conflict',
  'rivalry',
  'alliance',
  'secret',
];

/**
 * Типова позиція героя, якщо його ще не пересували: рівномірно по колу
 * навколо центрального задуму. Індекс беремо зі списку героїв книги, тож
 * розкладка стабільна між відкриттями.
 */
function defaultCharacterPos(index: number, total: number): MindBoardPos {
  const angle = (2 * Math.PI * index) / Math.max(total, 1) - Math.PI / 2;
  return {
    x: CENTER.x + ORBIT_RX * Math.cos(angle),
    y: CENTER.y + ORBIT_RY * Math.sin(angle),
  };
}

/** Типова позиція стікера: рядок унизу дошки. */
function defaultStickyPos(index: number): MindBoardPos {
  return { x: 240 + (index % 5) * 300, y: BOARD_H - 260 + Math.floor(index / 5) * 190 };
}

type DragTarget =
  | { kind: 'concept' }
  | { kind: 'character'; id: string }
  | { kind: 'sticky'; id: string };

/**
 * Mind Board — дошка задуму книги.
 *
 * Головний принцип: дошка нічого не дублює. У центрі — задум книги з полів
 * `book.logline` / `book.theme` / `book.genre`; промені навколо — це
 * `book.characters`; зв'язки між героями — це їхні `relationships`, ті самі,
 * що показує розділ «Персонажі». Тому опис героя, змінений тут, одразу
 * відображається і в решті розділів, і навпаки. У `book.mindBoard`
 * зберігаються лише координати вузлів та стікери ідей.
 */
export const MindBoardView: React.FC<MindBoardViewProps> = ({
  book,
  onUpdateBook,
  currentRole,
  onNavigateToTab,
}) => {
  const { t } = useLanguage();
  const isReader = currentRole === 'reader';

  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ target: DragTarget; offsetX: number; offsetY: number } | null>(null);

  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  /** Режим дошки: вільна розкладка / хмари глав / хмари сцен. */
  const [groupMode, setGroupMode] = useState<'free' | 'chapters' | 'scenes'>('free');
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [draftBio, setDraftBio] = useState<string>('');
  const [bioDirty, setBioDirty] = useState(false);

  const mindBoard = book.mindBoard ?? {};
  const stickies = mindBoard.stickies ?? [];
  const conceptPos = mindBoard.conceptPos ?? CENTER;

  const posOf = useCallback(
    (charId: string, index: number): MindBoardPos =>
      mindBoard.characterPos?.[charId] ?? defaultCharacterPos(index, book.characters.length),
    [mindBoard.characterPos, book.characters.length]
  );

  const selectedChar = book.characters.find((c) => c.id === selectedCharId) || null;

  // Підтягуємо опис обраного героя в чернетку панелі редагування.
  useEffect(() => {
    setDraftBio(selectedChar?.biography ?? '');
    setBioDirty(false);
  }, [selectedChar?.id, selectedChar?.biography]);

  /** Записує лише розкладку дошки, не чіпаючи самі дані героїв. */
  const patchBoard = (patch: Partial<NonNullable<Book['mindBoard']>>) => {
    onUpdateBook({ ...book, mindBoard: { ...mindBoard, ...patch } });
  };

  // ---- Перетягування вузлів -------------------------------------------------

  const startDrag = (e: React.MouseEvent, target: DragTarget, current: MindBoardPos) => {
    if (isReader) return;
    e.stopPropagation();
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      target,
      offsetX: e.clientX - rect.left - current.x,
      offsetY: e.clientY - rect.top - current.y,
    };
  };

  /**
   * Поки вузол тягнуть, його позиція живе тільки тут. У книгу вона
   * записується один раз — на відпускання миші. Інакше кожен рух миші
   * означав би оновлення книги, тобто автозбереження й запис в аудит-лог
   * десятки разів на секунду.
   */
  const [livePos, setLivePos] = useState<{ target: DragTarget; pos: MindBoardPos } | null>(null);

  /** Записує підсумкову позицію вузла в книгу (один раз, після перетягування). */
  const commitPos = (target: DragTarget, pos: MindBoardPos) => {
    if (target.kind === 'concept') {
      patchBoard({ conceptPos: pos });
    } else if (target.kind === 'character') {
      patchBoard({ characterPos: { ...(mindBoard.characterPos ?? {}), [target.id]: pos } });
    } else {
      patchBoard({ stickies: stickies.map((s) => (s.id === target.id ? { ...s, x: pos.x, y: pos.y } : s)) });
    }
  };

  /** Позиція вузла з урахуванням активного перетягування. */
  const withLive = (target: DragTarget, base: MindBoardPos): MindBoardPos => {
    if (!livePos) return base;
    const l = livePos.target;
    if (l.kind !== target.kind) return base;
    if (l.kind === 'concept') return livePos.pos;
    if (l.kind === 'character' && target.kind === 'character' && l.id === target.id) return livePos.pos;
    if (l.kind === 'sticky' && target.kind === 'sticky' && l.id === target.id) return livePos.pos;
    return base;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      const rect = boardRef.current?.getBoundingClientRect();
      if (!drag || !rect) return;

      // Тримаємо вузол у межах поля дошки.
      const x = Math.max(60, Math.min(BOARD_W - 60, e.clientX - rect.left - drag.offsetX));
      const y = Math.max(60, Math.min(BOARD_H - 60, e.clientY - rect.top - drag.offsetY));
      setLivePos({ target: drag.target, pos: { x, y } });
    };

    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;

      setLivePos((live) => {
        if (live) commitPos(live.target, live.pos);
        return null;
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  });

  // ---- Зв'язки між героями --------------------------------------------------

  /**
   * Клік по герою в режимі зв'язку: перший клік — джерело, другий — ціль.
   * Зв'язок пишеться у `relationships` героя-джерела, тобто в ту саму
   * структуру, якою користується розділ «Персонажі».
   */
  const handleCharacterClick = (charId: string) => {
    if (!linkMode) {
      setSelectedCharId(charId);
      return;
    }
    if (!linkSource) {
      setLinkSource(charId);
      return;
    }
    if (linkSource === charId) {
      setLinkSource(null);
      return;
    }

    const source = book.characters.find((c) => c.id === linkSource);
    const target = book.characters.find((c) => c.id === charId);
    if (!source || !target) return;

    const exists = (source.relationships ?? []).some((r) => r.targetCharacterId === charId);
    if (!exists) {
      const updated = book.characters.map((c) =>
        c.id === linkSource
          ? {
              ...c,
              relationships: [
                ...(c.relationships ?? []),
                { targetCharacterId: charId, type: 'alliance' as const, description: '' },
              ],
            }
          : c
      );
      onUpdateBook(
        { ...book, characters: updated },
        'Mind Board: додано зв’язок',
        `${source.name} → ${target.name}`
      );
    }
    setLinkSource(null);
  };

  const removeRelation = (sourceId: string, targetId: string) => {
    const updated = book.characters.map((c) =>
      c.id === sourceId
        ? { ...c, relationships: (c.relationships ?? []).filter((r) => r.targetCharacterId !== targetId) }
        : c
    );
    onUpdateBook({ ...book, characters: updated });
  };

  const changeRelationType = (sourceId: string, targetId: string, type: CharacterRelationship['type']) => {
    const updated = book.characters.map((c) =>
      c.id === sourceId
        ? {
            ...c,
            relationships: (c.relationships ?? []).map((r) =>
              r.targetCharacterId === targetId ? { ...r, type } : r
            ),
          }
        : c
    );
    onUpdateBook({ ...book, characters: updated });
  };

  // ---- Опис героя -----------------------------------------------------------

  /**
   * Зберігає опис у `book.characters` — тобто в те саме поле `biography`,
   * яке читають «Персонажі» й підставляє AI під час роботи з текстом.
   */
  const saveBio = () => {
    if (!selectedChar) return;
    const updated = book.characters.map((c) =>
      c.id === selectedChar.id ? { ...c, biography: draftBio } : c
    );
    onUpdateBook(
      { ...book, characters: updated },
      'Mind Board: оновлено опис героя',
      `${selectedChar.name} ${selectedChar.surname || ''}`.trim()
    );
    setBioDirty(false);
  };

  // ---- Стікери ідей ---------------------------------------------------------

  const addSticky = () => {
    const pos = defaultStickyPos(stickies.length);
    const sticky: MindBoardSticky = {
      id: `sticky-${Date.now()}`,
      text: '',
      x: pos.x,
      y: pos.y,
    };
    patchBoard({ stickies: [...stickies, sticky] });
  };

  const updateSticky = (id: string, text: string) => {
    patchBoard({ stickies: stickies.map((s) => (s.id === id ? { ...s, text } : s)) });
  };

  const removeSticky = (id: string) => {
    patchBoard({ stickies: stickies.filter((s) => s.id !== id) });
  };

  // ---- Групування за главами та сценами -------------------------------------

  /**
   * Групи для режимів «Глави» та «Сцени».
   *
   * Склад глави береться з `Chapter.cast` (затверджений варіант 2), а
   * учасники сцени — з `Section.scene.characters`. Порожні групи не
   * показуємо, щоб дошка не заростала пустими хмарами.
   */
  const groups: { id: string; title: string; subtitle: string; memberIds: string[] }[] =
    groupMode === 'chapters'
      ? book.chapters
          .map((ch) => ({
            id: ch.id,
            title: ch.title,
            subtitle: t('mindBoard.chapterSubtitle', { n: ch.sections.length }),
            memberIds: (ch.cast ?? []).filter((id) => book.characters.some((c) => c.id === id)),
          }))
          .filter((g) => g.memberIds.length > 0)
      : groupMode === 'scenes'
        ? book.chapters
            .flatMap((ch) =>
              ch.sections
                .filter((sec) => sec.scene && sec.scene.characters.length > 0)
                .map((sec) => ({
                  id: sec.scene!.id,
                  title: sec.scene!.title || sec.title,
                  subtitle: ch.title,
                  memberIds: sec.scene!.characters
                    .map((cs) => cs.characterId)
                    .filter((id) => book.characters.some((c) => c.id === id)),
                }))
            )
            .filter((g) => g.memberIds.length > 0)
        : [];

  /** Розкладка хмар: рівномірна сітка по полю дошки. */
  const GROUP_COLS = 3;
  const GROUP_W = BOARD_W / GROUP_COLS;
  const GROUP_H = 430;
  const groupCenter = (i: number) => ({
    x: GROUP_W * (i % GROUP_COLS) + GROUP_W / 2,
    y: 240 + Math.floor(i / GROUP_COLS) * GROUP_H,
  });
  /** Позиція учасника всередині хмари — по колу навколо її центру. */
  const memberPos = (groupIdx: number, memberIdx: number, total: number): MindBoardPos => {
    const c = groupCenter(groupIdx);
    const angle = (2 * Math.PI * memberIdx) / Math.max(total, 1) - Math.PI / 2;
    const rx = total <= 1 ? 0 : 150;
    const ry = total <= 1 ? 0 : 105;
    return { x: c.x + rx * Math.cos(angle), y: c.y + ry * Math.sin(angle) };
  };

  /**
   * Чи є між двома героями звʼязок (у будь-якому напрямку). Саме за цим
   * правилом малюються лінії взаємодії всередині хмари — затверджений
   * варіант «лише пари зі звʼязком», а не «кожен з кожним».
   */
  const hasRelation = (aId: string, bId: string): boolean => {
    const a = book.characters.find((c) => c.id === aId);
    const b = book.characters.find((c) => c.id === bId);
    return (
      (a?.relationships ?? []).some((r) => r.targetCharacterId === bId) ||
      (b?.relationships ?? []).some((r) => r.targetCharacterId === aId)
    );
  };

  /** Висота поля: у режимі груп росте під кількість хмар. */
  const boardHeight =
    groupMode === 'free'
      ? BOARD_H
      : Math.max(BOARD_H, 240 + Math.ceil(groups.length / GROUP_COLS) * GROUP_H + 200);

  // ---- Рендер ---------------------------------------------------------------

  const conceptLive = withLive({ kind: 'concept' }, conceptPos);
  const charEntries = book.characters.map((c, i) => ({
    char: c,
    pos: withLive({ kind: 'character', id: c.id }, posOf(c.id, i)),
  }));
  const posById = new Map(charEntries.map((e) => [e.char.id, e.pos]));

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
      {/* Панель інструментів */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-800 flex-wrap">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-bold text-slate-100">{t('mindBoard.title')}</span>
          <span className="text-[11px] text-slate-500 font-mono">
            {t('mindBoard.counters', { chars: book.characters.length, ideas: stickies.length })}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Перемикач режимів: вільна дошка / хмари глав / хмари сцен */}
          <div className="flex items-center rounded-xl bg-slate-900 border border-slate-800 p-0.5">
            {(['free', 'chapters', 'scenes'] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setGroupMode(m);
                  setLinkMode(false);
                  setLinkSource(null);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                  groupMode === m ? 'bg-cyan-500/25 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
                }`}
                title={t(`mindBoard.mode_${m}_title`)}
              >
                {t(`mindBoard.mode_${m}`)}
              </button>
            ))}
          </div>

          <button
            hidden={groupMode !== 'free'}
            onClick={() => {
              setLinkMode((v) => !v);
              setLinkSource(null);
            }}
            disabled={isReader}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-bold transition-all disabled:opacity-50 ${
              linkMode
                ? 'bg-slate-200/15 border-slate-300/50 text-slate-100'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
            title={t('mindBoard.linkModeTitle')}
          >
            {linkMode ? <Link2Off className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
            <span>{linkMode ? t('mindBoard.linkModeOff') : t('mindBoard.linkModeOn')}</span>
          </button>

          <button
            onClick={addSticky}
            disabled={isReader}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold hover:bg-amber-500/30 transition-all disabled:opacity-50"
            title={t('mindBoard.addIdeaTitle')}
          >
            <StickyNote className="w-3.5 h-3.5" />
            <span>{t('mindBoard.addIdea')}</span>
          </button>

          <button
            onClick={() => patchBoard({ conceptPos: CENTER, characterPos: {} })}
            disabled={isReader}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 text-[11px] font-bold hover:bg-slate-800 transition-all disabled:opacity-50"
            title={t('mindBoard.resetTitle')}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>{t('mindBoard.reset')}</span>
          </button>
        </div>
      </div>

      {linkMode && (
        <div className="shrink-0 px-4 py-1.5 bg-slate-200/10 border-b border-slate-300/20 text-[11px] text-slate-200">
          {linkSource
            ? t('mindBoard.linkHintSecond', {
                name: book.characters.find((c) => c.id === linkSource)?.name || '',
              })
            : t('mindBoard.linkHintFirst')}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Поле дошки */}
        <div className="flex-1 overflow-auto">
          <div
            ref={boardRef}
            className="relative bg-grid-faint"
            style={{ width: BOARD_W, height: boardHeight }}
            onMouseDown={() => setSelectedCharId(null)}
          >
            {/* Лінії: спершу промені до задуму, потім срібні зв'язки героїв */}
            <svg className="absolute inset-0 pointer-events-none" width={BOARD_W} height={boardHeight}>
              <defs>
                <filter id="silver-glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Кожен герой прикріплений до центрального задуму */}
              {groupMode === 'free' && charEntries.map(({ char, pos }) => (
                <line
                  key={`spoke-${char.id}`}
                  x1={conceptLive.x}
                  y1={conceptLive.y}
                  x2={pos.x}
                  y2={pos.y}
                  stroke="rgba(148,163,184,0.35)"
                  strokeWidth={1.5}
                />
              ))}

              {/* Зв'язки між героями — сяють сріблом */}
              {groupMode === 'free' && charEntries.flatMap(({ char, pos }) =>
                (char.relationships ?? []).map((rel) => {
                  const target = posById.get(rel.targetCharacterId);
                  if (!target) return null;
                  return (
                    <line
                      key={`rel-${char.id}-${rel.targetCharacterId}`}
                      x1={pos.x}
                      y1={pos.y}
                      x2={target.x}
                      y2={target.y}
                      stroke="#e2e8f0"
                      strokeWidth={2}
                      strokeLinecap="round"
                      filter="url(#silver-glow)"
                      opacity={0.9}
                    />
                  );
                })
              )}

              {/* Режим груп: хмара навколо учасників глави або сцени, плюс
                  срібні лінії взаємодії — лише між парами, у яких є звʼязок. */}
              {groupMode !== 'free' &&
                groups.map((g, gi) => {
                  const c = groupCenter(gi);
                  const single = g.memberIds.length <= 1;
                  return (
                    <g key={`cloud-${g.id}`}>
                      <ellipse
                        cx={c.x}
                        cy={c.y}
                        rx={single ? 150 : 250}
                        ry={single ? 120 : 185}
                        fill="rgba(34,211,238,0.05)"
                        stroke="rgba(148,163,184,0.35)"
                        strokeWidth={1.5}
                        strokeDasharray="7 6"
                      />
                      {g.memberIds.flatMap((aId, ai) =>
                        g.memberIds.slice(ai + 1).map((bId, bj) => {
                          if (!hasRelation(aId, bId)) return null;
                          const pa = memberPos(gi, ai, g.memberIds.length);
                          const pb = memberPos(gi, ai + 1 + bj, g.memberIds.length);
                          return (
                            <line
                              key={`gl-${g.id}-${aId}-${bId}`}
                              x1={pa.x}
                              y1={pa.y}
                              x2={pb.x}
                              y2={pb.y}
                              stroke="#e2e8f0"
                              strokeWidth={2}
                              strokeLinecap="round"
                              filter="url(#silver-glow)"
                              opacity={0.9}
                            />
                          );
                        })
                      )}
                    </g>
                  );
                })}
            </svg>

            {/* Центральний вузол — задум книги (лише у вільному режимі) */}
            {groupMode === 'free' && (
            <div
              onMouseDown={(e) => startDrag(e, { kind: 'concept' }, conceptLive)}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-72 p-4 rounded-3xl glass-panel-elevated cursor-grab active:cursor-grabbing select-none"
              style={{ left: conceptLive.x, top: conceptLive.y }}
            >
              <div className="text-[9px] font-bold uppercase tracking-widest text-cyan-300 mb-1">
                {t('mindBoard.conceptLabel')}
              </div>
              <div className="text-sm font-bold text-slate-100 leading-tight">
                {book.title || t('mindBoard.untitled')}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">{book.genre}</div>

              <div className="mt-2 space-y-1.5">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    {t('mindBoard.loglineLabel')}
                  </div>
                  <p className="text-[11px] text-slate-200 leading-snug">
                    {book.logline || <span className="text-slate-600 italic">{t('mindBoard.emptyField')}</span>}
                  </p>
                </div>
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    {t('mindBoard.themeLabel')}
                  </div>
                  <p className="text-[11px] text-slate-200 leading-snug">
                    {book.theme || <span className="text-slate-600 italic">{t('mindBoard.emptyField')}</span>}
                  </p>
                </div>
              </div>

              {onNavigateToTab && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateToTab('scenario');
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="mt-2.5 w-full py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 transition-colors"
                >
                  {t('mindBoard.editConcept')}
                </button>
              )}
            </div>

            )}

            {/* Вузли героїв: вільна розкладка */}
            {groupMode === 'free' && charEntries.map(({ char, pos }) => {
              const isSelected = selectedCharId === char.id;
              const isLinkSource = linkSource === char.id;
              return (
                <div
                  key={char.id}
                  onMouseDown={(e) => startDrag(e, { kind: 'character', id: char.id }, pos)}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCharacterClick(char.id);
                  }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 w-44 p-2.5 rounded-2xl bg-slate-950 border cursor-grab active:cursor-grabbing select-none transition-all ${
                    isLinkSource
                      ? 'border-slate-200 ring-2 ring-slate-200/60'
                      : isSelected
                        ? 'border-amber-400/70 ring-1 ring-amber-400/40'
                        : 'border-slate-800 hover:border-slate-700'
                  }`}
                  style={{ left: pos.x, top: pos.y }}
                >
                  <div className="flex items-center gap-2">
                    {char.avatarUrl ? (
                      <img src={char.avatarUrl} alt="" className="w-9 h-9 rounded-xl object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-sm font-bold text-amber-400 shrink-0">
                        {char.name?.charAt(0) || '?'}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-slate-100 truncate">
                        {char.name} {char.surname || ''}
                      </div>
                      {char.alias && (
                        <div className="text-[9px] text-slate-500 italic truncate">«{char.alias}»</div>
                      )}
                    </div>
                  </div>
                  {char.profession && (
                    <div className="mt-1 text-[9px] text-slate-400 truncate">{char.profession}</div>
                  )}
                </div>
              );
            })}

            {/* Режим груп: підпис хмари + картки її учасників.
                Герой, задіяний у кількох сценах, малюється копією в кожній
                хмарі — тому ключ складений із id групи та id героя. */}
            {groupMode !== 'free' &&
              groups.map((g, gi) => {
                const c = groupCenter(gi);
                return (
                  <React.Fragment key={`grp-${g.id}`}>
                    <div
                      className="absolute -translate-x-1/2 text-center pointer-events-none"
                      style={{ left: c.x, top: c.y - (g.memberIds.length <= 1 ? 150 : 215), width: 320 }}
                    >
                      <div className="text-[11px] font-bold text-slate-100 truncate">{g.title}</div>
                      <div className="text-[9px] text-slate-500 truncate">{g.subtitle}</div>
                    </div>

                    {g.memberIds.map((cid, mi) => {
                      const char = book.characters.find((x) => x.id === cid);
                      if (!char) return null;
                      const pos = memberPos(gi, mi, g.memberIds.length);
                      const isSelected = selectedCharId === cid;
                      return (
                        <div
                          key={`grp-${g.id}-${cid}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCharId(cid);
                          }}
                          className={`absolute -translate-x-1/2 -translate-y-1/2 w-36 p-2 rounded-2xl bg-slate-950 border cursor-pointer select-none transition-all ${
                            isSelected
                              ? 'border-amber-400/70 ring-1 ring-amber-400/40'
                              : 'border-slate-800 hover:border-slate-700'
                          }`}
                          style={{ left: pos.x, top: pos.y }}
                        >
                          <div className="flex items-center gap-1.5">
                            {char.avatarUrl ? (
                              <img src={char.avatarUrl} alt="" className="w-7 h-7 rounded-lg object-cover shrink-0" />
                            ) : (
                              <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-[11px] font-bold text-amber-400 shrink-0">
                                {char.name?.charAt(0) || '?'}
                              </div>
                            )}
                            <span className="text-[10px] font-bold text-slate-100 truncate">{char.name}</span>
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}

            {/* Порожній режим груп — пояснюємо, чому нічого не видно */}
            {groupMode !== 'free' && groups.length === 0 && (
              <div className="absolute left-1/2 top-40 -translate-x-1/2 w-96 p-4 rounded-2xl bg-slate-900 border border-slate-800 text-center">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {groupMode === 'chapters' ? t('mindBoard.noChapterCast') : t('mindBoard.noScenes')}
                </p>
              </div>
            )}

            {/* Стікери з додатковими ідеями */}
            {groupMode === 'free' && stickies.map((s, i) => {
              const base = { x: s.x ?? defaultStickyPos(i).x, y: s.y ?? defaultStickyPos(i).y };
              const pos = withLive({ kind: 'sticky', id: s.id }, base);
              return (
                <div
                  key={s.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2 w-56 rounded-2xl bg-amber-500/10 border border-amber-500/40 shadow-lg"
                  style={{ left: pos.x, top: pos.y }}
                >
                  <div
                    onMouseDown={(e) => startDrag(e, { kind: 'sticky', id: s.id }, pos)}
                    className="flex items-center justify-between px-2.5 py-1.5 cursor-grab active:cursor-grabbing select-none border-b border-amber-500/20"
                  >
                    <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                      <Lightbulb className="w-3 h-3" />
                      {t('mindBoard.ideaLabel')}
                    </span>
                    <button
                      onClick={() => removeSticky(s.id)}
                      onMouseDown={(e) => e.stopPropagation()}
                      disabled={isReader}
                      className="text-amber-400/60 hover:text-rose-300 transition-colors disabled:opacity-40"
                      title={t('mindBoard.removeIdeaTitle')}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <textarea
                    value={s.text}
                    onChange={(e) => updateSticky(s.id, e.target.value)}
                    readOnly={isReader}
                    placeholder={t('mindBoard.ideaPlaceholder')}
                    className="w-full h-24 p-2.5 bg-transparent text-[11px] text-amber-50 leading-relaxed resize-none focus:outline-none placeholder:text-amber-200/30"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Бічна панель обраного героя */}
        {selectedChar && (
          <aside className="w-80 shrink-0 border-l border-slate-800 bg-slate-950 flex flex-col min-h-0">
            <div className="flex items-center justify-between gap-2 p-3 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {selectedChar.avatarUrl ? (
                  <img src={selectedChar.avatarUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-xs font-bold text-amber-400">
                    {selectedChar.name?.charAt(0)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-100 truncate">
                    {selectedChar.name} {selectedChar.surname || ''}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">{selectedChar.profession}</div>
                </div>
              </div>
              <button
                onClick={() => setSelectedCharId(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {t('mindBoard.bioLabel')}
                  </span>
                  {bioDirty && (
                    <button
                      onClick={saveBio}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[10px] font-bold transition-colors"
                    >
                      <Save className="w-3 h-3" />
                      {t('mindBoard.saveBio')}
                    </button>
                  )}
                </div>
                <textarea
                  value={draftBio}
                  onChange={(e) => {
                    setDraftBio(e.target.value);
                    setBioDirty(true);
                  }}
                  readOnly={isReader}
                  placeholder={t('mindBoard.bioPlaceholder')}
                  className="w-full h-40 p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-200 leading-relaxed resize-none field-glow"
                />
                <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                  {t('mindBoard.bioSyncNote')}
                </p>
              </div>

              {/* Зв'язки обраного героя */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {t('mindBoard.relationsLabel')}
                </span>
                {(selectedChar.relationships ?? []).length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic">{t('mindBoard.relationsEmpty')}</p>
                ) : (
                  (selectedChar.relationships ?? []).map((rel) => {
                    const target = book.characters.find((c) => c.id === rel.targetCharacterId);
                    return (
                      <div
                        key={rel.targetCharacterId}
                        className="flex items-center gap-1.5 p-2 rounded-lg bg-slate-900 border border-slate-800"
                      >
                        <span className="flex-1 min-w-0 text-[11px] text-slate-200 truncate">
                          {target ? `${target.name} ${target.surname || ''}` : rel.targetCharacterId}
                        </span>
                        <select
                          value={rel.type}
                          onChange={(e) =>
                            changeRelationType(
                              selectedChar.id,
                              rel.targetCharacterId,
                              e.target.value as CharacterRelationship['type']
                            )
                          }
                          disabled={isReader}
                          className="bg-slate-950 border border-slate-800 rounded text-[10px] text-slate-300 px-1 py-0.5 cursor-pointer disabled:opacity-50"
                        >
                          {RELATION_TYPES.map((rt) => (
                            <option key={rt} value={rt} className="bg-slate-900">
                              {t(`mindBoard.relation_${rt}`)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeRelation(selectedChar.id, rel.targetCharacterId)}
                          disabled={isReader}
                          className="p-0.5 text-slate-500 hover:text-rose-300 transition-colors disabled:opacity-40"
                          title={t('mindBoard.removeRelationTitle')}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {onNavigateToTab && (
                <button
                  onClick={() => onNavigateToTab('characters')}
                  className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-bold text-slate-300 transition-colors"
                >
                  {t('mindBoard.openCharactersTab')}
                </button>
              )}
            </div>
          </aside>
        )}
      </div>

      {book.characters.length === 0 && (
        <div className="shrink-0 p-3 border-t border-slate-800 text-center">
          <p className="text-[11px] text-slate-500">{t('mindBoard.noCharacters')}</p>
          {onNavigateToTab && (
            <button
              onClick={() => onNavigateToTab('characters')}
              className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold hover:bg-amber-500/30 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('mindBoard.goAddCharacters')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
