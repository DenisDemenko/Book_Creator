import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, Loader2, Save, SlidersHorizontal } from 'lucide-react';
import {
  emptyCustomBookDesignTheme,
  type CustomBookDesignTheme,
  type DesignerEntityStyle,
  type DesignerThemeEntity,
} from '../data/customBookDesignTheme';
import type { EducationalPdfTemplate } from '../data/educationalPdfTemplates';

interface Props {
  courseId: string;
  template: EducationalPdfTemplate;
  value?: CustomBookDesignTheme | null;
  onSave: (theme: CustomBookDesignTheme) => void;
  onPreview: (theme: CustomBookDesignTheme) => Promise<void>;
  onClose: () => void;
}

interface EntityControl {
  id: DesignerThemeEntity;
  label: string;
  description: string;
}

const ENTITY_CONTROLS: EntityControl[] = [
  { id: 'key-idea', label: 'Мета / ключова ідея', description: 'Цілі уроку, результати, teacher notes, акцентні картки.' },
  { id: 'case-study', label: 'Практика / проєкт', description: 'Практичні вправи, домашні завдання і проєктні блоки.' },
  { id: 'evidence', label: 'Безпека / оцінювання', description: 'Warning, safety, checklist, критерії та типові помилки.' },
  { id: 'system-message', label: 'Матеріали / flow-картки', description: 'Обладнання, матеріали та візуальні етапи процесу.' },
  { id: 'location-time', label: 'Крок інструкції', description: 'Технічна смуга кроку у Clear Steps.' },
  { id: 'quote', label: 'Рефлексія / питання', description: 'Поля для роздумів, відповідей і самоперевірки.' },
];

const FONT_OPTIONS = [
  'DejaVu Serif',
  'DejaVu Sans',
  'Liberation Serif',
  'Liberation Sans',
  'Noto Serif',
  'Noto Sans',
] as const;

function themeFor(courseId: string, template: EducationalPdfTemplate): CustomBookDesignTheme {
  const theme = emptyCustomBookDesignTheme(`${template.shortLabelUk} — власний дизайн`);
  theme.id = `custom-education-${courseId}-${template.id}`.replace(/[^a-zA-Z0-9-_]/g, '-');
  theme.basedOn = template.rendererBaseTheme;
  theme.descriptionUk = `Власне оформлення навчального шаблону ${template.labelUk}.`;
  theme.page = {
    ...theme.page,
    pageBackground: {
      kind: 'color',
      color: template.preview.paperColor,
      opacity: 1,
      fit: 'cover',
      position: 'center',
    },
    textColor: '#1F2937',
    accentColor: template.preview.accentColor,
    mirroredMargins: false,
  };
  return theme;
}

function cloneTheme(theme: CustomBookDesignTheme): CustomBookDesignTheme {
  return JSON.parse(JSON.stringify(theme)) as CustomBookDesignTheme;
}

function fontFamily(theme: CustomBookDesignTheme, slot: 'body' | 'heading'): string {
  return theme.fonts.find((font) => font.slot === slot)?.family || (slot === 'body' ? 'DejaVu Serif' : 'DejaVu Sans');
}

function replaceFont(theme: CustomBookDesignTheme, slot: 'body' | 'heading', family: string): CustomBookDesignTheme {
  const next = cloneTheme(theme);
  next.fonts = next.fonts.map((font) => (font.slot === slot ? { ...font, source: 'system', family } : font));
  next.updatedAt = new Date().toISOString();
  return next;
}

function entityStyle(theme: CustomBookDesignTheme, id: DesignerThemeEntity): DesignerEntityStyle {
  return theme.entities[id] || {
    entity: id,
    enabled: true,
    align: 'left',
    background: { kind: 'none', opacity: 1 },
    border: { style: 'none', sides: [] },
  };
}

function updateEntity(
  theme: CustomBookDesignTheme,
  id: DesignerThemeEntity,
  patch: Partial<DesignerEntityStyle>,
): CustomBookDesignTheme {
  const next = cloneTheme(theme);
  next.entities[id] = {
    ...entityStyle(theme, id),
    ...patch,
    entity: id,
    enabled: true,
  };
  next.updatedAt = new Date().toISOString();
  return next;
}

function fieldClass(): string {
  return 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400';
}

export function EducationalTemplateDesigner({
  courseId,
  template,
  value,
  onSave,
  onPreview,
  onClose,
}: Props) {
  const initial = useMemo(() => cloneTheme(value || themeFor(courseId, template)), [courseId, template, value]);
  const [draft, setDraft] = useState<CustomBookDesignTheme>(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initial));
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = cloneTheme(value || themeFor(courseId, template));
    setDraft(next);
    setSavedSnapshot(JSON.stringify(next));
    setError(null);
  }, [courseId, template.id]); // value intentionally initializes per opened template

  const dirty = JSON.stringify(draft) !== savedSnapshot;

  function updatePage(patch: Partial<CustomBookDesignTheme['page']>) {
    setDraft((current) => ({
      ...current,
      page: { ...current.page, ...patch },
      updatedAt: new Date().toISOString(),
    }));
  }

  function updatePaper(color: string) {
    setDraft((current) => ({
      ...current,
      page: {
        ...current.page,
        pageBackground: {
          ...current.page.pageBackground,
          kind: 'color',
          color,
          opacity: 1,
        },
      },
      updatedAt: new Date().toISOString(),
    }));
  }

  async function preview() {
    setPreviewing(true);
    setError(null);
    try {
      await onPreview(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося сформувати PDF preview.');
    } finally {
      setPreviewing(false);
    }
  }

  function save() {
    const next = { ...draft, basedOn: template.rendererBaseTheme, updatedAt: new Date().toISOString() };
    setDraft(next);
    setSavedSnapshot(JSON.stringify(next));
    onSave(next);
  }

  return (
    <section className="rounded-2xl border border-violet-500/20 bg-slate-950/60 p-4" data-educational-designer-mode>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <button type="button" onClick={onClose} className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200">
            <ArrowLeft className="h-3.5 w-3.5" /> До галереї
          </button>
          <div className="flex items-center gap-2 text-violet-300">
            <SlidersHorizontal className="h-4 w-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider">Designer Mode</span>
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-100">{template.labelUk}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
            Вбудований шаблон не змінюється. Налаштування зберігаються як власна тема <span className="font-mono">basedOn: {template.rendererBaseTheme}</span>.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void preview()}
            disabled={previewing}
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            PDF preview
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            className="flex items-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-bold text-white hover:bg-violet-400 disabled:cursor-default disabled:opacity-40"
          >
            <Save className="h-4 w-4" /> Зберегти тему
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Назва власної теми</label>
            <input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value, updatedAt: new Date().toISOString() }))}
              className={`mt-1 ${fieldClass()}`}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="text-[10px] font-semibold text-slate-500">Акцент
              <input type="color" value={draft.page.accentColor} onChange={(event) => updatePage({ accentColor: event.target.value })} className="mt-1 h-9 w-full rounded border border-slate-700 bg-slate-950" />
            </label>
            <label className="text-[10px] font-semibold text-slate-500">Текст
              <input type="color" value={draft.page.textColor} onChange={(event) => updatePage({ textColor: event.target.value })} className="mt-1 h-9 w-full rounded border border-slate-700 bg-slate-950" />
            </label>
            <label className="text-[10px] font-semibold text-slate-500">Папір
              <input type="color" value={draft.page.pageBackground.color || '#ffffff'} onChange={(event) => updatePaper(event.target.value)} className="mt-1 h-9 w-full rounded border border-slate-700 bg-slate-950" />
            </label>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Основний шрифт</label>
            <select value={fontFamily(draft, 'body')} onChange={(event) => setDraft((current) => replaceFont(current, 'body', event.target.value))} className={`mt-1 ${fieldClass()}`}>
              {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Шрифт заголовків</label>
            <select value={fontFamily(draft, 'heading')} onChange={(event) => setDraft((current) => replaceFont(current, 'heading', event.target.value))} className={`mt-1 ${fieldClass()}`}>
              {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-semibold text-slate-500">Колонтитул, мм
              <input type="number" min={0} max={25} value={draft.page.headerHeightMm} onChange={(event) => updatePage({ headerHeightMm: Number(event.target.value) })} className={`mt-1 ${fieldClass()}`} />
            </label>
            <label className="text-[10px] font-semibold text-slate-500">Низ, мм
              <input type="number" min={0} max={25} value={draft.page.footerHeightMm} onChange={(event) => updatePage({ footerHeightMm: Number(event.target.value) })} className={`mt-1 ${fieldClass()}`} />
            </label>
          </div>
        </aside>

        <div className="space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <p className="text-xs font-bold text-slate-200">Семантичні блоки</p>
            <p className="mt-1 text-[11px] text-slate-500">Ці стилі накладаються поверх базового educational template тільки у власній темі.</p>
          </div>

          {ENTITY_CONTROLS.map((control) => {
            const style = entityStyle(draft, control.id);
            const background = style.background?.color || '#ffffff';
            const text = style.textColor || draft.page.textColor;
            const borderColor = style.border?.color || draft.page.accentColor;
            return (
              <div key={control.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[220px] flex-1">
                    <p className="text-sm font-semibold text-slate-100">{control.label}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{control.description}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-[9px] font-semibold text-slate-500">Фон
                      <input type="color" value={background} onChange={(event) => setDraft((current) => updateEntity(current, control.id, { background: { kind: 'color', color: event.target.value, opacity: 1 } }))} className="mt-1 h-8 w-12 rounded border border-slate-700 bg-slate-950" />
                    </label>
                    <label className="text-[9px] font-semibold text-slate-500">Текст
                      <input type="color" value={text} onChange={(event) => setDraft((current) => updateEntity(current, control.id, { textColor: event.target.value }))} className="mt-1 h-8 w-12 rounded border border-slate-700 bg-slate-950" />
                    </label>
                    <label className="text-[9px] font-semibold text-slate-500">Рамка
                      <input type="color" value={borderColor} onChange={(event) => setDraft((current) => updateEntity(current, control.id, { border: { ...(entityStyle(current, control.id).border || { style: 'solid', sides: ['left'] }), style: 'solid', color: event.target.value, widthPt: entityStyle(current, control.id).border?.widthPt || 1, sides: entityStyle(current, control.id).border?.sides?.length ? entityStyle(current, control.id).border?.sides : ['left'] } }))} className="mt-1 h-8 w-12 rounded border border-slate-700 bg-slate-950" />
                    </label>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <label className="text-[10px] font-semibold text-slate-500">Розмір, pt
                    <input type="number" min={7} max={28} value={style.fontSizePt || 11} onChange={(event) => setDraft((current) => updateEntity(current, control.id, { fontSizePt: Number(event.target.value) }))} className={`mt-1 ${fieldClass()}`} />
                  </label>
                  <label className="text-[10px] font-semibold text-slate-500">Padding, мм
                    <input type="number" min={0} max={15} value={style.paddingMm?.top ?? 3} onChange={(event) => { const v = Number(event.target.value); setDraft((current) => updateEntity(current, control.id, { paddingMm: { top: v, right: v, bottom: v, left: v } })); }} className={`mt-1 ${fieldClass()}`} />
                  </label>
                  <label className="text-[10px] font-semibold text-slate-500">Радіус, мм
                    <input type="number" min={0} max={12} value={style.radiusMm ?? 2} onChange={(event) => setDraft((current) => updateEntity(current, control.id, { radiusMm: Number(event.target.value) }))} className={`mt-1 ${fieldClass()}`} />
                  </label>
                  <label className="text-[10px] font-semibold text-slate-500">Рамка, pt
                    <input type="number" min={0} max={4} step={0.5} value={style.border?.widthPt ?? 1} onChange={(event) => setDraft((current) => updateEntity(current, control.id, { border: { ...(entityStyle(current, control.id).border || { style: 'solid', sides: ['left'] }), style: Number(event.target.value) > 0 ? 'solid' : 'none', widthPt: Number(event.target.value), color: entityStyle(current, control.id).border?.color || current.page.accentColor, sides: entityStyle(current, control.id).border?.sides?.length ? entityStyle(current, control.id).border?.sides : ['left'] } }))} className={`mt-1 ${fieldClass()}`} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error ? <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div> : null}
      {dirty ? <p className="mt-3 text-[10px] text-amber-300">Є незбережені зміни. PDF preview може показати їх до збереження.</p> : null}
    </section>
  );
}
