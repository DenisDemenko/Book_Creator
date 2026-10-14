import { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, Printer, Sparkles } from 'lucide-react';
import type { CourseV2 } from '../types';
import { EducationalPdfTemplateGallery } from './EducationalPdfTemplateGallery';
import {
  courseToEducationalDocument,
  educationalDocumentToPreviewBook,
} from '../data/courseEducationalAdapter';
import { educationalDocumentStats } from '../data/educationalDocument';
import {
  educationalPdfTemplatesFor,
  type EducationalDocumentType,
  type EducationalPdfTemplate,
  type EducationalPdfTemplateId,
} from '../data/educationalPdfTemplates';

interface CourseTemplatePreferences {
  methodic?: EducationalPdfTemplateId;
  instruction?: EducationalPdfTemplateId;
  worksheet?: EducationalPdfTemplateId;
}

const TYPE_LABELS: Record<EducationalDocumentType, string> = {
  methodic: 'Методичка',
  instruction: 'Інструкція',
  worksheet: 'Вправи / домашнє',
};

function storageKey(courseId: string): string {
  return `nova-course-educational-design:${courseId}`;
}

function readPreferences(courseId: string): CourseTemplatePreferences {
  try {
    const raw = localStorage.getItem(storageKey(courseId));
    return raw ? (JSON.parse(raw) as CourseTemplatePreferences) : {};
  } catch {
    return {};
  }
}

function writePreferences(courseId: string, value: CourseTemplatePreferences): void {
  try {
    localStorage.setItem(storageKey(courseId), JSON.stringify(value));
  } catch {
    // Design choice is useful even when browser storage is unavailable.
  }
}

function firstTemplate(type: EducationalDocumentType): EducationalPdfTemplateId {
  return educationalPdfTemplatesFor(type)[0].id;
}

/**
 * Course-facing view of the shared educational PDF engine.
 *
 * Course content stays untouched. The panel stores only presentation choice
 * and projects the course into methodic/instruction/worksheet on demand.
 */
export function CourseEducationalDesignPanel({ course }: { course: CourseV2 }) {
  const [type, setType] = useState<EducationalDocumentType>('methodic');
  const [preferences, setPreferences] = useState<CourseTemplatePreferences>(() =>
    typeof window === 'undefined' ? {} : readPreferences(course.id),
  );
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setPreferences(readPreferences(course.id));
  }, [course.id]);

  const appliedId = preferences[type] || firstTemplate(type);
  const document = useMemo(
    () => courseToEducationalDocument(course, type, appliedId),
    [course, type, appliedId],
  );
  const stats = useMemo(() => educationalDocumentStats(document), [document]);

  function apply(template: EducationalPdfTemplate) {
    const next = { ...preferences, [type]: template.id };
    setPreferences(next);
    writePreferences(course.id, next);
  }

  async function previewPdf() {
    const templateId = preferences[type] || firstTemplate(type);
    const educational = courseToEducationalDocument(course, type, templateId);
    const previewBook = educationalDocumentToPreviewBook(educational);
    const reserved = window.open('', '_blank');

    setPreviewing(true);
    setPreviewError(null);
    try {
      const response = await fetch('/api/pdf/designcraft/theme-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          book: previewBook,
          educationalTemplateId: templateId,
        }),
      });
      if (!response.ok) {
        let message = `PDF preview: помилка ${response.status}`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // keep status message
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (reserved && !reserved.closed) {
        reserved.location.href = url;
      } else {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      reserved?.close();
      setPreviewError(error instanceof Error ? error.message : 'Не вдалося створити PDF preview.');
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="space-y-4" data-course-educational-design>
      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-amber-300">
              <Sparkles className="h-4 w-4" />
              <span className="text-[11px] font-bold uppercase tracking-wider">Дизайн навчальних матеріалів</span>
            </div>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-400">
              Один курс використовується як джерело для методички, інструкції та робочих аркушів. Зміст не дублюється — змінюється лише представлення.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void previewPdf()}
            disabled={previewing || stats.lessons === 0}
            className="flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            {previewing ? 'Створюю PDF…' : 'PDF preview'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {(['methodic', 'instruction', 'worksheet'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setType(item)}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                type === item
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              {TYPE_LABELS[item]}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-500">
          <span className="rounded-full bg-slate-900 px-2.5 py-1">{stats.modules} модулів</span>
          <span className="rounded-full bg-slate-900 px-2.5 py-1">{stats.lessons} уроків</span>
          <span className="rounded-full bg-slate-900 px-2.5 py-1">{stats.blocks} semantic blocks</span>
        </div>

        {stats.lessons === 0 ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80">
            <FileText className="mt-0.5 h-4 w-4 shrink-0" />
            Додайте хоча б один урок — після цього DesignCraft зможе сформувати живе PDF preview.
          </div>
        ) : null}

        {previewError ? (
          <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
            {previewError} Дизайн і зміст курсу не втрачено.
          </div>
        ) : null}
      </div>

      <div className="[&>section]:border-slate-800 [&>section]:bg-slate-950/40 [&>section]:text-slate-100">
        <EducationalPdfTemplateGallery
          key={`${course.id}:${type}:${appliedId}`}
          documentType={type}
          value={appliedId}
          onApply={apply}
          onCustomize={(template) => {
            setPreviewError(
              `«${template.shortLabelUk}»: розширене налаштування буде відкривати спільний Designer Mode; базовий шаблон лишається незмінним.`,
            );
          }}
        />
      </div>
    </div>
  );
}
