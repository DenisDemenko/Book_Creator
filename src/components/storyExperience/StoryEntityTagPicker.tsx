import React, { useEffect, useState } from 'react';
import {
  activeEntities, entityBySlug, MAX_ENTITIES_PER_PARAGRAPH,
  registryRevision, subscribeRegistry,
} from '../../utils/coreEntities';
import type { StoryHandoffTag } from '../../utils/storyEntityHandoff';

export interface StoryEntityTagPickerProps {
  value: StoryHandoffTag[];
  onChange: (tags: StoryHandoffTag[]) => void;
  suggestions?: StoryHandoffTag[];
  disabled?: boolean;
}

/** Same ontology and tag syntax as «Книга & Текст»; no parallel dictionary. */
export const StoryEntityTagPicker: React.FC<StoryEntityTagPickerProps> = ({
  value, onChange, suggestions = [], disabled = false,
}) => {
  const [revision, setRevision] = useState(registryRevision);
  const [filter, setFilter] = useState('');
  const [selectedSlug, setSelectedSlug] = useState('character');
  const [tagValue, setTagValue] = useState('');
  const [error, setError] = useState('');
  useEffect(() => subscribeRegistry(() => setRevision(registryRevision())), []);
  const choices = activeEntities().filter(entity => !entity.deprecated
    && (entity.slug + ' ' + entity.nameUk + ' ' + entity.nameEn).toLocaleLowerCase('uk-UA')
      .includes(filter.trim().toLocaleLowerCase('uk-UA')));
  void revision;
  const add = (tag: StoryHandoffTag) => {
    const entity = entityBySlug(tag.slug);
    if (!entity || entity.deprecated) {
      setError('Обраний тип відсутній в активній онтології.');
      return;
    }
    const clean = tag.value.replace(/[\r\n\[\]]/g, ' ').trim();
    if (!clean || clean.length > 250) {
      setError('Укажіть значення сутності (не більш ніж 250 символів).');
      return;
    }
    if (value.some(item => item.slug === entity.slug && item.value.toLocaleLowerCase('uk-UA') === clean.toLocaleLowerCase('uk-UA'))) {
      setError('Цей тег уже додано.');
      return;
    }
    if (value.length >= MAX_ENTITIES_PER_PARAGRAPH) {
      setError('На один абзац можна призначити не більш ніж 12 тегів.');
      return;
    }
    onChange([...value, { slug: entity.slug, value: clean }]);
    setTagValue('');
    setError('');
  };
  return <section aria-label="Семантичні сутності книги" className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div><h3 className="font-semibold">Сутності та теги</h3><p className="text-xs text-[#71645A]">Підтверджуйте тільки теги, що справді описують цей текст.</p></div>
      <span className="shrink-0 text-xs text-[#71645A]">{value.length}/{MAX_ENTITIES_PER_PARAGRAPH}</span>
    </div>
    {suggestions.length > 0 && <div className="rounded-xl border border-[#DFCDBA] bg-[#FFF8EF] p-3">
      <p className="mb-2 text-xs font-semibold">Пропозиції за контекстом сцени (не додаються автоматично)</p>
      <div className="flex flex-wrap gap-2">
        {suggestions.filter(tag => !value.some(selected => selected.slug === tag.slug && selected.value === tag.value))
          .map((tag, index) => <button key={tag.slug + ':' + index} type="button" disabled={disabled}
            onClick={() => add(tag)} className="max-w-full rounded-lg border border-[#CDB69B] px-2 py-1 text-left text-xs hover:bg-[#F4E5D4] disabled:opacity-50">
            + {entityBySlug(tag.slug)?.nameUk || tag.slug}: {tag.value}
          </button>)}
      </div>
    </div>}
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
      <label className="text-xs font-semibold">Пошук серед {activeEntities().length} типів
        <input type="search" disabled={disabled} value={filter} onChange={event => setFilter(event.target.value)}
          placeholder="Сюжет, персонаж, емоція…" className="mt-1 w-full rounded-lg border border-[#CDBBAA] bg-white px-3 py-2 text-sm" />
      </label>
      <label className="text-xs font-semibold">Тип сутності
        <select value={choices.some(item => item.slug === selectedSlug) ? selectedSlug : (choices[0]?.slug || '')}
          disabled={disabled || choices.length === 0}
          onChange={event => setSelectedSlug(event.target.value)}
          className="mt-1 w-full rounded-lg border border-[#CDBBAA] bg-white px-3 py-2 text-sm">
          {choices.map(item => <option key={item.slug} value={item.slug}>{item.nameUk} (/{item.slug})</option>)}
        </select>
      </label>
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-40 flex-1 text-xs font-semibold">Значення тега
        <input value={tagValue} disabled={disabled} maxLength={250} onChange={event => setTagValue(event.target.value)}
          placeholder="Що саме позначити?" className="mt-1 w-full rounded-lg border border-[#CDBBAA] bg-white px-3 py-2 text-sm" />
      </label>
      <button type="button" disabled={disabled || !tagValue.trim() || !choices.length || value.length >= MAX_ENTITIES_PER_PARAGRAPH}
        onClick={() => add({ slug: choices.some(item => item.slug === selectedSlug) ? selectedSlug : choices[0].slug, value: tagValue })}
        className="min-h-10 rounded-lg bg-[#2E1B12] px-4 text-xs font-semibold text-white disabled:opacity-40">Додати тег</button>
    </div>
    {error && <p role="alert" className="text-xs text-[#A63A2B]">{error}</p>}
    {value.length ? <div className="flex flex-wrap gap-2">
      {value.map((tag, index) => <div key={tag.slug + ':' + index} className="flex max-w-full items-center gap-2 rounded-lg border border-[#D9CABC] bg-white px-2 py-1 text-xs">
        <span className="truncate">[/{tag.slug}:{tag.value}]</span>
        <button type="button" disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))}
          aria-label={'Прибрати тег ' + tag.slug} className="font-bold text-[#A63A2B] disabled:opacity-50">×</button>
      </div>)}
    </div> : <p className="text-xs text-[#71645A]">Теги необов'язкові. Можна перенести тільки літературний текст.</p>}
    <p className="text-xs text-[#71645A]">Теги зберігаються в рукописі, але приховуються у друкованому PDF/DOCX. Дані про реальних учасників сюди не вводьте.</p>
  </section>;
};
