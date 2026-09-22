import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useLanguage } from '../i18n/LanguageContext';
import {
  CORE_ENTITIES,
  buildEntityTag,
  entityBySlug,
  readableTextOn,
  searchCharacteristics,
  searchEntities,
  type CoreEntity,
} from '../utils/coreEntities';

export interface EntitySlashMenuProps {
  /** Редактор книги (UA або EN — той, у якому зараз курсор). */
  editor: Editor | null;
}

/**
 * Підбір сутності під час набору — постановка власника, пункт 3:
 * «при введенні користувачем запису формату `/сутність:назва характеристики` —
 * за першими однією, двома, трьома і так далі літерами підбирається список із
 * 118 сутностей, а кнопкою «таб» заповнюється вибрана сутність в текст».
 *
 * ДВИГУНИ, А НЕ ЛИШЕ ОДНА ПАНЕЛЬ. Елементи керування тут навмисно ті самі,
 * що звик автор: список їде стрілками, Таб підставляє вибране, Esc закриває.
 * Миша теж працює (клік по рядку), але жодна дія НЕ ВИМАГАЄ миші — інакше
 * підбір був би повільнішим за ручний набір і ним перестали б користуватись.
 *
 * ДВА КРОКИ, І ЦЕ ВИМОГА, А НЕ ОФОРМЛЕННЯ. Формат тега — «сутність :
 * характеристика». Спочатку підбирається СУТНІСТЬ (їх 118, автор диктує
 * ключ), потім — ХАРАКТЕРИСТИКА вибраної сутності (їх у кожної 3–5, і вони
 * різні для кожної). Один спільний список змішав би 118 ключів із ~500
 * характеристик, і після трьох літер автор бачив би десятки чужих слів.
 *
 * ЩО САМЕ ЛЯГАЄ В ТЕКСТ. На першому кроці — `/character:`, щоб автор одразу
 * бачив, що сутність узята й можна писати значення. На другому — канонічний
 * маркер `[/character:Serhii]`, тобто те, з чим працює і канва, і зняття
 * тегів на експорті. Проміжний стан (без дужок) у книгу не потрапляє ніколи:
 * його нормалізує `wrapPlainEntityTags` на шляху до збереження, а другий крок
 * закриває його сам.
 */
export const EntitySlashMenu: React.FC<EntitySlashMenuProps> = ({ editor }) => {
  const { t, lang } = useLanguage();
  const useEnglish = lang === 'en';

  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'entity' | 'value'>('entity');
  const [slug, setSlug] = useState('');
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  /** Діапазон у документі, який замінить підстановка. */
  const rangeRef = useRef<{ from: number; to: number }>({ from: 0, to: 0 });

  const entity = slug ? entityBySlug(slug) : undefined;

  const items = useMemo(() => {
    if (stage === 'entity') return searchEntities(query, 8);
    if (entity) {
      const characteristics = searchCharacteristics(entity, query, 8);
      // Характеристик у сутності може бути менше за вісім — тоді підказуємо
      // решту списку: автор бачить, що взагалі буває в цієї сутності.
      return characteristics.length > 0 ? characteristics : entity.characteristics.slice(0, 8);
    }
    return [] as string[];
  }, [stage, query, entity]);

  /**
   * Що стоїть перед курсором. Повертає `null`, якщо тригера немає — тоді
   * меню закривається. Саме тут вирішується, який крок зараз: наявність
   * двокрапки після ключа означає, що сутність уже вибрана.
   *
   * МЕЖА ТРИГЕРА — «перед слешем не літера й не цифра», а не «перед слешем
   * пробіл». Перша версія вимагала пробіл, і `/char`, набраний усередині
   * речення (після коми, крапки, лапки), підбору не відкривав — це показав
   * живий прогін. Розширювати межу безпечно саме тому, що кандидати далі
   * звіряються з реєстром 118 сутностей: `стор./2:3` не стає тегом не через
   * межу, а тому що `/2` немає в реєстрі.
   */
  const readTrigger = useCallback((ed: Editor) => {
    const { state } = ed;
    const { $from, from } = state.selection;
    if (!$from.parent.isTextblock) return null;
    const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');

    const valueMatch = before.match(/(?:^|[^\p{L}\p{N}_])(\/[a-z0-9-]+):([^\s:]*)$/u);
    if (valueMatch && entityBySlug(valueMatch[1].slice(1))) {
      // Довжина замінюваного фрагмента = слеш + ключ + двокрапка + значення.
      // Саме довжина, а не `match[0].trim().length`: у `match[0]` входить ще
      // й символ перед слешем (кома, лапка), і trim() його не зріже.
      const typedLength = valueMatch[1].length + 1 + valueMatch[2].length;
      return {
        stage: 'value' as const,
        slug: valueMatch[1].slice(1),
        query: valueMatch[2],
        range: { from: from - typedLength, to: from },
      };
    }

    const entityMatch = before.match(/(?:^|[^\p{L}\p{N}_])(\/[a-z0-9-]*)$/u);
    if (entityMatch) {
      return {
        stage: 'entity' as const,
        slug: '',
        query: entityMatch[1].slice(1),
        range: { from: from - entityMatch[1].length, to: from },
      };
    }
    return null;
  }, []);

  const refresh = useCallback(() => {
    if (!editor) {
      setOpen(false);
      return;
    }
    const trigger = readTrigger(editor);
    if (!trigger) {
      setOpen(false);
      return;
    }
    rangeRef.current = trigger.range;
    setStage(trigger.stage);
    setSlug(trigger.slug);
    setQuery(trigger.query);
    setActiveIndex(0);
    setOpen(true);

    try {
      const coords = editor.view.coordsAtPos(trigger.range.from);
      setPosition({ top: coords.bottom + 6, left: coords.left });
    } catch {
      // Позиція може не порахуватись, якщо редактор саме перемонтовується —
      // меню тоді показується на попередньому місці, а не зникає.
    }
  }, [editor, readTrigger]);

  /**
   * Підстановка. Обидва кроки робляться однією транзакцією `insertContentAt`:
   * текст, який автор набрав (`/char`, `/character:Se`), замінюється цілком —
   * інакше після Таба в тексті лишався б «хвіст» набраного.
   */
  const accept = useCallback(
    (index: number) => {
      if (!editor || !open) return;
      const item = items[index];
      if (item === undefined) return;
      const { from, to } = rangeRef.current;

      if (stage === 'entity') {
        const picked = item as CoreEntity;
        editor.chain().focus().insertContentAt({ from, to }, `${picked.tag}:`).run();
        // Одразу другий крок: автор бачить характеристики саме цієї сутності.
        const cursor = editor.state.selection.from;
        setStage('value');
        setSlug(picked.slug);
        setQuery('');
        setActiveIndex(0);
        rangeRef.current = { from, to: cursor };
        setOpen(true);
        return;
      }

      const value = String(item);
      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, `${buildEntityTag(slug, value)} `)
        .run();
      setOpen(false);
    },
    [editor, open, items, stage, slug]
  );

  /** Закриває тег без характеристики — автор тисне Enter, значення не потрібне. */
  const acceptWithoutValue = useCallback(() => {
    if (!editor || !open || stage !== 'value') return;
    const { from, to } = rangeRef.current;
    editor.chain().focus().insertContentAt({ from, to }, `${buildEntityTag(slug, '')} `).run();
    setOpen(false);
  }, [editor, open, stage, slug]);

  // Стежимо за курсором і текстом: тригер живе в самому документі, тому
  // достатньо слухати транзакції редактора.
  useEffect(() => {
    if (!editor) return;
    const handler = () => refresh();
    editor.on('update', handler);
    editor.on('selectionUpdate', handler);
    refresh();
    return () => {
      editor.off('update', handler);
      editor.off('selectionUpdate', handler);
    };
  }, [editor, refresh]);

  /**
   * Клавіші перехоплюються в capture-фазі на DOM редактора: інакше Таб пішов
   * би у звичайну навігацію фокуса, а Enter — у новий абзац, і підстановка
   * спрацьовувала б «через раз», залежно від того, хто перший побачив подію.
   */
  useEffect(() => {
    if (!editor || !open) return;
    const dom = editor.view.dom;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowDown') {
        setActiveIndex((prev) => (items.length ? (prev + 1) % items.length : 0));
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowUp') {
        setActiveIndex((prev) => (items.length ? (prev - 1 + items.length) % items.length : 0));
        event.preventDefault();
        return;
      }
      if (event.key === 'Tab') {
        accept(activeIndex);
        event.preventDefault();
        return;
      }
      if (event.key === 'Enter') {
        // Enter на першому кроці бере сутність, на другому — закриває тег без
        // значення: інакше автор, який не хоче характеристики, не мав би як
        // завершити тег, не вибравши випадкове слово зі списку.
        if (stage === 'value') acceptWithoutValue();
        else accept(activeIndex);
        event.preventDefault();
      }
    };

    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, open, items.length, activeIndex, stage, accept, acceptWithoutValue]);

  if (!open || !editor) return null;

  return (
    <div
      className="fixed z-[120] w-[300px] max-h-[280px] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/98 backdrop-blur-xl shadow-2xl p-1.5"
      style={{ top: position.top, left: position.left }}
      data-entity-slash-menu={stage}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="px-2 py-1 text-[10px] text-slate-500 border-b border-slate-800 mb-1">
        {stage === 'entity' ? t('coreEntities.slashEntityHint') : t('coreEntities.slashValueHint')}
      </div>

      {items.length === 0 && (
        <div className="px-2 py-2 text-[11px] text-slate-500">
          {t('coreEntities.noResults', { q: query })}
        </div>
      )}

      {stage === 'entity'
        ? (items as CoreEntity[]).map((item, index) => (
            <button
              key={item.slug}
              onMouseDown={(e) => {
                e.preventDefault();
                accept(index);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 ${
                index === activeIndex ? 'bg-slate-800' : 'hover:bg-slate-900'
              }`}
              data-entity-slash-item={item.slug}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <span className="flex-1 min-w-0">
                <span className="block text-[11px] font-semibold text-slate-100 truncate">
                  {useEnglish ? item.nameEn : item.nameUk}
                </span>
                <span className="block text-[10px] text-slate-400 truncate">{item.tag}</span>
              </span>
              <span className="text-[9px] text-slate-500">Tab</span>
            </button>
          ))
        : (items as string[]).map((item, index) => (
            <button
              key={item}
              onMouseDown={(e) => {
                e.preventDefault();
                accept(index);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 ${
                index === activeIndex ? 'bg-slate-800' : 'hover:bg-slate-900'
              }`}
              data-entity-slash-value={item}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: entity?.color || '#475569' }}
              />
              <span className="flex-1 text-[11px] text-slate-200 truncate">{item}</span>
              <span
                className="text-[9px] px-1 rounded"
                style={{
                  backgroundColor: entity?.color || '#475569',
                  color: readableTextOn(entity?.color || '#475569'),
                }}
              >
                /{slug}
              </span>
            </button>
          ))}

      <div className="px-2 py-1 mt-1 border-t border-slate-800 text-[9px] text-slate-600">
        {CORE_ENTITIES.length} · ↑↓ · Tab · Esc
      </div>
    </div>
  );
};

export default EntitySlashMenu;
