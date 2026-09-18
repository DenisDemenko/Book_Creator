import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Cloud,
  Download,
  ExternalLink,
  ListOrdered,
  Loader2,
  Plus,
  Printer,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PlayCircle } from 'lucide-react';
import type { Instruction, InstructionDocType } from '../types';
import {
  INSTRUCTION_SECTION_ORDER,
  INSTRUCTION_TYPES,
  findInstructionType,
  type InstructionSectionKey,
  type InstructionTypeConfig,
} from '../data/instructionTypes';
import {
  createEmptyInstruction,
  createEmptyStep,
  instructionCompleteness,
  instructionExportFileName,
  instructionUid,
  loadInstructionDraft,
  saveInstructionDraft,
} from '../utils/instructionDraft';
import {
  buildInstructionBookSections,
  buildInstructionBookTitle,
  meaningfulInstructionSteps,
  type InstructionBookSectionDraft,
} from '../utils/instructionBookDraft';

/** Результат «Створити книгу» — саме це чекає App.tsx для складання нового Book. */
export interface InstructionBookCreationPayload {
  title: string;
  sections: InstructionBookSectionDraft[];
}

/**
 * Конструктор інструкцій — реалізація напряму «Інструкція» експрес-майстра
 * (був `planned`-заглушкою, src/data/expressTracks.ts).
 *
 * Скопійовано функціонально за зразком окремого інструмента, на який
 * власник дав посилання (fusion-instruction-builder.<…>.chatgpt.site):
 * той самий каркас із 9 розділів, ті самі 4 типи документа (перемикаються
 * без втрати вже введених даних — лише підписи розділів підлаштовуються,
 * див. src/data/instructionTypes.ts), той самий набір дій — «Нова» /
 * «Експорт» / «Друкувати · PDF» / автозбереження в localStorage.
 *
 * Свідома відмінність від зразка: там немає окремого кроку «створити» —
 * інструмент сам по собі є редактором ОДНОГО документа, без багатьох
 * інструкцій і без серверного сховища. Це рішення лишалося в силі до
 * журналу #198 — «доки власник не попросить іншого». Власник попросив
 * (журнал #199): кнопка «Створити книгу» переносить готовий документ у
 * «Книга & Текст» як ЗАВЖДИ нову книгу (onInstructionBookCreated →
 * App.tsx), а кожен крок перед тим поглиблюється ШІ через
 * /api/ai/elaborate-instruction-steps і лягає в текст як [AI-DRAFT]
 * (src/utils/manuscriptDoc.ts) — автор бачить, що це доповнення ШІ, і сам
 * вирішує прийняти чи відхилити. Сам документ інструкції як і раніше
 * лишається локальним (localStorage, без серверного сховища «багатьох
 * інструкцій») — серверною стороною стала лише разова дія завершення.
 */

const inputCls =
  'w-full px-2.5 py-1.5 rounded-lg bg-slate-950/70 border border-slate-700 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-emerald-400';
const areaCls = inputCls + ' resize-y';
const labelCls = 'block text-[11px] font-semibold text-slate-400 mb-1';
const cardCls = 'rounded-xl bg-slate-950/60 border border-slate-800 p-3';
const addBtnCls =
  'w-full py-2 rounded-xl border border-dashed border-slate-700 text-slate-400 hover:text-emerald-300 hover:border-emerald-400/40 text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1.5';
const deleteBtnCls = 'p-1.5 text-slate-500 hover:text-rose-300 transition-colors shrink-0';

const TYPE_ICONS: Record<InstructionDocType, LucideIcon> = {
  assembly: Wrench,
  usage: PlayCircle,
  safety: ShieldAlert,
  sequence: ListOrdered,
};

function labeled(label: string, node: React.ReactNode) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {node}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Прев'ю / друк — та сама розмітка для панелі праворуч і для друкованого
// документа (`@media print`), щоб не тримати два незалежні описи вигляду.
// Порожнє поле показує свій плейсхолдер — так само, як і в зразку: людина
// одразу бачить, ЩО саме опиняється в документі, якщо розділ не заповнити.
// ---------------------------------------------------------------------------

const InstructionArticle: React.FC<{ doc: Instruction; type: InstructionTypeConfig }> = ({ doc, type }) => {
  const title = doc.title.trim() || type.namePlaceholder;
  const meta = `Код: ${doc.modelCode.trim() || '—'} · Час: ${doc.estimatedTime.trim() || '—'} · Виконавців: ${doc.executorsCount.trim() || '—'}`;
  const materials = doc.materials.filter((m) => m.name.trim());
  const tools = doc.tools.filter((t) => t.trim());
  const warnings = doc.warnings.filter((w) => w.trim());
  const steps = doc.steps.filter((s) => s.title.trim() || s.description.trim());
  const finalChecks = doc.finalChecks.filter((c) => c.trim());
  const issues = doc.troubleshooting.filter((r) => r.issue.trim() || r.cause.trim() || r.action.trim());
  const hasWarranty = doc.warranty.period.trim() || doc.warranty.responsible.trim() || doc.warranty.notes.trim();

  let n = 0;
  const num = () => ++n;

  return (
    <article className="rounded-2xl bg-white text-slate-900 p-6 text-sm leading-relaxed shadow-xl print:shadow-none print:rounded-none">
      <div className="text-[11px] font-mono font-bold uppercase tracking-widest text-emerald-700">{type.docBadge}</div>
      <h1 className="mt-1 text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-xs text-slate-500">{meta}</p>
      <hr className="my-4 border-slate-300" />

      <section className="mb-4">
        <h2 className="text-sm font-bold mb-1">{num()}. {type.sections.overview.heading}</h2>
        <p className="text-slate-700 whitespace-pre-wrap">{doc.description.trim() || 'Опишіть призначення виробу та результат складання.'}</p>
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-bold mb-1">{num()}. {type.sections.materials.heading}</h2>
        {materials.length ? (
          <ul className="space-y-0.5">
            {materials.map((m) => (
              <li key={m.id}><b>{m.code || '—'}</b> — {m.name} · {m.qty || '1'}</li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-400">— {type.materialsPlaceholder} · 1</p>
        )}
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-bold mb-1">{num()}. {type.sections.tools.heading}</h2>
        {tools.length ? (
          <ul className="list-disc pl-5 space-y-0.5">
            {tools.map((tItem, i) => <li key={i}>{tItem}</li>)}
          </ul>
        ) : (
          <p className="text-slate-400">{type.toolsPlaceholder}</p>
        )}
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-bold mb-1">{num()}. {type.sections.warnings.heading}</h2>
        {warnings.length ? (
          <ul className="space-y-0.5">
            {warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
          </ul>
        ) : (
          <p className="text-slate-400">⚠ {type.warningPlaceholder}</p>
        )}
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-bold mb-1">{num()}. {type.sections.steps.heading}</h2>
        {(steps.length ? steps : [createEmptyStep()]).map((s, i) => (
          <div key={s.id} className={i > 0 ? 'mt-3' : ''}>
            <p className="font-bold text-emerald-700">
              {type.stepPrefix} {i + 1}{s.title.trim() ? `. ${s.title.trim()}` : ''}
            </p>
            <p className="text-slate-700 whitespace-pre-wrap">{s.description.trim() || 'Опишіть дію точно й однозначно.'}</p>
            <p className="text-xs text-slate-500">{s.components.trim() || '—'} · {s.toolsResources.trim() || '—'}</p>
            {s.warning.trim() && <p className="text-xs text-amber-700">⚠ {s.warning.trim()}</p>}
            <p className="text-xs"><b>Контроль:</b> {s.successCriterion.trim() || 'Вкажіть ознаку правильного виконання.'}</p>
          </div>
        ))}
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-bold mb-1">{num()}. {type.sections.finalCheck.heading}</h2>
        {finalChecks.length ? (
          <ul className="list-disc pl-5 space-y-0.5">
            {finalChecks.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        ) : (
          <p className="text-slate-400">Результат відповідає визначеним критеріям</p>
        )}
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-bold mb-1">{num()}. {type.sections.troubleshooting.heading}</h2>
        {issues.length ? (
          <ul className="space-y-1">
            {issues.map((r) => (
              <li key={r.id}>
                <b>{r.issue || '—'}</b>
                {r.cause.trim() && <> — можлива причина: {r.cause}</>}
                {r.action.trim() && <> — дія: {r.action}</>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-400">Ситуацій поки не описано.</p>
        )}
      </section>

      <section className="mb-1">
        <h2 className="text-sm font-bold mb-1">{num()}. {type.sections.warranty.heading}</h2>
        {hasWarranty ? (
          <p className="text-slate-700">
            {doc.warranty.period.trim() && <>Термін: {doc.warranty.period.trim()}. </>}
            {doc.warranty.responsible.trim() && <>Відповідальний: {doc.warranty.responsible.trim()}. </>}
            {doc.warranty.notes.trim()}
          </p>
        ) : (
          <p className="text-slate-400">·</p>
        )}
      </section>
    </article>
  );
};

// ---------------------------------------------------------------------------
// Діалог вибору типу документа — показується при першому вході (немає
// чернетки) і за кнопкою «Нова».
// ---------------------------------------------------------------------------

const TypeDialog: React.FC<{
  onPick: (id: InstructionDocType) => void;
  onClose?: () => void;
}> = ({ onPick, onClose }) => (
  <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 backdrop-blur-sm p-4">
    <div className="glass-panel w-full max-w-lg rounded-2xl p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-emerald-400">Нова інструкція</span>
        {onClose && (
          <button type="button" onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300 transition-colors">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <h2 className="mt-2 text-xl font-bold text-slate-100">Оберіть тип документа</h2>
      <p className="mt-1 text-xs text-slate-400">Структура розділів і підказки автоматично пристосуються до вашого завдання.</p>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {INSTRUCTION_TYPES.map((type) => {
          const Icon = TYPE_ICONS[type.id];
          return (
            <button
              key={type.id}
              type="button"
              onClick={() => onPick(type.id)}
              className="flex flex-col items-start gap-1.5 rounded-xl border border-slate-700 bg-slate-950/60 p-3.5 text-left transition-colors hover:border-emerald-400/50 hover:bg-slate-900"
            >
              <Icon className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-bold text-slate-100">{type.cardTitle}</span>
              <span className="text-[11px] leading-relaxed text-slate-400">{type.cardSubtitle}</span>
            </button>
          );
        })}
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Дрібні редактори повторюваних розділів — список рядків-текстів (для
// «Інструменти» / «Безпека» / «Фінальна перевірка» тощо, які в усіх 4 типах
// мають однакову форму, лише різні підписи й плейсхолдери).
// ---------------------------------------------------------------------------

const StringListEditor: React.FC<{
  items: string[];
  placeholder: string;
  addLabel: string;
  onChange: (items: string[]) => void;
}> = ({ items, placeholder, addLabel, onChange }) => (
  <div className={cardCls + ' space-y-2'}>
    {items.map((value, i) => (
      <div key={i} className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-slate-500 w-14 shrink-0">Пункт {i + 1}</span>
        <input
          value={value}
          onChange={(e) => onChange(items.map((v, idx) => (idx === i ? e.target.value : v)))}
          placeholder={placeholder}
          className={inputCls + ' flex-1'}
        />
        <button
          type="button"
          onClick={() => onChange(items.length > 1 ? items.filter((_, idx) => idx !== i) : [''])}
          className={deleteBtnCls}
          title="Видалити пункт"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    ))}
    <button type="button" onClick={() => onChange([...items, ''])} className={addBtnCls}>
      <Plus className="h-3.5 w-3.5" /> {addLabel}
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Головний компонент.
// ---------------------------------------------------------------------------

export const InstructionBuilderView: React.FC<{
  onChangeTrack?: () => void;
  /**
   * Завжди створює НОВУ книгу (пряма відповідь власника на уточнення,
   * журнал #199) — ніколи не дописує в уже відкриту. Компонент лише формує
   * вміст (розділи книги, з поглибленнями ШІ по кроках); саму сутність Book
   * і навігацію в «Книга & Текст» будує App.tsx (onInstructionBookCreated),
   * за тим самим шаблоном, що й onCourseCreated.
   */
  onInstructionBookCreated?: (payload: InstructionBookCreationPayload) => void;
}> = ({ onChangeTrack, onInstructionBookCreated }) => {
  const [doc, setDoc] = useState<Instruction>(() => loadInstructionDraft() ?? createEmptyInstruction('assembly'));
  const [section, setSection] = useState<InstructionSectionKey>('overview');
  const [showTypeDialog, setShowTypeDialog] = useState<boolean>(() => !loadInstructionDraft());
  const [showPreview, setShowPreview] = useState(true);
  const [kbQuery, setKbQuery] = useState('');
  const [kbDraft, setKbDraft] = useState({ title: '', link: '', excerpt: '' });
  const [isCreatingBook, setIsCreatingBook] = useState(false);
  const [createBookError, setCreateBookError] = useState<string | null>(null);
  const firstRender = useRef(true);

  // Автозбереження — щоразу, коли документ змінюється. Той самий підхід, що
  // й у ExpressStartView.tsx для вибору напряму: localStorage, без сервера.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    saveInstructionDraft(doc);
  }, [doc]);

  const type = useMemo(() => findInstructionType(doc.docType), [doc.docType]);
  const readiness = useMemo(() => instructionCompleteness(doc), [doc]);

  const patch = (partial: Partial<Instruction>) => setDoc((d) => ({ ...d, ...partial, updatedAt: new Date().toISOString() }));

  const pickType = (id: InstructionDocType, resetDocument: boolean) => {
    setShowTypeDialog(false);
    if (resetDocument) {
      const fresh = createEmptyInstruction(id);
      setDoc(fresh);
      saveInstructionDraft(fresh);
    } else {
      patch({ docType: id });
    }
    setSection('overview');
  };

  const startNew = () => {
    if (doc.title.trim() || doc.description.trim() || doc.steps.some((s) => s.title.trim())) {
      const ok = window.confirm('Почати нову інструкцію? Поточний документ буде замінено (він лишиться в експорті, якщо ви його зберегли).');
      if (!ok) return;
    }
    setShowTypeDialog(true);
  };

  const addStepAndFocus = () => {
    patch({ steps: [...doc.steps, createEmptyStep()] });
    setSection('steps');
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = instructionExportFileName(doc);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const printDoc = () => window.print();

  const kbResults = kbQuery.trim()
    ? doc.knowledgeBase.filter((k) => k.title.toLowerCase().includes(kbQuery.trim().toLowerCase()))
    : doc.knowledgeBase;

  const saveKbItem = () => {
    if (!kbDraft.title.trim()) return;
    patch({
      knowledgeBase: [
        ...doc.knowledgeBase,
        { id: instructionUid('kb'), title: kbDraft.title.trim(), link: kbDraft.link.trim(), excerpt: kbDraft.excerpt.trim() },
      ],
    });
    setKbDraft({ title: '', link: '', excerpt: '' });
  };

  const searchWeb = () => {
    const q = kbQuery.trim();
    if (!q) return;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, '_blank', 'noopener,noreferrer');
  };

  /**
   * «Створити книгу» — завершення напряму «Інструкція»: ШІ поглиблює кожен
   * крок (один запит, /api/ai/elaborate-instruction-steps), результат лягає
   * в майбутню книгу як [AI-DRAFT]. Якщо ШІ недоступний (немає ключа рушія,
   * мережева помилка) — книга однаково створюється, лише без поглиблень:
   * автор не має втратити вже написаний документ через збій ШІ-кроку.
   */
  const createBook = async () => {
    setCreateBookError(null);
    setIsCreatingBook(true);
    const steps = meaningfulInstructionSteps(doc);
    let elaborations: string[] | undefined;
    if (steps.length > 0) {
      try {
        const res = await fetch('/api/ai/elaborate-instruction-steps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            docTypeLabel: type.docBadge,
            title: doc.title,
            description: doc.description,
            materials: doc.materials.filter((m) => m.name.trim()).map((m) => m.name.trim()).join(', '),
            tools: doc.tools.filter((t) => t.trim()).join(', '),
            steps: steps.map((s) => ({ title: s.title, description: s.description })),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.elaborations)) elaborations = data.elaborations;
        } else {
          const errBody = await res.json().catch(() => null);
          setCreateBookError(
            (errBody?.error as string) || 'ШІ не зміг поглибити кроки — книгу створено без цих доповнень.'
          );
        }
      } catch {
        setCreateBookError('Не вдалося з’єднатися з ШІ — книгу створено без поглиблень кроків.');
      }
    }
    const sections = buildInstructionBookSections(doc, type, elaborations);
    const title = buildInstructionBookTitle(doc, type);
    setIsCreatingBook(false);
    onInstructionBookCreated?.({ title, sections });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 print:max-w-none print:p-0">
      <header className="mb-4 flex items-start justify-between gap-3 flex-wrap print:hidden">
        <div>
          <div className="flex items-center gap-2 text-emerald-400">
            <Sparkles className="w-5 h-5" />
            <span className="font-mono text-xs font-bold tracking-widest uppercase">Конструктор інструкцій</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-slate-100">{type.docBadge}</h1>
        </div>
        {onChangeTrack && (
          <button onClick={onChangeTrack} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/[0.06]">
            <ArrowLeft className="h-3.5 w-3.5" /> До вибору напряму
          </button>
        )}
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" onClick={startNew} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.06] transition-colors">
          Нова
        </button>
        <button type="button" onClick={exportJson} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.06] transition-colors">
          <Download className="h-3.5 w-3.5" /> Експорт
        </button>
        <button type="button" onClick={printDoc} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950 transition-colors">
          <Printer className="h-3.5 w-3.5" /> Друкувати / PDF
        </button>
        {onInstructionBookCreated && (
          <button
            type="button"
            onClick={createBook}
            disabled={isCreatingBook}
            title="Перенести документ у нову книгу «Книга & Текст»; ШІ поглибить кожен крок (позначиться як AI-чернетка)."
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500 hover:bg-violet-400 disabled:opacity-60 disabled:cursor-wait px-3 py-2 text-xs font-bold text-white transition-colors"
          >
            {isCreatingBook ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
            {isCreatingBook ? 'Створюємо книгу…' : 'Створити книгу'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.06] transition-colors xl:hidden"
        >
          {showPreview ? 'Сховати прев’ю' : 'Попередній перегляд'}
        </button>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <Cloud className="h-3.5 w-3.5" /> Збережено локально
        </span>
        {createBookError && (
          <span className="w-full text-[11px] font-semibold text-amber-400">{createBookError}</span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr] xl:grid-cols-[220px_1fr_380px] print:hidden">
        <aside className="space-y-3">
          <div className={cardCls}>
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
              <span>Готовність</span>
              <span className="text-emerald-400 font-mono">{readiness}%</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${readiness}%` }} />
            </div>
          </div>
          <nav className="space-y-1">
            {INSTRUCTION_SECTION_ORDER.map((key, i) => (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                  section === key ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40' : 'text-slate-400 hover:bg-white/[0.05] border border-transparent'
                }`}
              >
                <span className="font-mono text-[10px] text-slate-600 w-4 shrink-0">{i + 1}</span>
                <span className="truncate">{type.sections[key].nav}</span>
              </button>
            ))}
          </nav>
          <button type="button" onClick={addStepAndFocus} className={addBtnCls}>
            <Plus className="h-3.5 w-3.5" /> Додати крок
          </button>
        </aside>

        <main className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-2 text-slate-200">
            <h2 className="text-sm font-bold">
              {INSTRUCTION_SECTION_ORDER.indexOf(section) + 1} / {type.docBadge}
            </h2>
          </div>
          <h3 className="text-xl font-bold text-slate-100">{type.sections[section].heading}</h3>

          {section === 'overview' && (
            <div className="space-y-4">
              <div className="grid gap-2.5 sm:grid-cols-2">
                {INSTRUCTION_TYPES.map((t) => {
                  const Icon = TYPE_ICONS[t.id];
                  const active = t.id === doc.docType;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => pickType(t.id, false)}
                      className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                        active ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-slate-700 bg-slate-950/40 hover:border-slate-600'
                      }`}
                    >
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${active ? 'text-emerald-400' : 'text-slate-500'}`} />
                      <span>
                        <span className={`block text-xs font-bold ${active ? 'text-emerald-300' : 'text-slate-200'}`}>{t.cardTitle}</span>
                        <span className="block text-[11px] text-slate-500">{t.cardSubtitle}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="pt-1 space-y-3">
                <h4 className="text-xs font-bold text-slate-300">Основна інформація</h4>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {labeled(type.nameFieldLabel, (
                    <input value={doc.title} onChange={(e) => patch({ title: e.target.value })} placeholder={type.namePlaceholder} className={inputCls} />
                  ))}
                  {labeled('Модель / код / версія', (
                    <input value={doc.modelCode} onChange={(e) => patch({ modelCode: e.target.value })} className={inputCls} />
                  ))}
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {labeled('Орієнтовний час', (
                    <input value={doc.estimatedTime} onChange={(e) => patch({ estimatedTime: e.target.value })} className={inputCls} />
                  ))}
                  {labeled('Рівень підготовки', (
                    <input value={doc.skillLevel} onChange={(e) => patch({ skillLevel: e.target.value })} className={inputCls} />
                  ))}
                </div>
                {labeled('Кількість виконавців', (
                  <input value={doc.executorsCount} onChange={(e) => patch({ executorsCount: e.target.value })} className={inputCls} />
                ))}
                {labeled(type.sections.overview.heading, (
                  <textarea
                    value={doc.description}
                    onChange={(e) => patch({ description: e.target.value })}
                    rows={4}
                    placeholder="Опишіть призначення виробу та результат складання."
                    className={areaCls}
                  />
                ))}
              </div>
            </div>
          )}

          {section === 'materials' && (
            <div className={cardCls}>
              <div className="space-y-2">
                {doc.materials.map((m, i) => (
                  <div key={m.id} className="grid grid-cols-[70px_1fr_90px_auto] gap-2 items-end">
                    {i === 0 ? labeled('Код', <input value={m.code} onChange={(e) => patch({ materials: doc.materials.map((x) => (x.id === m.id ? { ...x, code: e.target.value } : x)) })} className={inputCls} />) : (
                      <input value={m.code} onChange={(e) => patch({ materials: doc.materials.map((x) => (x.id === m.id ? { ...x, code: e.target.value } : x)) })} className={inputCls} />
                    )}
                    {i === 0 ? labeled(type.materialsColumnLabel, <input value={m.name} onChange={(e) => patch({ materials: doc.materials.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })} placeholder={type.materialsPlaceholder} className={inputCls} />) : (
                      <input value={m.name} onChange={(e) => patch({ materials: doc.materials.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })} placeholder={type.materialsPlaceholder} className={inputCls} />
                    )}
                    {i === 0 ? labeled('Кількість', <input type="number" value={m.qty} onChange={(e) => patch({ materials: doc.materials.map((x) => (x.id === m.id ? { ...x, qty: e.target.value } : x)) })} className={inputCls} />) : (
                      <input type="number" value={m.qty} onChange={(e) => patch({ materials: doc.materials.map((x) => (x.id === m.id ? { ...x, qty: e.target.value } : x)) })} className={inputCls} />
                    )}
                    <button
                      type="button"
                      onClick={() => patch({ materials: doc.materials.length > 1 ? doc.materials.filter((x) => x.id !== m.id) : doc.materials })}
                      className={deleteBtnCls}
                      title="Видалити рядок"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => patch({ materials: [...doc.materials, { id: instructionUid('mat'), code: '', name: '', qty: '1' }] })}
                className={addBtnCls + ' mt-3'}
              >
                <Plus className="h-3.5 w-3.5" /> Додати
              </button>
            </div>
          )}

          {section === 'tools' && (
            <StringListEditor items={doc.tools} placeholder={type.toolsPlaceholder} addLabel="Додати пункт" onChange={(tools) => patch({ tools })} />
          )}

          {section === 'warnings' && (
            <StringListEditor items={doc.warnings} placeholder={type.warningPlaceholder} addLabel="Додати пункт" onChange={(warnings) => patch({ warnings })} />
          )}

          {section === 'steps' && (
            <div className="space-y-3">
              {doc.steps.map((s, i) => (
                <div key={s.id} className={cardCls + ' space-y-2'}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wide text-emerald-400">{type.stepPrefix} {i + 1}</span>
                    <button
                      type="button"
                      onClick={() => patch({ steps: doc.steps.length > 1 ? doc.steps.filter((x) => x.id !== s.id) : doc.steps })}
                      className={deleteBtnCls}
                      title="Видалити крок"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {labeled('Назва дії', (
                    <input value={s.title} onChange={(e) => patch({ steps: doc.steps.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)) })} className={inputCls} />
                  ))}
                  {labeled('Що потрібно зробити', (
                    <textarea value={s.description} onChange={(e) => patch({ steps: doc.steps.map((x) => (x.id === s.id ? { ...x, description: e.target.value } : x)) })} rows={2} placeholder="Опишіть дію точно й однозначно." className={areaCls} />
                  ))}
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {labeled('Компоненти', (
                      <input value={s.components} onChange={(e) => patch({ steps: doc.steps.map((x) => (x.id === s.id ? { ...x, components: e.target.value } : x)) })} className={inputCls} />
                    ))}
                    {labeled('Інструменти / ресурси', (
                      <input value={s.toolsResources} onChange={(e) => patch({ steps: doc.steps.map((x) => (x.id === s.id ? { ...x, toolsResources: e.target.value } : x)) })} className={inputCls} />
                    ))}
                  </div>
                  {labeled('Застереження або обмеження', (
                    <input value={s.warning} onChange={(e) => patch({ steps: doc.steps.map((x) => (x.id === s.id ? { ...x, warning: e.target.value } : x)) })} className={inputCls} />
                  ))}
                  {labeled('Критерій правильного виконання', (
                    <input value={s.successCriterion} onChange={(e) => patch({ steps: doc.steps.map((x) => (x.id === s.id ? { ...x, successCriterion: e.target.value } : x)) })} placeholder="Вкажіть ознаку правильного виконання." className={inputCls} />
                  ))}
                </div>
              ))}
              <button type="button" onClick={() => patch({ steps: [...doc.steps, createEmptyStep()] })} className={addBtnCls}>
                <Plus className="h-3.5 w-3.5" /> Додати наступну дію
              </button>
            </div>
          )}

          {section === 'finalCheck' && (
            <StringListEditor items={doc.finalChecks} placeholder={type.finalCheckPlaceholder} addLabel="Додати пункт" onChange={(finalChecks) => patch({ finalChecks })} />
          )}

          {section === 'troubleshooting' && (
            <div className="space-y-3">
              {doc.troubleshooting.map((r) => (
                <div key={r.id} className={cardCls + ' space-y-2'}>
                  {labeled('Проблема або відхилення', (
                    <input value={r.issue} onChange={(e) => patch({ troubleshooting: doc.troubleshooting.map((x) => (x.id === r.id ? { ...x, issue: e.target.value } : x)) })} placeholder="Опишіть відхилення" className={inputCls} />
                  ))}
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {labeled('Можлива причина', (
                      <input value={r.cause} onChange={(e) => patch({ troubleshooting: doc.troubleshooting.map((x) => (x.id === r.id ? { ...x, cause: e.target.value } : x)) })} className={inputCls} />
                    ))}
                    {labeled('Коригувальна дія', (
                      <input value={r.action} onChange={(e) => patch({ troubleshooting: doc.troubleshooting.map((x) => (x.id === r.id ? { ...x, action: e.target.value } : x)) })} className={inputCls} />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => patch({ troubleshooting: doc.troubleshooting.length > 1 ? doc.troubleshooting.filter((x) => x.id !== r.id) : doc.troubleshooting })}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-300 hover:text-rose-200 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Видалити
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => patch({ troubleshooting: [...doc.troubleshooting, { id: instructionUid('issue'), issue: '', cause: '', action: '' }] })}
                className={addBtnCls}
              >
                <Plus className="h-3.5 w-3.5" /> Додати ситуацію
              </button>
            </div>
          )}

          {section === 'warranty' && (
            <div className={cardCls + ' space-y-2.5'}>
              {labeled('Термін / періодичність', (
                <input value={doc.warranty.period} onChange={(e) => patch({ warranty: { ...doc.warranty, period: e.target.value } })} className={inputCls} />
              ))}
              {labeled('Відповідальна особа / контакт', (
                <input value={doc.warranty.responsible} onChange={(e) => patch({ warranty: { ...doc.warranty, responsible: e.target.value } })} className={inputCls} />
              ))}
              {labeled('Додаткові відомості', (
                <textarea value={doc.warranty.notes} onChange={(e) => patch({ warranty: { ...doc.warranty, notes: e.target.value } })} rows={3} className={areaCls} />
              ))}
            </div>
          )}

          {section === 'knowledgeBase' && (
            <div className="space-y-4">
              <div className={cardCls + ' space-y-2'}>
                <h4 className="text-xs font-bold text-slate-300">Пошук в Інтернеті</h4>
                <div className="flex gap-2">
                  <input
                    value={kbQuery}
                    onChange={(e) => setKbQuery(e.target.value)}
                    placeholder="Наприклад: безпечна робота з фрезерним верстатом"
                    className={inputCls}
                  />
                  <button type="button" onClick={searchWeb} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-bold text-slate-950 shrink-0 transition-colors">
                    <Search className="h-3.5 w-3.5" /> Знайти
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">Пошук відкриється в новій вкладці. Знайдене джерело можна додати до окремої бази знань нижче.</p>
              </div>

              <div className={cardCls}>
                <h4 className="text-xs font-bold text-slate-300 mb-2">Окрема база знань</h4>
                {kbResults.length === 0 ? (
                  <p className="text-[11px] text-slate-500">База знань поки порожня.</p>
                ) : (
                  <ul className="space-y-2">
                    {kbResults.map((k) => (
                      <li key={k.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-bold text-slate-200">{k.title}</span>
                          <button
                            type="button"
                            onClick={() => patch({ knowledgeBase: doc.knowledgeBase.filter((x) => x.id !== k.id) })}
                            className={deleteBtnCls}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {k.link && (
                          <a href={k.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline">
                            {k.link} <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {k.excerpt && <p className="mt-1 text-[11px] text-slate-400">{k.excerpt}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className={cardCls + ' space-y-2.5'}>
                <h4 className="text-xs font-bold text-slate-300">Додати матеріал</h4>
                {labeled('Назва матеріалу', (
                  <input value={kbDraft.title} onChange={(e) => setKbDraft((d) => ({ ...d, title: e.target.value }))} className={inputCls} />
                ))}
                {labeled('Посилання або шлях', (
                  <input value={kbDraft.link} onChange={(e) => setKbDraft((d) => ({ ...d, link: e.target.value }))} className={inputCls} />
                ))}
                {labeled('Короткий опис / витяг', (
                  <textarea value={kbDraft.excerpt} onChange={(e) => setKbDraft((d) => ({ ...d, excerpt: e.target.value }))} rows={2} className={areaCls} />
                ))}
                <button type="button" onClick={saveKbItem} disabled={!kbDraft.title.trim()} className={addBtnCls + ' disabled:opacity-40'}>
                  <Plus className="h-3.5 w-3.5" /> Зберегти в базі знань
                </button>
              </div>
            </div>
          )}
        </main>

        {showPreview && (
          <aside className="hidden xl:block">
            <div className="sticky top-4">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                <Loader2 className="hidden" />
                Попередній перегляд
              </div>
              <div className="max-h-[80vh] overflow-y-auto rounded-2xl">
                <InstructionArticle doc={doc} type={type} />
              </div>
            </div>
          </aside>
        )}
      </div>

      {showPreview && (
        <div className="mt-4 xl:hidden print:hidden">
          <InstructionArticle doc={doc} type={type} />
        </div>
      )}

      {/* Друк: завжди в DOM, показується лише в @media print (Tailwind print:),
          незалежно від того, чи відкрита панель прев'ю на екрані. */}
      <div className="hidden print:block">
        <InstructionArticle doc={doc} type={type} />
      </div>

      {showTypeDialog && (
        <TypeDialog
          onPick={(id) => pickType(id, true)}
          onClose={loadInstructionDraft() ? () => setShowTypeDialog(false) : undefined}
        />
      )}
    </div>
  );
};
