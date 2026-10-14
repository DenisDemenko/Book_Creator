import { useMemo, useState } from 'react';
import {
  educationalPdfTemplatesFor,
  type EducationalDocumentType,
  type EducationalPdfTemplate,
  type EducationalPdfTemplateId,
} from '../data/educationalPdfTemplates';

export interface EducationalPdfTemplateGalleryProps {
  documentType: EducationalDocumentType;
  value?: EducationalPdfTemplateId | null;
  onApply?: (template: EducationalPdfTemplate) => void;
  onCustomize?: (template: EducationalPdfTemplate) => void;
  title?: string;
}

const CATEGORY_LABELS: Record<EducationalDocumentType, string> = {
  methodic: 'Шаблони для методичок',
  instruction: 'Шаблони для інструкцій',
  worksheet: 'Вправи та домашні завдання',
};

function TemplateMiniPage({ template, selected }: { template: EducationalPdfTemplate; selected: boolean }) {
  const { preview } = template;
  const isVisual = preview.layout === 'visual' || preview.layout === 'flow' || preview.layout === 'project';
  const isCards = preview.layout === 'cards' || preview.layout === 'interactive';
  const isSteps = preview.layout === 'steps';

  return (
    <div
      aria-hidden="true"
      className={`relative aspect-[0.72] overflow-hidden rounded-lg border bg-white shadow-sm ${selected ? 'ring-2 ring-blue-500' : ''}`}
      style={{ backgroundColor: preview.paperColor }}
    >
      <div className="h-2 w-full" style={{ backgroundColor: preview.accentColor }} />
      <div className={preview.density === 'compact' ? 'p-3' : 'p-4'}>
        <div
          className={`mb-2 h-2.5 rounded ${preview.headingAlign === 'center' ? 'mx-auto w-2/3' : 'w-3/4'}`}
          style={{ backgroundColor: preview.accentColor }}
        />
        <div className="mb-4 space-y-1.5 opacity-55">
          <div className="h-1.5 w-full rounded bg-slate-500" />
          <div className="h-1.5 w-11/12 rounded bg-slate-400" />
          <div className="h-1.5 w-4/5 rounded bg-slate-400" />
        </div>

        {isVisual ? (
          <div className="mb-3 h-16 rounded-md border border-black/10 bg-white/70" />
        ) : null}

        <div className={isCards ? 'grid gap-2' : 'space-y-2'}>
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className={`rounded-md ${isCards || isSteps ? 'border bg-white/75 p-2' : 'py-1'}`}
              style={isSteps ? { borderLeft: `3px solid ${preview.accentColor}` } : undefined}
            >
              <div className="flex items-center gap-2">
                {isSteps ? (
                  <span
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[8px] font-bold text-white"
                    style={{ backgroundColor: preview.accentColor }}
                  >
                    {index + 1}
                  </span>
                ) : null}
                <div className="h-1.5 w-2/3 rounded bg-slate-500/65" />
              </div>
              <div className="mt-1.5 h-1 w-full rounded bg-slate-400/45" />
              <div className="mt-1 h-1 w-4/5 rounded bg-slate-400/35" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Staged educational template picker: selecting a design only changes the
 * candidate preview. The parent receives a change only after explicit Apply.
 * This mirrors Book Design Studio and prevents an exploratory click from
 * overwriting the current document design.
 */
export function EducationalPdfTemplateGallery({
  documentType,
  value = null,
  onApply,
  onCustomize,
  title,
}: EducationalPdfTemplateGalleryProps) {
  const templates = useMemo(() => educationalPdfTemplatesFor(documentType), [documentType]);
  const fallbackId = templates[0]?.id ?? null;
  const [candidateId, setCandidateId] = useState<EducationalPdfTemplateId | null>(value || fallbackId);

  const candidate = templates.find((template) => template.id === candidateId) || templates[0] || null;
  const changed = Boolean(candidate && candidate.id !== value);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">PDF Design Engine</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">{title || CATEGORY_LABELS[documentType]}</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Оберіть дизайн, перегляньте його на документі та застосуйте окремою дією.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          3 дизайни
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {templates.map((template) => {
          const selected = template.id === candidate?.id;
          const applied = template.id === value;
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => setCandidateId(template.id)}
              className={`rounded-xl border p-3 text-left transition ${
                selected ? 'border-blue-500 bg-blue-50/40' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <TemplateMiniPage template={template} selected={selected} />
              <div className="mt-3 flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{template.shortLabelUk}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{template.descriptionUk}</p>
                </div>
                {applied ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    Активний
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {candidate ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <div className="text-sm text-slate-600">
            <span className="font-medium text-slate-900">{candidate.labelUk}</span>
            <span className="mx-2 text-slate-300">•</span>
            база рендера: <span className="font-mono text-xs">{candidate.rendererBaseTheme}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {onCustomize ? (
              <button
                type="button"
                onClick={() => onCustomize(candidate)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Налаштувати
              </button>
            ) : null}
            <button
              type="button"
              disabled={!changed}
              onClick={() => onApply?.(candidate)}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-default disabled:opacity-40"
            >
              Застосувати
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
