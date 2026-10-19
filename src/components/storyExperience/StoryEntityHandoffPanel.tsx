import React, { useMemo, useState } from 'react';
import { BookOpen, Check, ChevronRight, X } from 'lucide-react';
import type { Book } from '../../types';
import type { ScreenplaySelectedSceneContext } from './ScreenplayWorkspaceView';
import type {
  StoryHandoffKind, StoryHandoffRequest, StoryHandoffTag, StoryHandoffTarget,
} from '../../utils/storyEntityHandoff';
import { buildEntityTag, stripEntityTags } from '../../utils/coreEntities';
import { StoryEntityTagPicker } from './StoryEntityTagPicker';

export interface StoryEntityHandoffPanelProps {
  book: Book;
  mode: StoryHandoffKind;
  scene?: ScreenplaySelectedSceneContext | null;
  onClose: () => void;
  onSave: (request: StoryHandoffRequest) => Promise<void>;
}

export const StoryEntityHandoffPanel: React.FC<StoryEntityHandoffPanelProps> = ({
  book, mode, scene, onClose, onSave,
}) => {
  const [text, setText] = useState('');
  const [placement, setPlacement] = useState<StoryHandoffTarget['placement']>('existing');
  const [chapterId, setChapterId] = useState(scene?.chapterId || book.chapters[0]?.id || '');
  const chapters = book.chapters;
  const chapter = chapters.find(item => item.id === chapterId);
  const [sectionId, setSectionId] = useState(scene?.sectionId || chapter?.sections[0]?.id || '');
  const section = chapter?.sections.find(item => item.id === sectionId);
  const [newTitle, setNewTitle] = useState('');
  const [tags, setTags] = useState<StoryHandoffTag[]>([]);
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const suggestions = useMemo<StoryHandoffTag[]>(() => scene ? [
    { slug: 'scene', value: scene.title },
    ...(scene.location ? [{ slug: 'location', value: scene.location }] : []),
    ...(scene.conflict ? [{ slug: 'conflict', value: scene.conflict }] : []),
  ].filter(tag => !!tag.value.trim().length && tag.value.length <= 250) : [], [scene]);

  const changed = () => { setReview(false); setConfirmed(false); setError(''); };
  const canProceed = mode === 'screenplay' && !!scene
    && !!stripEntityTags(text).trim()
    && (placement === 'new-chapter' || !!chapter)
    && (placement !== 'existing' || !!section)
    && (placement === 'existing' || !!newTitle.trim());
  const previewTags = tags.map(tag => buildEntityTag(tag.slug, tag.value)).join(' ');
  const target = (): StoryHandoffTarget => placement === 'new-chapter'
    ? { placement, title: newTitle.trim() }
    : placement === 'new-section'
      ? { placement, chapterId, title: newTitle.trim() }
      : { placement, chapterId, sectionId };

  const save = async () => {
    if (!canProceed || !review || !confirmed || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave({
        source: { kind: mode, sourceId: scene!.sceneId, title: scene!.title },
        text: stripEntityTags(text).trim(), target: target(), tags,
        expectedRevision: book.revisionNumber,
        expectedUpdatedAt: book.updatedAt,
      });
      setSuccess(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Не вдалося зберегти матеріал книги.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/70 p-0 sm:items-center sm:p-5"
    role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="story-handoff-title"
      className="flex max-h-[95dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-[#F4ECE1] text-[#2C1A12] shadow-2xl sm:max-h-[92dvh] sm:rounded-3xl">
      <header className="flex items-start justify-between gap-3 border-b border-[#E0D4C7] bg-[#FFFCF8] px-4 py-4 sm:px-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#92633C]">Story & Experience · Семантичне перенесення</p>
          <h2 id="story-handoff-title" className="mt-1 text-xl font-bold">Додати до книги · Сутності</h2>
          <p className="mt-1 text-xs text-[#71645A]">Книга: {book.title} · {mode}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрити вікно" className="rounded-xl border border-[#D9CABC] p-2"><X className="h-5 w-5"/></button>
      </header>
      {mode !== 'screenplay' ? <div className="space-y-3 overflow-y-auto p-5 sm:p-7">
        <p className="font-semibold">Експорт із {mode} потребує підтвердженого джерела.</p>
        <p className="text-sm leading-7">Щоб не перенести приватні дані учасників у текст або теги книги, використайте спочатку «Завершити сесію» → «Перетворити сесію на матеріал книги» або «Історія сесій» → «Використати у книзі». Система перевіряє дозволи, погоджений текст і згоди учасників.</p>
        <p className="rounded-xl border border-[#DEC9AB] bg-white p-3 text-xs leading-6">Підключення спільної семантичної панелі до серверного export цієї сесії перебуває в розробці. Ручне введення тегів тут не обходить правила конфіденційності.</p>
        <button type="button" onClick={onClose} className="rounded-xl bg-[#2E1B12] px-4 py-2 text-sm font-semibold text-white">Повернутися до сесії</button>
      </div> : !scene ? <div className="space-y-3 p-6">
        <p role="alert" className="text-sm">Спочатку виберіть сцену в Screenplay, щоб указати джерело нового тексту.</p>
        <button onClick={onClose} className="rounded-lg border p-2 text-sm">Повернутися до сцен</button>
      </div> : <div className="min-h-0 space-y-5 overflow-y-auto p-4 sm:p-6">
        {!success ? <>
          <div className="rounded-xl border border-[#D9CABC] bg-white px-4 py-3 text-xs leading-6">
            <strong>Джерело:</strong> {scene.title}. Кнопка «Відкрити у Книга & Текст» не змінюється.
            Тут можна внести <strong>новий авторський текст</strong>, а не продублювати наявну сцену.
            {scene.summary && <button type="button" onClick={() => { setText(scene.summary); changed(); }}
              className="mt-2 block font-semibold text-[#825029] underline underline-offset-4">Використати опис сцени як чернетку</button>}
          </div>
          <label className="block text-xs font-semibold">Текст для перенесення
            <textarea rows={6} maxLength={100000} value={text} onChange={event => { setText(event.target.value); changed(); }}
              placeholder="Напишіть нову сцену, фрагмент розповіді або чернетку..."
              className="mt-2 w-full rounded-xl border border-[#CDBBAA] bg-white p-3 text-sm leading-7" />
          </label>
          <fieldset className="space-y-3">
            <legend className="text-sm font-bold">Куди вставити текст?</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                ['existing', 'У наявну секцію'], ['new-section', 'Нова секція'], ['new-chapter', 'Нова глава'],
              ] as const).map(([value, title]) => <label key={value} className="flex gap-2 rounded-xl border border-[#D9CABC] bg-white p-3 text-xs">
                <input type="radio" name="story-handoff-target" checked={placement === value}
                  onChange={() => { setPlacement(value); changed(); }} />{title}</label>)}
            </div>
            {placement !== 'new-chapter' && <label className="block text-xs font-semibold">Глава
              <select value={chapterId} onChange={event => { setChapterId(event.target.value); setSectionId(book.chapters.find(c => c.id === event.target.value)?.sections[0]?.id || ''); changed(); }}
                className="mt-1 w-full rounded-lg border border-[#CDBBAA] bg-white p-2 text-sm">
                {chapters.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>}
            {placement === 'existing' && <label className="block text-xs font-semibold">Секція (текст буде додано в кінці)
              <select value={sectionId} onChange={event => { setSectionId(event.target.value); changed(); }}
                className="mt-1 w-full rounded-lg border border-[#CDBBAA] bg-white p-2 text-sm">
                {chapter?.sections.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>}
            {placement !== 'existing' && <label className="block text-xs font-semibold">Назва нової {placement === 'new-chapter' ? 'глави' : 'секції'}
              <input value={newTitle} maxLength={180} onChange={event => { setNewTitle(event.target.value); changed(); }}
                className="mt-1 w-full rounded-lg border border-[#CDBBAA] bg-white p-2 text-sm" />
            </label>}
          </fieldset>
          <div className="border-t border-[#D9CABC] pt-4">
            <StoryEntityTagPicker value={tags} suggestions={suggestions} onChange={next => { setTags(next); changed(); }}/>
          </div>
          {!review && <button type="button" disabled={!canProceed} onClick={() => { setReview(true); setConfirmed(false); }}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-[#2E1B12] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">Переглянути перед збереженням <ChevronRight className="h-4 w-4"/></button>}
          {review && <div className="space-y-3 rounded-2xl border border-[#CDB69B] bg-white p-4" aria-label="Попередній перегляд">
            <h3 className="font-semibold">Попередній перегляд і підтвердження</h3>
            <p className="text-xs text-[#71645A]">Куди: {placement === 'new-chapter' ? newTitle : chapter?.title} {placement === 'existing' ? '→ ' + section?.title : placement === 'new-section' ? '→ ' + newTitle : ''}</p>
            <div className="rounded-lg bg-[#F4ECE1] p-3 text-xs">
              <p className="mb-2 font-bold">У редакторі (службові теги)</p>
              <p className="whitespace-pre-wrap break-words">{previewTags}</p>
              <p className="mt-3 whitespace-pre-wrap break-words">{text}</p>
            </div>
            <div className="rounded-lg border border-[#E0D4C7] p-3 text-xs">
              <p className="mb-2 font-bold">У друкованій книзі (без тегів)</p>
              <p className="whitespace-pre-wrap break-words">{stripEntityTags(text)}</p>
            </div>
            <label className="flex items-start gap-2 text-xs leading-6">
              <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
              Я перевірив текст, місце вставлення та всі {tags.length} тегів. Підтверджую їх запис до книги.
            </label>
            {error && <p role="alert" className="text-xs text-[#A63A2B]">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setReview(false); setConfirmed(false); }} className="rounded-lg border border-[#CDBBAA] px-4 py-2 text-xs font-semibold">Редагувати</button>
              <button type="button" disabled={!confirmed || saving} onClick={() => void save()}
                className="flex min-h-10 items-center gap-2 rounded-lg bg-[#2E1B12] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
                {saving ? 'Збереження…' : 'Підтвердити й зберегти'} <BookOpen className="h-4 w-4" />
              </button>
            </div>
          </div>}
        </> : <div role="status" className="space-y-3 rounded-xl border border-[#A5C1A4] bg-white p-4">
          <Check className="h-6 w-6 text-[#37643B]"/>
          <p className="font-semibold">Текст та підтверджені теги передано в локальне сховище книги.</p>
          <p className="text-xs">Відкривається відповідна секція в «Книга & Текст». Перевірте статус синхронізації між пристроями.</p>
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Закрити</button>
        </div>}
      </div>}
    </section>
  </div>;
};
