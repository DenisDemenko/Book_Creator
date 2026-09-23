import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, MousePointerClick, Search, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  CORE_ENTITIES,
  CORE_ENTITY_GROUPS,
  CORE_ENTITY_RELATIONS,
  MAX_ENTITIES_PER_PARAGRAPH,
  duplicateColors,
  entityTooltip,
  parseAnyEntityTags,
  readableTextOn,
  searchEntities,
  type CoreEntity,
} from '../utils/coreEntities';

export interface CoreEntityPanelProps {
  /** Текст активного розділу — з нього рахується «що вже заявлено». */
  sectionContent: string;
  /** Текст абзацу під курсором — для лічильника «N із 12». */
  paragraphText: string;
  /** Чи показувати сутності в канві (кнопка приховування, п. 5). */
  visible: boolean;
  onToggleVisible: () => void;
  /**
   * Додати сутність до ПОТОЧНОГО абзацу (п. 4: «за натисканням певної
   * сутності додати її на поточний абзац книги»).
   */
  onAddToParagraph: (entity: CoreEntity) => void;
  /**
   * Вставити тег у позицію курсора — другий спосіб, для випадку «пишу
   * речення і хочу позначити саме це місце», коли мітка на початку абзацу не
   * те, що потрібно.
   */
  onInsertAtCursor: (entity: CoreEntity) => void;
  /** Курсор не в розділі (редактор не готовий) — кнопки додавання неактивні. */
  disabled?: boolean;
}

/**
 * Панель сутностей ядра — права колонка в розділі «Книга та текст»
 * (постановка власника, пп. 2–5).
 *
 * ЩО РОБИТЬ ПАНЕЛЬ І ЩО РОБИТЬ КАНВА. Панель — це ВИБІР: пошук, групи,
 * натискання. Усе, що стосується показу вже поставлених міток (чипи, тло
 * абзаців, приховування), робить `EntityTagPlugin` у самому редакторі. Такий
 * поділ не косметичний: без нього довелося б тримати копію тексту розділу в
 * стані панелі, і вона б розходилася з реальним документом на першій же
 * правці, зробленій не через панель.
 *
 * ЧОМУ РЕЄСТР БЕРЕТЬСЯ З КОДУ, А НЕ ІЗ СЕРВЕРА. Перелік типів — це дані
 * документа власника, незмінні під час роботи; сервер віддає те саме
 * (`/api/core/entities`), але ставити панель у залежність від мережі
 * означало б, що в офлайні автор не бачить реєстру, хоч той уже завантажений
 * у бандл. Із сервера приходять ЗГАДКИ в чаті — вони справді серверні.
 */
export const CoreEntityPanel: React.FC<CoreEntityPanelProps> = ({
  sectionContent,
  paragraphText,
  visible,
  onToggleVisible,
  onAddToParagraph,
  onInsertAtCursor,
  disabled,
}) => {
  const { t, lang } = useLanguage();
  const [query, setQuery] = useState('');
  /** Які групи розгорнуті. Порожній набір = усі згорнуті, крім першої. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ A: true });

  const useEnglishNames = lang === 'en';
  const entityName = (entity: CoreEntity) => (useEnglishNames ? entity.nameEn : entity.nameUk);

  const found = useMemo(() => (query.trim() ? searchEntities(query, 40) : []), [query]);

  /** Скільки разів кожна сутність заявлена в активному розділі. */
  const sectionUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tag of parseAnyEntityTags(sectionContent || '')) {
      counts.set(tag.slug, (counts.get(tag.slug) || 0) + 1);
    }
    return counts;
  }, [sectionContent]);

  /** Сутності поточного абзацу — вони ж обмежуються лімітом 12. */
  const paragraphSlugs = useMemo(
    () => parseAnyEntityTags(paragraphText || '').map((tag) => tag.slug),
    [paragraphText]
  );
  const paragraphFull = paragraphSlugs.length >= MAX_ENTITIES_PER_PARAGRAPH;

  const duplicates = useMemo(() => duplicateColors().length, []);

  const add = (entity: CoreEntity) => {
    if (disabled || paragraphFull) return;
    if (paragraphSlugs.includes(entity.slug)) {
      // Другий раз та сама сутність в абзаці — не помилка, але й не користь:
      // фон однаково береться з ПЕРШОЇ, а лічильник 12 з'їв би місце марно.
      // Тому просто не додаємо, без тосту: автор і так бачить чип в абзаці.
      return;
    }
    onAddToParagraph(entity);
  };

  const entityRow = (entity: CoreEntity) => (
    <div
      key={entity.slug}
      className="flex items-stretch gap-1 rounded-lg border border-slate-800 hover:border-slate-600 transition-all overflow-hidden"
      style={{ backgroundColor: `${entity.color}22` }}
      data-entity-row={entity.slug}
    >
      <button
        onClick={() => add(entity)}
        disabled={disabled || paragraphFull}
        title={`${entityTooltip(entity, useEnglishNames ? 'en' : 'uk')}\n${t('coreEntities.addToParagraph')} — ${entity.tag}`}
        className="flex-1 min-w-0 text-left px-2 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        data-entity-button={entity.slug}
      >
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entity.color }} />
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] font-semibold text-slate-100 truncate">
            {entityName(entity)}
          </span>
          <span className="block text-[10px] text-slate-400 truncate">
            {entity.tag}
            {entity.characteristics.length > 0 ? ` · ${entity.characteristics.slice(0, 2).join(', ')}` : ''}
          </span>
        </span>
      </button>
      {sectionUsage.has(entity.slug) && (
        <span
          className="self-center text-[10px] font-bold px-1.5 py-0.5 rounded"
          style={{ backgroundColor: entity.color, color: readableTextOn(entity.color) }}
          title={t('coreEntities.sectionUsage')}
        >
          {sectionUsage.get(entity.slug)}
        </span>
      )}
      <button
        onClick={() => onInsertAtCursor(entity)}
        disabled={disabled}
        title={t('coreEntities.insertAtCursor')}
        className="px-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 disabled:opacity-40 disabled:cursor-not-allowed border-l border-slate-800"
        data-entity-insert-cursor={entity.slug}
      >
        <MousePointerClick className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <div className="space-y-3" data-core-entity-panel>
      <div>
        <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
          <span className="[color:var(--sun-acc)]">◈</span>
          {t('coreEntities.heading')}
        </h3>
        <p className="text-[10px] text-slate-500 mt-0.5">
          {t('coreEntities.totalLabel', { n: CORE_ENTITIES.length })} ·{' '}
          {t('coreEntities.groupsLabel', {
            n: CORE_ENTITY_GROUPS.length,
            relations: CORE_ENTITY_RELATIONS.length,
          })}
        </p>
      </div>

      <p className="text-[10px] text-slate-400 leading-relaxed">{t('coreEntities.subheading')}</p>

      {/* Кнопка приховування (п. 5): яскрава оранжево-зелена, як просив власник.
          Сама вона нічого не фарбує — лише перемикає видимість, яку читає
          EntityTagPlugin; тому вона не може «розійтися» з тим, що в канві. */}
      <button
        onClick={onToggleVisible}
        data-entity-toggle={visible ? 'shown' : 'hidden'}
        className="w-full py-2 px-3 rounded-xl text-[11px] font-bold text-slate-900 shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.99] flex items-center justify-center gap-2"
        style={{ backgroundImage: 'linear-gradient(90deg,#f97316 0%,#facc15 45%,#22c55e 100%)' }}
        title={visible ? t('coreEntities.hideBtn') : t('coreEntities.showBtn')}
      >
        {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        <span>{visible ? t('coreEntities.hideBtn') : t('coreEntities.showBtn')}</span>
      </button>
      <p className="text-[10px] text-slate-500" data-entity-visibility-hint>
        {visible ? t('coreEntities.visibleHint') : t('coreEntities.hiddenHint')}
      </p>

      {/* Лічильники: абзац (ліміт 12) і розділ */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className={paragraphFull ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
            {paragraphFull
              ? t('coreEntities.paragraphFull', { max: MAX_ENTITIES_PER_PARAGRAPH })
              : t('coreEntities.paragraphCounter', {
                  n: paragraphSlugs.length,
                  max: MAX_ENTITIES_PER_PARAGRAPH,
                })}
          </span>
          <span className="text-slate-500" data-entity-paragraph-count={paragraphSlugs.length}>
            {paragraphSlugs.length}/{MAX_ENTITIES_PER_PARAGRAPH}
          </span>
        </div>
        <div className="w-full h-1 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, (paragraphSlugs.length / MAX_ENTITIES_PER_PARAGRAPH) * 100)}%`,
              backgroundImage: 'linear-gradient(90deg,#f97316,#22c55e)',
            }}
          />
        </div>
        <div className="pt-1">
          <span className="text-[10px] text-slate-500">
            {sectionUsage.size > 0 ? t('coreEntities.sectionUsage') : t('coreEntities.nothingInSection')}
          </span>
          {sectionUsage.size > 0 && (
            <div className="flex flex-wrap gap-1 mt-1" data-entity-section-usage>
              {[...sectionUsage.entries()].map(([slug, count]) => {
                const entity = CORE_ENTITIES.find((e) => e.slug === slug);
                return (
                  <span
                    key={slug}
                    className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                    style={{
                      backgroundColor: entity?.color || '#475569',
                      color: readableTextOn(entity?.color || '#475569'),
                    }}
                    title={entity ? entityName(entity) : slug}
                  >
                    {entity ? entityName(entity) : slug}
                    {count > 1 ? ` ×${count}` : ''}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <p className="text-[10px] text-slate-500 italic">{t('coreEntities.slashHint')}</p>

      {/* Пошук: підбір за початком ключа — те саме правило, що й у слеш-команді */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('coreEntities.searchPlaceholder')}
          className="w-full pl-8 pr-8 py-2 text-[11px] rounded-lg bg-slate-900 border border-slate-800 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
          data-entity-search
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            title={t('coreEntities.clearSearch')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {disabled && <p className="text-[10px] text-amber-400/90">{t('coreEntities.needEditor')}</p>}

      {/* Результати пошуку — плоским списком: у пошуку автор шукає конкретну
          сутність, і групи тут лише заважали б гортати. */}
      {query.trim() ? (
        <div className="space-y-1" data-entity-search-results>
          {found.length === 0 && (
            <p className="text-[10px] text-slate-500">{t('coreEntities.noResults', { q: query })}</p>
          )}
          {found.map(entityRow)}
        </div>
      ) : (
        <div className="space-y-2" data-entity-groups>
          {CORE_ENTITY_GROUPS.map((group) => {
            const open = !!openGroups[group.id];
            const entities = CORE_ENTITIES.filter((e) => e.groupId === group.id);
            return (
              <div key={group.id} className="rounded-xl border border-slate-800 overflow-hidden">
                <button
                  onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !open }))}
                  className="w-full px-2 py-1.5 bg-slate-900/80 hover:bg-slate-900 flex items-center gap-2 text-left"
                  data-entity-group={group.id}
                >
                  <span className="text-[10px] font-bold text-slate-500 w-6">{group.id}</span>
                  <span className="text-[11px] font-semibold text-slate-300 flex-1">
                    {useEnglishNames ? group.nameEn : group.nameUk}
                  </span>
                  <span className="text-[10px] text-slate-500">{entities.length}</span>
                </button>
                {open && <div className="p-1.5 space-y-1">{entities.map(entityRow)}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Довідка про формат — не прикраса: без неї автор не здогадається, що
          літери після двокрапки — це характеристика з реєстру. */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-2 space-y-1">
        <p className="text-[10px] text-slate-400 font-semibold">
          {t('coreEntities.characteristicsLabel')}
        </p>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          {CORE_ENTITIES.slice(0, 3).map((e) => `${e.tag}:${e.characteristics[0] || ''}`).join('  ·  ')}
        </p>
        <p className="text-[10px] text-slate-500">
          {t('coreEntities.duplicatesNote', { n: duplicates })}
        </p>
      </div>
    </div>
  );
};

export default CoreEntityPanel;
