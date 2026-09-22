import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  CORE_ENTITIES,
  CORE_ENTITY_GROUPS,
  readableTextOn,
  searchEntities,
  type CoreEntity,
} from '../utils/coreEntities';

export interface EntityChatPickerProps {
  /** Вставити тег сутності у поле чату (у позицію курсора). */
  onPick: (entity: CoreEntity) => void;
  onClose: () => void;
}

/**
 * Підбір сутності для чату зі ШІ (постановка власника, п. 7: «такі самі
 * правила присвоєння сутностей … застосовуємо й до розділу «AI-асистент»»).
 *
 * ЧОМУ ОКРЕМИЙ КОМПОНЕНТ, А НЕ ПАНЕЛЬ З КАНВИ. У канві панель стоїть поруч із
 * текстом і працює з ProseMirror; тут поле вводу — звичайний `<input>`, у
 * якого немає ні документів, ні декорацій, а є лише позиція курсора. Спроба
 * зробити один компонент на обидва випадки закінчилась би гілками «якщо
 * канва — то так, якщо чат — то інакше» в кожному рядку.
 *
 * Групування за категоріями — те саме, що й на панелі сутностей: 12 груп
 * реєстру. Автор бачить однакову картину в обох місцях, і це не збіг, а
 * вимога: сутність, знайдена в чаті, має знаходитись і в книзі тим самим
 * шляхом.
 */
export const EntityChatPicker: React.FC<EntityChatPickerProps> = ({ onPick, onClose }) => {
  const { t, lang } = useLanguage();
  const [query, setQuery] = useState('');
  const [openGroup, setOpenGroup] = useState<string>('C');

  const useEnglish = lang === 'en';
  const name = (entity: CoreEntity) => (useEnglish ? entity.nameEn : entity.nameUk);
  const found = useMemo(() => (query.trim() ? searchEntities(query, 24) : []), [query]);

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-2 max-h-[320px] overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] shadow-2xl p-2 z-50"
      data-entity-chat-picker
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-[var(--on-surface)]">
          {t('coreEntities.chatPickerTitle', { n: CORE_ENTITIES.length })}
        </span>
        <button onClick={onClose} className="p-1 text-[var(--outline)] hover:text-[var(--on-surface)]">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="relative mb-2">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--outline)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('coreEntities.searchPlaceholder')}
          className="w-full pl-7 pr-2 py-1.5 text-[11px] rounded-lg bg-[var(--surface-dim)] border border-[var(--border-subtle)] text-[var(--on-surface)]"
          data-entity-chat-search
        />
      </div>

      {query.trim() ? (
        <div className="space-y-1">
          {found.length === 0 && (
            <p className="text-[11px] text-[var(--outline)] px-1">{t('coreEntities.noResults', { q: query })}</p>
          )}
          {found.map((entity) => (
            <button
              key={entity.slug}
              onClick={() => onPick(entity)}
              className="w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 hover:bg-[var(--surface-dim)]"
              data-entity-chat-item={entity.slug}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entity.color }} />
              <span className="flex-1 min-w-0">
                <span className="block text-[11px] font-semibold text-[var(--on-surface)] truncate">
                  {name(entity)}
                </span>
                <span className="block text-[10px] text-[var(--outline)] truncate">{entity.tag}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {CORE_ENTITY_GROUPS.map((group) => {
            const open = openGroup === group.id;
            const entities = CORE_ENTITIES.filter((e) => e.groupId === group.id);
            return (
              <div key={group.id}>
                <button
                  onClick={() => setOpenGroup(open ? '' : group.id)}
                  className="w-full px-2 py-1 rounded-lg flex items-center gap-2 hover:bg-[var(--surface-dim)] text-left"
                  data-entity-chat-group={group.id}
                >
                  <span className="text-[10px] font-bold text-[var(--outline)] w-5">{group.id}</span>
                  <span className="text-[11px] text-[var(--on-surface)] flex-1 truncate">
                    {useEnglish ? group.nameEn : group.nameUk}
                  </span>
                  <span className="text-[10px] text-[var(--outline)]">{entities.length}</span>
                </button>
                {open && (
                  <div className="pl-2 pt-1 space-y-1">
                    {entities.map((entity) => (
                      <button
                        key={entity.slug}
                        onClick={() => onPick(entity)}
                        className="w-full text-left px-2 py-1 rounded-lg flex items-center gap-2 hover:bg-[var(--surface-dim)]"
                        style={{ backgroundColor: `${entity.color}1a` }}
                        data-entity-chat-item={entity.slug}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entity.color }} />
                        <span className="text-[11px] text-[var(--on-surface)] truncate flex-1">{name(entity)}</span>
                        <span
                          className="text-[9px] px-1 rounded shrink-0"
                          style={{ backgroundColor: entity.color, color: readableTextOn(entity.color) }}
                        >
                          {entity.tag}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2 px-1 text-[10px] text-[var(--outline)]">{t('coreEntities.chatPickerHint')}</p>
    </div>
  );
};

export default EntityChatPicker;
