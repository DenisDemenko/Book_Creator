import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Cpu, Loader2, Lock, RefreshCw, ScanText, Trash2, X } from 'lucide-react';
import {
  PrivateStoreError,
  deletePrivateDoc,
  deleteScanPage,
  editScanDraft,
  fetchScanEngines,
  getPrivateAsset,
  getPrivateDoc,
  putPrivateDoc,
  recognizeScanPage,
  saveScanPageText,
  setActivePrivateMaterial,
  type PrivateStoreInfo,
  type ScanDraft,
  type ScanEngine,
  type ScanEngines,
  type ScanPage,
} from '../utils/privateStore';
import { structureLocally, type LocalStructureResult } from '../../shared/localScanStructure';
import { buildPrivateBook, buildPrivateCourse, buildPrivateInstruction } from '../utils/localScanBuild';

/**
 * «Вхідні з телефона» (журнал #550): чернетка зі знімків, що телефон передав на ваш сервер запечатаними. Тут автор перевіряє
 * розпізнаний текст, за потреби розпізнає знову іншим рушієм і створює з чернетки приватний курс, інструкцію чи книгу.
 * Усе відбувається між цим браузером і локальним сервером: у хмару (Studio, ШІ) нічого не йде.
 */

const QUALITY_LABEL: Record<string, { text: string; tone: string }> = {
  good: { text: 'добре', tone: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' },
  fair: { text: 'середньо', tone: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
  poor: { text: 'погано', tone: 'text-rose-300 border-rose-500/40 bg-rose-500/10' },
  unknown: { text: 'оцінки немає', tone: 'text-slate-300 border-slate-600 bg-slate-800' },
};
const KIND_LABEL: Record<ScanDraft['kind'], string> = { course: 'Курс', instruction: 'Інструкція', manuscript: 'Книга' };
const ENGINE_LABEL: Record<ScanEngine, string> = { tesseract: 'Tesseract', ollama: 'Ollama' };

const newId = (prefix: string): string => {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${random}`;
};

export function PrivateScanReview({
  store,
  docId,
  onClose,
  onCreated,
}: {
  store: PrivateStoreInfo;
  docId: string;
  onClose: () => void;
  /** Матеріал створено на сервері: відкрити його у своєму розділі. */
  onCreated: (kind: 'book' | 'course' | 'instruction', id: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<ScanDraft | null>(null);
  const [engines, setEngines] = useState<ScanEngines | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const imageUrls = useRef<Record<string, string>>({});

  // Поки чернетка відкрита, охоронець не пускає в хмару запити зі вмістом.
  useEffect(() => {
    setActivePrivateMaterial('scan', docId);
    return () => setActivePrivateMaterial('scan', null);
  }, [docId]);

  const load = useCallback(
    async (initial = false) => {
      try {
        const doc = await getPrivateDoc(store.id, docId);
        const payload = doc.payload as unknown as ScanDraft;
        setDraft(payload);
        setTexts((prev) => {
          const next = { ...prev };
          for (const p of payload.pages) if (!dirtyRef.current.has(p.pageId) || next[p.pageId] === undefined) next[p.pageId] = p.ocr.text ?? '';
          return next;
        });
        if (initial) setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не вдалося відкрити чернетку.');
      } finally {
        setLoading(false);
      }
    },
    [store.id, docId]
  );

  useEffect(() => {
    void load(true);
    void fetchScanEngines(store.id).then(setEngines).catch(() => setEngines(null));
  }, [load, store.id]);

  // Пока хоч одна сторінка розпізнається, оновлюємо чернетку.
  const working = !!draft && draft.pages.some((p) => p.ocr.status === 'queued' || p.ocr.status === 'running');
  useEffect(() => {
    if (!working) return undefined;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [working, load]);

  // Мініатюри: зображення читаються прямо з сервера й живуть лише в памʼяті цієї вкладки.
  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    for (const page of draft.pages) {
      if (imageUrls.current[page.assetId]) continue;
      void getPrivateAsset(store.id, page.assetId)
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          imageUrls.current[page.assetId] = url;
          setImages((prev) => ({ ...prev, [page.assetId]: url }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [draft, store.id]);
  useEffect(
    () => () => {
      for (const url of Object.values(imageUrls.current)) URL.revokeObjectURL(url);
      imageUrls.current = {};
    },
    []
  );

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof PrivateStoreError || err instanceof Error ? err.message : 'Не вдалося виконати дію.');
    } finally {
      setBusy(null);
    }
  };

  const saveText = (page: ScanPage) =>
    run(`save:${page.pageId}`, async () => {
      if (!dirty.has(page.pageId)) return;
      await saveScanPageText(store.id, docId, page.pageId, texts[page.pageId] ?? '');
      setDirty((d) => {
        const next = new Set(d);
        next.delete(page.pageId);
        return next;
      });
      await load();
    });

  const recognize = (page: ScanPage, engine: ScanEngine) =>
    run(`ocr:${page.pageId}`, async () => {
      if (dirty.has(page.pageId) && !window.confirm('Ви правили текст цієї сторінки вручну. Нове розпізнавання замінить його. Продовжити?')) return;
      await recognizeScanPage(store.id, docId, page.pageId, engine);
      setDirty((d) => {
        const next = new Set(d);
        next.delete(page.pageId);
        return next;
      });
      await load();
    });

  const removePage = (page: ScanPage) =>
    run(`del:${page.pageId}`, async () => {
      if (!window.confirm('Видалити цю сторінку разом зі знімком із локального сервера? Відновити буде неможливо.')) return;
      await deleteScanPage(store.id, docId, page.pageId);
      await load();
    });

  const edit = (patch: Parameters<typeof editScanDraft>[2]) =>
    run('edit', async () => {
      await editScanDraft(store.id, docId, patch);
      await load();
    });

  const structure: LocalStructureResult | null = useMemo(() => {
    if (!draft) return null;
    return structureLocally({
      kind: draft.kind,
      title: draft.title || (draft.kind === 'manuscript' ? draft.newBookTitle : ''),
      instructionMode: draft.instructionMode ?? null,
      modelCode: draft.modelCode,
      pages: draft.pages.map((p) => ({ order: p.order, text: texts[p.pageId] ?? p.ocr.text ?? '' })),
    });
  }, [draft, texts]);

  const create = () =>
    run('create', async () => {
      if (!draft || !structure) return;
      const flush = draft.pages.filter((p) => dirty.has(p.pageId));
      for (const p of flush) await saveScanPageText(store.id, docId, p.pageId, texts[p.pageId] ?? '');
      const now = new Date();
      const title = (value: string) => (value || 'Без назви').slice(0, 200);
      let kind: 'book' | 'course' | 'instruction';
      let id: string;
      if (draft.kind === 'course' && structure.course) {
        kind = 'course';
        id = newId('crs');
        const course = buildPrivateCourse(structure.course, { storeId: store.id, id, now });
        await putPrivateDoc(store.id, {
          id,
          kind,
          meta: { title: title(course.title), status: course.status, modules: course.modules.length, lessons: course.modules.reduce((n, m) => n + m.lessons.length, 0), updatedAt: course.updatedAt },
          payload: course as unknown as Record<string, unknown>,
        });
      } else if (draft.kind === 'instruction' && structure.instruction) {
        kind = 'instruction';
        id = newId('ins');
        const ins = buildPrivateInstruction(structure.instruction, { storeId: store.id, docId: id, now, mode: draft.instructionMode ?? null });
        await putPrivateDoc(store.id, {
          id,
          kind,
          meta: { title: title(ins.title), docType: ins.docType, steps: ins.steps.filter((s) => s.title.trim()).length, updatedAt: ins.updatedAt },
          payload: ins as unknown as Record<string, unknown>,
        });
      } else if (draft.kind === 'manuscript' && structure.book) {
        kind = 'book';
        const book = buildPrivateBook(structure.book, { storeId: store.id, author: '', now });
        id = book.id;
        await putPrivateDoc(store.id, {
          id,
          kind,
          meta: { title: title(book.title), status: book.status, chapters: book.chapters.length, updatedAt: now.toISOString() },
          payload: book as unknown as Record<string, unknown>,
        });
      } else {
        throw new Error('Спершу розпізнайте сторінки: тексту для створення матеріалу немає.');
      }
      await editScanDraft(store.id, docId, { consumed: { kind, id } });
      await onCreated(kind, id);
    });

  const removeDraft = () =>
    run('drop', async () => {
      if (!window.confirm('Видалити чернетку разом із усіма знімками з локального сервера? Відновити буде неможливо.')) return;
      await deletePrivateDoc(store.id, docId);
      onClose();
    });

  const ollama = engines?.ollama;
  const anyPoor = !!draft && draft.pages.some((p) => p.ocr.status === 'done' && p.ocr.engine === 'tesseract' && (p.ocr.quality === 'poor' || p.ocr.quality === 'fair'));
  const done = draft ? draft.pages.filter((p) => p.ocr.status === 'done').length : 0;

  return (
    <div data-private-scan-review className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm overflow-y-auto p-3 sm:p-6" role="dialog" aria-modal="true">
      <div className="mx-auto max-w-4xl rounded-2xl border border-emerald-500/30 bg-slate-900 p-4 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-emerald-300 mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-slate-100">Чернетка з телефона</h2>
            <p className="text-xs text-slate-400">
              Знімки лежать лише на вашому сервері «{store.name}» і розпізнаються на ньому. У хмару (Studio, ШІ) нічого не йде.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400" aria-label="Закрити">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <p role="alert" className="text-xs text-rose-200 rounded-lg bg-rose-500/10 border border-rose-500/30 p-2.5" data-scan-error>
            {error}
          </p>
        )}
        {loading && (
          <p className="text-xs text-slate-400 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Відкриваю чернетку на локальному сервері…
          </p>
        )}

        {draft && (
          <>
            <div className="grid sm:grid-cols-3 gap-2">
              <label className="text-[11px] text-slate-400 sm:col-span-2">
                Назва
                <input
                  defaultValue={draft.title || (draft.kind === 'manuscript' ? draft.newBookTitle : '') || ''}
                  onBlur={(e) => e.target.value.trim() !== (draft.title || '') && void edit({ title: e.target.value.trim() })}
                  placeholder="Назва матеріалу"
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-slate-100"
                />
              </label>
              <label className="text-[11px] text-slate-400">
                Створити
                <select
                  value={draft.kind}
                  onChange={(e) => void edit({ kind: e.target.value as ScanDraft['kind'] })}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-slate-100"
                  data-scan-kind
                >
                  {(Object.keys(KIND_LABEL) as ScanDraft['kind'][]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {draft.consumed && (
              <p className="text-xs text-emerald-200 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2.5">
                З цієї чернетки вже створено матеріал ({draft.consumed.kind === 'course' ? 'курс' : draft.consumed.kind === 'instruction' ? 'інструкцію' : 'книгу'}). Можна створити ще один, а чернетку видалити, коли вона не потрібна.
              </p>
            )}

            <div className="rounded-xl border border-slate-700/70 bg-slate-950/50 p-3 text-xs space-y-1.5" data-scan-engines>
              <div className="flex items-center gap-2 text-slate-300">
                <ScanText className="w-4 h-4 text-emerald-300" /> <b>Рушії розпізнавання на вашому комп&apos;ютері</b>
              </div>
              <div className="text-slate-400">
                Tesseract:{' '}
                {engines ? (engines.tesseract.available ? <span className="text-emerald-300">готовий (укр. + англ.)</span> : <span className="text-amber-300">недоступний{engines.tesseract.reason ? `: ${engines.tesseract.reason}` : ''}</span>) : '…'}
              </div>
              <div className="text-slate-400 flex items-start gap-1.5">
                <Cpu className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Ollama (модель зору на цьому ж комп&apos;ютері):{' '}
                  {!ollama ? '…' : ollama.available ? (
                    <span className="text-emerald-300">підключено{ollama.modelReady ? `, модель ${ollama.model}` : `, але моделі ${ollama.model} немає: виконайте ollama pull ${ollama.model}`}</span>
                  ) : ollama.configured ? (
                    <span className="text-amber-300">не відповідає{ollama.reason ? `: ${ollama.reason}` : ''}</span>
                  ) : (
                    <span className="text-slate-500">не підключено</span>
                  )}
                </span>
              </div>
            </div>

            {anyPoor && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100 space-y-1.5" data-scan-poor-hint>
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4" /> Tesseract розпізнав частину сторінок слабко
                </div>
                <p>Так буває, коли фото кривувате, з тінню чи світловідблиском, або текст рукописний. Спробуйте розпізнати ці сторінки моделлю Ollama — вона працює на вашому комп&apos;ютері й теж нічого не відправляє в інтернет.</p>
                {!ollama?.available && (
                  <ol className="list-decimal ml-5 space-y-0.5 text-amber-200/90">
                    <li>Встановіть Ollama (ollama.com) на цей комп&apos;ютер і виконайте <code>ollama pull {ollama?.model || 'qwen2.5vl:7b'}</code>.</li>
                    <li>У файлі <code>.env</code> локального сервера задайте <code>OLLAMA_URL=http://host.docker.internal:11434</code>.</li>
                    <li>Перезапустіть сервер: <code>docker compose up -d</code>, потім натисніть «Оновити» тут.</li>
                  </ol>
                )}
              </div>
            )}

            <div className="space-y-3">
              {draft.pages.map((page, index) => {
                const ocr = page.ocr;
                const quality = QUALITY_LABEL[ocr.quality ?? 'unknown'];
                const running = ocr.status === 'queued' || ocr.status === 'running';
                return (
                  <div key={page.pageId} data-scan-page={page.pageId} className="rounded-xl border border-slate-700/70 bg-slate-950/40 p-3 grid sm:grid-cols-[150px_1fr] gap-3">
                    <div>
                      {images[page.assetId] ? (
                        <img src={images[page.assetId]} alt={`Сторінка ${index + 1}`} className="w-full rounded-lg border border-slate-700 bg-slate-900" />
                      ) : (
                        <div className="h-24 rounded-lg bg-slate-800 grid place-items-center text-slate-500">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      )}
                      <div className="mt-1 text-[11px] text-slate-500">
                        Сторінка {index + 1} · {Math.round(page.bytes / 1024)} КБ
                      </div>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {running ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-slate-600 text-slate-300" data-ocr-status="running">
                            <Loader2 className="w-3 h-3 animate-spin" /> розпізнаю{ocr.engine ? ` (${ENGINE_LABEL[ocr.engine]})` : ''}…
                          </span>
                        ) : ocr.status === 'failed' ? (
                          <span className="px-2 py-0.5 rounded-full border border-rose-500/40 text-rose-300 bg-rose-500/10" data-ocr-status="failed">
                            не вдалося: {ocr.error || 'помилка'}
                          </span>
                        ) : ocr.status === 'done' ? (
                          <>
                            <span className={`px-2 py-0.5 rounded-full border ${quality.tone}`} data-ocr-quality={ocr.quality}>
                              якість: {quality.text}
                              {typeof ocr.confidence === 'number' ? ` (${ocr.confidence}%)` : ''}
                            </span>
                            {ocr.engine && <span className="px-2 py-0.5 rounded-full border border-slate-600 text-slate-300">{ENGINE_LABEL[ocr.engine]}{ocr.model ? ` · ${ocr.model}` : ''}</span>}
                            {page.textEdited && <span className="px-2 py-0.5 rounded-full border border-sky-500/40 text-sky-200 bg-sky-500/10">виправлено вручну</span>}
                          </>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full border border-slate-600 text-slate-400">ще не розпізнано</span>
                        )}
                        {page.note && <span className="text-slate-500">примітка: {page.note}</span>}
                      </div>
                      <textarea
                        value={texts[page.pageId] ?? ''}
                        onChange={(e) => {
                          setTexts((t) => ({ ...t, [page.pageId]: e.target.value }));
                          setDirty((d) => new Set(d).add(page.pageId));
                        }}
                        onBlur={() => void saveText(page)}
                        rows={6}
                        placeholder={running ? 'Текст зʼявиться після розпізнавання…' : 'Розпізнаного тексту немає'}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-slate-100 font-mono leading-relaxed"
                      />
                      {ocr.uncertain && ocr.uncertain.length > 0 && ocr.status === 'done' && (
                        <p className="text-[11px] text-amber-200/90" data-uncertain-words>
                          Сумнівні слова: {ocr.uncertain.slice(0, 14).join(', ')}
                          {ocr.uncertain.length > 14 ? '…' : ''} — перевірте їх за знімком.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" disabled={running || busy !== null || !engines?.tesseract.available} onClick={() => void recognize(page, 'tesseract')} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40" data-ocr-run="tesseract">
                          Розпізнати Tesseract
                        </button>
                        <button
                          type="button"
                          disabled={running || busy !== null || !ollama?.available}
                          onClick={() => void recognize(page, 'ollama')}
                          title={ollama?.available ? 'Розпізнати моделлю зору Ollama на цьому компʼютері' : 'Ollama не підключено — див. підказку вище'}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600/80 hover:bg-emerald-500 text-white disabled:opacity-40"
                          data-ocr-run="ollama"
                        >
                          Розпізнати Ollama
                        </button>
                        <button type="button" disabled={busy !== null} onClick={() => void removePage(page)} className="ml-auto p-1.5 rounded-lg hover:bg-rose-900/40 text-slate-500 hover:text-rose-300" title="Видалити сторінку з локального сервера">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {draft.pages.length === 0 && <p className="text-xs text-slate-500">У чернетці немає сторінок.</p>}
            </div>

            {structure && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1.5" data-scan-structure>
                <div className="font-semibold text-emerald-100">Що вийде без ШІ, за правилами ({KIND_LABEL[draft.kind].toLowerCase()})</div>
                <p className="text-slate-300">
                  {structure.course && (
                    <>
                      Модулів: {structure.course.modules.length}, уроків: {structure.course.modules.reduce((n, m) => n + m.lessons.length, 0)}
                      {structure.course.outcomes.length ? `, результатів навчання: ${structure.course.outcomes.length}` : ''}.
                    </>
                  )}
                  {structure.instruction && (
                    <>
                      Кроків: {structure.instruction.steps.length}, деталей у комплектації: {structure.instruction.materials.length}, застережень: {structure.instruction.warnings.length}.
                    </>
                  )}
                  {structure.book && (
                    <>
                      Розділів: {structure.book.chapters.length}, секцій: {structure.book.chapters.reduce((n, c) => n + c.sections.length, 0)}.
                    </>
                  )}
                  {!structure.course && !structure.instruction && !structure.book && 'Спершу розпізнайте хоча б одну сторінку.'}
                </p>
                {structure.notes.map((n) => (
                  <p key={n} className="text-amber-200/90">{n}</p>
                ))}
                <p className="text-slate-500">Це чернетка: правила не вигадують тексту, але можуть помилитись у заголовках. Все можна виправити в редакторі.</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy !== null || done === 0 || working}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:opacity-40 flex items-center gap-1.5"
                data-scan-create
              >
                {busy === 'create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Створити приватн{draft.kind === 'manuscript' ? 'у книгу' : draft.kind === 'course' ? 'ий курс' : 'у інструкцію'}
              </button>
              <button type="button" onClick={() => void load()} className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Оновити
              </button>
              <button type="button" onClick={() => void removeDraft()} disabled={busy !== null} className="ml-auto px-3 py-2 rounded-xl text-xs font-semibold text-rose-300 hover:bg-rose-900/30">
                Видалити чернетку
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
