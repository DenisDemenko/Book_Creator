import React from 'react';
import { Trash2 } from 'lucide-react';
import type {
  DesignerBlockPlacement,
  DesignerBlockRepeat,
  DesignerCustomBlock,
  DesignerSemanticSource,
} from '../data/customBookDesignTheme';
import { DESIGN_ENTITY_FIELDS } from '../data/bookDesignEntityAdapter';
import { defaultPlacementFor, defaultRepeatFor, placementOf } from '../data/bookDesignPlacement';

interface Props {
  blocks: DesignerCustomBlock[];
  onAdd: (source: DesignerSemanticSource) => void;
  onChange: (id: string, patch: Partial<DesignerCustomBlock>) => void;
  onRemove: (id: string) => void;
}

const FIELD_LABELS: Record<string, string> = {
  name: "Ім'я",
  surname: 'Прізвище',
  alias: 'Псевдонім',
  role: 'Роль',
  age: 'Вік',
  gender: 'Стать',
  profession: 'Професія',
  description: 'Опис',
  biography: 'Біографія',
  goal: 'Мета',
  emotionalState: 'Емоційний стан',
  motivation: 'Мотивація',
  internalConflict: 'Внутрішній конфлікт',
  goals: 'Цілі',
  desires: 'Бажання',
  fears: 'Страхи',
  tags: 'Теги',
  title: 'Назва',
  act: 'Акт',
  summary: 'Короткий опис',
  location: 'Локація',
  timeOfDay: 'Час',
  timelineOrder: 'Порядок у таймлайні',
  intensityScore: 'Інтенсивність',
  conflict: 'Конфлікт',
  resolution: 'Рішення',
  participants: 'Учасники',
  character: 'Персонаж',
  scene: 'Сцена',
};

const SOURCE_LABELS: Record<DesignerSemanticSource, string> = {
  manual: 'Власний',
  character: 'Персонаж',
  scene: 'Сцена',
  conflict: 'Конфлікт',
  tag: 'Тег',
  'paragraph-style': 'Стиль абзацу',
};

const PLACEMENT_LABELS: Array<{ value: DesignerBlockPlacement; label: string }> = [
  { value: 'inline', label: 'У тексті' },
  { value: 'scene-opening', label: 'На початку сцени' },
  { value: 'chapter-opening', label: 'На початку розділу' },
  { value: 'full-width', label: 'На всю ширину' },
  { value: 'full-page', label: 'Окрема сторінка' },
  { value: 'appendix', label: 'У додатку' },
];

const REPEAT_LABELS: Array<{ value: DesignerBlockRepeat; label: string }> = [
  { value: 'once', label: 'Один раз' },
  { value: 'per-character', label: 'Для кожного персонажа' },
  { value: 'per-scene', label: 'Для кожної сцени' },
  { value: 'per-conflict', label: 'Для кожного конфлікту' },
  { value: 'matched', label: 'Для кожного збігу' },
];

function inputClass(): string {
  return 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-amber-500';
}

function semanticFields(source: DesignerSemanticSource): readonly string[] {
  if (source === 'character' || source === 'scene' || source === 'conflict') return DESIGN_ENTITY_FIELDS[source];
  return [];
}

function sourcePreview(block: DesignerCustomBlock): string {
  const selected = (block.fields || []).slice(0, 4).map((field) => FIELD_LABELS[field] || field);
  if (block.source === 'character') return selected.length ? selected.join(' · ') : "Ім'я · роль · опис · мета";
  if (block.source === 'scene') return selected.length ? selected.join(' · ') : 'Назва · локація · час · учасники';
  if (block.source === 'conflict') return selected.length ? selected.join(' · ') : 'Персонаж · конфлікт · рішення';
  return block.selector ? `Умова: ${block.selector}` : 'Власний семантичний блок';
}

function nextFields(source: DesignerSemanticSource, current: string[]): string[] {
  const allowed = semanticFields(source);
  if (!allowed.length) return current;
  const kept = current.filter((field) => allowed.includes(field));
  return kept.length ? kept : allowed.slice(0, Math.min(4, allowed.length));
}

export const BookDesignSemanticBlockEditor: React.FC<Props> = ({ blocks, onAdd, onChange, onRemove }) => {
  function toggleField(block: DesignerCustomBlock, field: string, checked: boolean) {
    const fields = block.fields || [];
    onChange(block.id, {
      fields: checked ? Array.from(new Set([...fields, field])) : fields.filter((item) => item !== field),
    });
  }

  return (
    <section className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4" data-semantic-block-editor>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">Семантичні блоки</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
            Блок автоматично бере дані з реальних персонажів, сцен і конфліктів книги. Виберіть, які поля показувати, де блок з’являється та як часто повторюється.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onAdd('character')} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-amber-500 hover:text-amber-200">+ Персонаж</button>
          <button type="button" onClick={() => onAdd('scene')} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-amber-500 hover:text-amber-200">+ Сцена</button>
          <button type="button" onClick={() => onAdd('conflict')} className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:border-amber-500 hover:text-amber-200">+ Конфлікт</button>
          <button type="button" onClick={() => onAdd('manual')} className="rounded-lg border border-amber-700 px-2.5 py-1.5 text-xs text-amber-200">+ Власний</button>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {blocks.map((block) => {
          const placement = placementOf(block, block.source);
          const fields = semanticFields(block.source);
          const selected = new Set(block.fields || []);
          return (
            <article key={block.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/75">
              <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">{SOURCE_LABELS[block.source]}</span>
                    <span className="text-[10px] text-slate-600">{PLACEMENT_LABELS.find((item) => item.value === placement.placement)?.label}</span>
                  </div>
                  <input value={block.name} onChange={(event) => onChange(block.id, { name: event.target.value })} className={`${inputClass()} mt-2`} placeholder="Назва блоку" />
                </div>
                <button type="button" onClick={() => onRemove(block.id)} className="rounded-lg border border-red-900/70 p-2 text-red-300" title="Видалити блок"><Trash2 className="h-4 w-4" /></button>
              </div>

              <div className="grid gap-4 p-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(230px,0.8fr)]">
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-[11px] text-slate-500">
                      Джерело
                      <select
                        value={block.source}
                        onChange={(event) => {
                          const source = event.target.value as DesignerSemanticSource;
                          onChange(block.id, {
                            source,
                            fields: nextFields(source, block.fields || []),
                            placement: defaultPlacementFor(source),
                            repeat: defaultRepeatFor(source),
                            style: {
                              ...block.style,
                              entity: source === 'character' || source === 'scene' || source === 'conflict' ? source : 'body',
                            },
                          });
                        }}
                        className={`${inputClass()} mt-1`}
                      >
                        <option value="character">Персонаж</option>
                        <option value="scene">Сцена</option>
                        <option value="conflict">Конфлікт</option>
                        <option value="manual">Власний</option>
                        <option value="tag">Тег</option>
                        <option value="paragraph-style">Стиль абзацу</option>
                      </select>
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Selector / умова
                      <input value={block.selector || ''} onChange={(event) => onChange(block.id, { selector: event.target.value })} className={`${inputClass()} mt-1`} placeholder="ім’я, тег, тип, частина тексту…" />
                    </label>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-[11px] text-slate-500">
                      Розміщення
                      <select value={placement.placement} onChange={(event) => onChange(block.id, { placement: event.target.value as DesignerBlockPlacement })} className={`${inputClass()} mt-1`}>
                        {PLACEMENT_LABELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Повторення
                      <select value={placement.repeat} onChange={(event) => onChange(block.id, { repeat: event.target.value as DesignerBlockRepeat })} className={`${inputClass()} mt-1`}>
                        {REPEAT_LABELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </label>
                  </div>

                  {fields.length > 0 ? (
                    <div>
                      <div className="text-[11px] font-semibold text-slate-300">Що показувати в блоці</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {fields.map((field) => (
                          <label key={field} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${selected.has(field) ? 'border-amber-500/40 bg-amber-500/5 text-amber-100' : 'border-slate-800 text-slate-400'}`}>
                            <input type="checkbox" checked={selected.has(field)} onChange={(event) => toggleField(block, field, event.target.checked)} />
                            {FIELD_LABELS[field] || field}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-800 p-3 text-[11px] leading-relaxed text-slate-500">
                      Для цього джерела структуровані поля не визначені. Використовуйте selector; renderer застосує блок до відповідних збігів, коли такий semantic source підтримується адаптером.
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/65 p-3">
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-amber-300">Preview блоку</div>
                  <div className="mt-2 text-sm font-semibold text-white">{block.name || SOURCE_LABELS[block.source]}</div>
                  <div className="mt-2 text-xs leading-relaxed text-slate-400">{sourcePreview(block)}</div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-lg bg-slate-950 p-2"><div className="text-slate-600">Розміщення</div><div className="mt-1 text-slate-300">{PLACEMENT_LABELS.find((item) => item.value === placement.placement)?.label}</div></div>
                    <div className="rounded-lg bg-slate-950 p-2"><div className="text-slate-600">Повторення</div><div className="mt-1 text-slate-300">{REPEAT_LABELS.find((item) => item.value === placement.repeat)?.label}</div></div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        {blocks.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center">
            <div className="text-sm font-semibold text-slate-300">Ще немає власних блоків</div>
            <p className="mt-1 text-xs text-slate-500">Додайте картку персонажа, сцени або конфлікту. Дані будуть братися з книги автоматично.</p>
          </div>
        )}
      </div>
    </section>
  );
};
