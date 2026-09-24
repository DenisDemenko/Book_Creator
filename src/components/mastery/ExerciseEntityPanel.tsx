import React from "react";
import { Tags, CheckCircle2, Circle } from "lucide-react";
import { entityBySlug, parseAnyEntityTags, textColorOnWhite } from "../../utils/coreEntities";

/**
 * Сутності вправи в тренажері майстерності (запис #237).
 *
 * Показує, ЯКІ сутності реєстру вправа використовує і як їх позначити, та
 * дає вставити тег у робоче поле одним кліком. Позначка «розмічено» ставиться
 * за самим текстом чернетки (`parseAnyEntityTags`), а не за кліками: автор
 * може набрати тег руками, у тому числі українським ключем (`/персонаж:`), —
 * і це теж зарахується.
 */
interface ExerciseEntityPanelProps {
  slugs: string[];
  entityStep?: string;
  draft: string;
  /** Вставити канонічний тег `[/slug:]` у робоче поле (курсор — перед `]`). */
  onInsertTag: (slug: string) => void;
}

export function usedEntitySlugs(draft: string): Set<string> {
  return new Set(
    parseAnyEntityTags(draft || "")
      .map((tag) => tag.entity?.slug)
      .filter((slug): slug is string => !!slug)
  );
}

export const ExerciseEntityPanel: React.FC<ExerciseEntityPanelProps> = ({ slugs, entityStep, draft, onInsertTag }) => {
  const entities = slugs.map((slug) => entityBySlug(slug)).filter((e): e is NonNullable<typeof e> => !!e);
  if (entities.length === 0) return null;
  const used = usedEntitySlugs(draft);
  const doneCount = entities.filter((e) => used.has(e.slug)).length;

  return (
    <div className="mt-3 p-3 rounded-xl bg-white/70 border border-violet-200 flex flex-col gap-2" data-exercise-entities>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-extrabold text-violet-800 uppercase tracking-wide flex items-center gap-1.5">
          <Tags className="w-3.5 h-3.5" />
          Сутності вправи
        </span>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            doneCount === entities.length ? "bg-emerald-100 text-emerald-800" : "bg-violet-100 text-violet-800"
          }`}
          data-exercise-entities-count
        >
          Розмічено {doneCount} з {entities.length}
        </span>
      </div>
      {entityStep && <p className="text-[11px] text-[#3d4a3e] leading-relaxed">{entityStep}</p>}
      <div className="flex flex-wrap gap-1.5">
        {entities.map((entity) => {
          const isUsed = used.has(entity.slug);
          return (
            <button
              key={entity.slug}
              type="button"
              onClick={() => onInsertTag(entity.slug)}
              data-entity-chip={entity.slug}
              data-entity-used={isUsed ? "1" : "0"}
              title={`Вставити тег [/${entity.slug}:] у текст. Характеристики: ${entity.characteristics.join(", ")}`}
              className={`px-2 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 border transition-all cursor-pointer ${
                isUsed ? "bg-emerald-50 border-emerald-300" : "bg-white border-gray-200 hover:border-violet-300"
              }`}
              style={{ color: textColorOnWhite(entity.color) }}
            >
              {isUsed ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <Circle className="w-3 h-3" />}
              <span>{entity.nameUk}</span>
              <span className="font-mono text-[10px] opacity-70">/{entity.slug}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** Розбір розмітки від ШІ-коуча: чи вжито кожну сутність і чи правильно. */
export const EntityFeedbackList: React.FC<{ items: { slug: string; used?: boolean; comment?: string }[] }> = ({ items }) => {
  const rows = (items || [])
    .map((item) => ({ ...item, entity: entityBySlug(String(item.slug || "")) }))
    .filter((item) => !!item.entity);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-entity-feedback>
      <div className="text-xs font-bold text-[#6c7b6d] uppercase">Розмітка сутностями:</div>
      <div className="flex flex-col gap-1.5">
        {rows.map((row, i) => (
          <div key={i} className="p-2.5 rounded-xl neo-pressed-soft bg-gray-50 text-xs flex items-start gap-2">
            {row.used ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <Circle className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
            )}
            <span>
              <span className="font-bold" style={{ color: textColorOnWhite(row.entity!.color) }}>
                {row.entity!.nameUk}
              </span>
              {row.comment ? <span className="text-gray-700"> — {row.comment}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
