import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, Search, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  CORE_ENTITIES,
  CORE_ENTITY_GROUPS,
  entityTooltip,
  searchEntities,
  textColorOnDark,
  type CoreEntity,
} from '../utils/coreEntities';

export interface ChatEntityPanelProps {
  /** Вставити тег у поле чату (у позицію курсора). */
  onPick: (entity: CoreEntity) => void;
  /** Режим «показати теги ядра»: чипи в репліках + вимога тегувати відповідь. */
  showTags: boolean;
  onToggleTags: () => void;
  /** Зведення згадок розмови з бази (`chat_message_entities`). */
  groups: { slug: string; count: number; color?: string }[];
}

/**
 * Права панель сутностей у чаті зі ШІ — постановка власника 23.09.2026, п. 5.
 *
 * ЧОМУ ПАНЕЛЬ, А НЕ КНОПКА-ПІКЕР, ЯК БУЛО. Попередня версія мала маленьку
 * кнопку над полем вводу, з якої відкривався список у поповері. Власник цього
 * не побачив (кнопка без підпису губилась серед скріпки та моделі) і написав,
 * що сутності в чаті «не з'явились і введення неможливе». Панель вирішує це
 * структурно: вона видима постійно, у неї є заголовок, пошук і — головне —
 * той самий вигляд, що й у канві книги, тож автор не вчиться двічі.
 *
 * ЧОМУ ТУТ НЕМАЄ ПРАВИЛА «ДОДАТИ В ПОТОЧНИЙ АБЗАЦ». У чаті абзацу, у якому
 * стоїть курсор, не існує: є поле вводу з рядком тексту. Тому клік по
 * сутності вставляє тег у позицію курсора — це той самий зміст дії, лише
 * прив'язаний до того, що в цьому середовищі справді існує.
 */
export const ChatEntityPanel: React.FC<ChatEntityPanelProps> = ({ onPick, showTags, onToggleTags, groups }) => {
  const { t, lang } = useLanguage();
  const [query, setQuery] = useState('');
  const [openGroup, setOpenGroup] = useState<string>('C');

  const useEnglish = lang === 'en';
  const name = (entity: CoreEntity) => (useEnglish ? entity.nameEn : entity.nameUk);
  const found = useMemo(() => (query.trim() ? searchEntities(query, 30) : []), [query]);
  const usedSlugs = useMemo(() => new Set(groups.map((g) => g.slug)), [groups]);

  const row = (entity: CoreEntity) => (
    <button
      key={entity.slug}
      onClick={() => onPick(entity)}
      title={entityTooltip(entity, useEnglish ? 'en' : 'uk')}
      className="w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 hover:bg-[var(--surface-dim)] transition-colors"
      data-chat-panel-item={entity.slug}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entity.color }} />
      <span className="flex-1 min-w-0">
        <span className="block text-[11px] font-semibold text-[var(--on-surface)] truncate">
          {name(entity)}
        </span>
        <span className="block text-[9.5px] font-mono truncate" style={{ color: textColorOnDark(entity.color) }}>
          {entity.tag}
        </span>
      </span>
      {usedSlugs.has(entity.slug) && (
        <span className="text-[9px] font-bold px-1 rounded shrink-0" style={{ color: textColorOnDark(entity.color) }}>
          ●
        </span>
      )}
    </button>
  );

  return (
    <aside
      className="w-[250px] shrink-0 flex flex-col min-h-0 border-l border-[var(--border-subtle)] nm-flat"
      data-chat-entity-panel
    >
      <div className="p-3 space-y-2 shrink-0 border-b border-[var(--border-subtle)]">
        <h4 className="text-[12px] font-bold text-[var(--on-surface)] flex items-center gap-1.5">
          <span className="[color:var(--primary)]">◈</span>
          {t('coreEntities.chatPanelTitle')}
        </h4>

        {/* Режим тегів. Він робить ДВІ речі одразу, і це навмисно: показує
            чипи в репліках і додає моделі інструкцію тегувати відповідь.
            Інакше автор увімкнув би показ і не розумів, чому відповіді без
            тегів — а це різні прапорці й різні очікування. */}
        <button
          onClick={onToggleTags}
          data-chat-entity-toggle={showTags ? 'shown' : 'hidden'}
          title={t('coreEntities.chatPanelToggleHint')}
          className="w-full py-1.5 px-2 rounded-lg text-[10.5px] font-bold text-slate-900 flex items-center justify-center gap-1.5 transition-transform hover:scale-[1.02]"
          style={{ backgroundImage: 'linear-gradient(90deg,#f97316 0%,#facc15 45%,#22c55e 100%)' }}
        >
          {showTags ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          <span>{showTags ? t('coreEntities.chatPanelToggleOn') : t('coreEntities.chatPanelToggleOff')}</span>
        </button>
        <p className="text-[9.5px] leading-snug text-[var(--outline)]">
          {showTags ? t('coreEntities.chatPanelHintOn') : t('coreEntities.chatPanelHintOff')}
        </p>

        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--outline)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('coreEntities.searchPlaceholder')}
            className="w-full pl-7 pr-6 py-1.5 text-[11px] rounded-lg nm-inset text-[var(--on-surface)] placeholder:text-[var(--outline)] bg-transparent outline-none"
            data-chat-entity-search
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--outline)]"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {query.trim() ? (
          <div className="space-y-0.5">
            {found.length === 0 && (
              <p className="text-[10.5px] text-[var(--outline)] px-1">
                {t('coreEntities.noResults', { q: query })}
              </p>
            )}
            {found.map(row)}
          </div>
        ) : (
          CORE_ENTITY_GROUPS.map((group) => {
            const open = openGroup === group.id;
            const entities = CORE_ENTITIES.filter((e) => e.groupId === group.id);
            return (
              <div key={group.id}>
                <button
                  onClick={() => setOpenGroup(open ? '' : group.id)}
                  className="w-full px-1.5 py-1 rounded-lg flex items-center gap-1.5 hover:bg-[var(--surface-dim)] text-left"
                  data-chat-panel-group={group.id}
                >
                  <span className="text-[9.5px] font-bold text-[var(--outline)] w-4">{group.id}</span>
                  <span className="text-[10.5px] text-[var(--on-surface-variant)] flex-1 truncate">
                    {useEnglish ? group.nameEn : group.nameUk}
                  </span>
                  <span className="text-[9.5px] text-[var(--outline)]">{entities.length}</span>
                </button>
                {open && <div className="pl-1 space-y-0.5">{entities.map(row)}</div>}
              </div>
            );
          })
        )}
      </div>

      <p className="p-2 text-[9.5px] text-[var(--outline)] border-t border-[var(--border-subtle)] shrink-0">
        {t('coreEntities.chatPanelPickHint')}
      </p>
    </aside>
  );
};

export default ChatEntityPanel;
