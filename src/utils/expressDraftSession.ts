/** Serialized wizard writes. A failed save rejects every dependent action. */
export interface WizardDraft<P> { userId?: string | null; id: string; revision: number; step: number; payload: P }
export class WizardApiError<P = unknown> extends Error {
  constructor(message: string, public status: number, public draft?: WizardDraft<P>) { super(message); }
}
export async function wizardApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...init,
  });
  let body: any;
  try { body = JSON.parse(await response.text()); }
  catch { throw new WizardApiError('Сервер повернув некоректну відповідь.', response.status); }
  if (!response.ok) throw new WizardApiError(body?.error || ('Помилка ' + response.status), response.status, body?.draft);
  return body as T;
}
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
interface Backup<P> { draft: WizardDraft<P>; payload: P }
export interface DraftView<P> {
  draft: WizardDraft<P> | null; payload: P; step: number; dirty: boolean;
  pending: boolean; error: string | null; conflict: WizardDraft<P> | null;
}

interface RuntimeHeroArc {
  selectedHeroId?: string;
  answers?: Record<string, string>;
  intensities?: number[];
  analysis?: { status?: string; heroId?: string; [key: string]: unknown };
  [key: string]: unknown;
}
interface RuntimeWizardPayload {
  heroArc?: RuntimeHeroArc;
  cast?: Array<{ id?: string; firstName?: string; lastName?: string }>;
  seed?: string;
  genre?: string;
  framework?: string;
  synopsis?: string;
  compositionPlan?: string;
  parts?: unknown[];
  storyWorld?: unknown;
  reviewConfirmed?: boolean;
  structureConfirmed?: boolean;
  [key: string]: unknown;
}

export const EXPRESS_DRAFT_VIEW_EVENT = 'nova:express-draft-view';
export interface ExpressDraftViewEventDetail {
  draftId?: string;
  revision?: number;
  userId?: string | null;
  cast: Array<{ id: string; firstName: string; lastName: string }>;
}

const HERO_ARC_CANON_KEYS = [
  'cast', 'seed', 'genre', 'framework', 'synopsis', 'compositionPlan', 'parts', 'storyWorld',
] as const;

function runtimePayload(value: unknown): RuntimeWizardPayload {
  return (value && typeof value === 'object' ? value : {}) as RuntimeWizardPayload;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class WizardDraftSession<P extends object> {
  view: DraftView<P>;
  private tail: Promise<unknown> = Promise.resolve();
  private version = 0;
  private listeners = new Set<() => void>();
  constructor(initial: P, private api: Api = wizardApi, private storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    this.view = { draft: null, payload: initial, step: 1, dirty: false, pending: false, error: null, conflict: null };
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emitHeroArcView() {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    const payload = runtimePayload(this.view.payload);
    const cast = Array.isArray(payload.cast)
      ? payload.cast
          .filter((member) => typeof member?.id === 'string' && member.id.trim())
          .map((member) => ({
            id: member.id!.trim(),
            firstName: typeof member.firstName === 'string' ? member.firstName : '',
            lastName: typeof member.lastName === 'string' ? member.lastName : '',
          }))
      : [];
    const detail: ExpressDraftViewEventDetail = {
      draftId: this.view.draft?.id,
      revision: this.view.draft?.revision,
      userId: this.view.draft?.userId,
      cast,
    };
    window.dispatchEvent(new CustomEvent<ExpressDraftViewEventDetail>(EXPRESS_DRAFT_VIEW_EVENT, { detail }));
  }
  private publish(patch: Partial<DraftView<P>>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
    this.emitHeroArcView();
  }
  private key(id: string) { return 'nova_express_backup:' + id; }
  private backup() {
    const { draft, payload, dirty } = this.view;
    if (!draft) return;
    try {
      if (dirty) this.storage?.setItem(this.key(draft.id), JSON.stringify({ draft, payload }));
      else this.storage?.removeItem(this.key(draft.id));
    } catch {
      this.publish({ error: 'Браузер не дозволив створити локальну копію. Збережіть правки перед закриттям сторінки.' });
    }
  }
  recover(id: string): boolean {
    try {
      const saved = JSON.parse(this.storage?.getItem(this.key(id)) || 'null') as Backup<P> | null;
      if (!saved || saved.draft.id !== id || !Number.isSafeInteger(saved.draft.revision)) return false;
      this.publish({ draft: saved.draft, payload: saved.payload, step: saved.draft.step, dirty: true });
      return true;
    } catch { return false; }
  }
  open(draft: WizardDraft<P>) {
    if (this.view.draft?.id === draft.id && draft.revision < this.view.draft.revision) return;
    if (this.view.draft?.id === draft.id && this.view.dirty) {
      if (this.view.draft.revision !== draft.revision) {
        this.publish({ conflict: draft, error: 'Серверна чернетка вже змінилася. Вашу локальну копію збережено для порівняння.' });
      }
      return;
    }
    this.publish({ draft, payload: draft.payload, step: draft.step, dirty: false, conflict: null, error: null });
  }
  edit(patch: Partial<P>) {
    this.version++;
    const current = runtimePayload(this.view.payload);
    const incoming = runtimePayload(patch);
    let payload = { ...this.view.payload, ...patch } as P;

    // Any change to confirmed story canon invalidates the previous semantic curve.
    // HeroArcPanel handles its own answer/override changes, so an explicit heroArc
    // patch is left intact here.
    if (!hasOwn(incoming, 'heroArc') && current.heroArc?.analysis && HERO_ARC_CANON_KEYS.some((key) => hasOwn(incoming, key))) {
      let heroArc: RuntimeHeroArc = {
        ...current.heroArc,
        analysis: { ...current.heroArc.analysis, status: 'stale' },
      };
      if (hasOwn(incoming, 'cast') && heroArc.selectedHeroId) {
        const nextCast = Array.isArray(incoming.cast) ? incoming.cast : [];
        if (!nextCast.some((member) => member?.id === heroArc.selectedHeroId)) {
          heroArc = { ...heroArc, selectedHeroId: undefined };
        }
      }
      payload = { ...(payload as object), heroArc } as P;
    }

    this.publish({ payload, dirty: true, error: this.view.conflict ? this.view.error : null });
    this.backup();
  }
  /** Explicit UI choice; never merge an old tab over the current server revision. */
  useServer() {
    const current = this.view.conflict;
    if (!current) return;
    this.publish({ dirty: false });
    this.open(current);
    this.backup();
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      this.publish({ pending: true, error: null });
      try { return await work(); }
      catch (error) {
        const conflict = error instanceof WizardApiError && error.status === 409 ? error.draft as WizardDraft<P> : undefined;
        this.publish({ error: (error as Error).message, ...(conflict ? { conflict } : {}) });
        this.backup();
        throw error;
      } finally { this.publish({ pending: false }); }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async save(step = this.view.step): Promise<WizardDraft<P> | null> {
    const { draft, conflict, dirty, payload } = this.view;
    if (conflict) throw new WizardApiError('Спочатку порівняйте локальну та серверну чернетки.', 409, conflict);
    if (!draft) return null;
    if (!dirty && step === draft.step) return draft;
    const version = this.version;
    const body = JSON.stringify({ expectedRevision: draft.revision, payload, step });
    // Browsers reject keepalive bodies above 64 KiB even while the page is open.
    const saved = await this.api<WizardDraft<P>>('/api/express/draft/' + draft.id, {
      method: 'PATCH', keepalive: new TextEncoder().encode(body).byteLength <= 60 * 1024, body,
    });
    this.publish({
      draft: saved, step,
      ...(version === this.version ? { payload: saved.payload, dirty: false } : {}),
    });
    this.backup();
    return saved;
  }
  flush(step?: number) { return this.enqueue(() => this.saveLatest(step)); }
  private async maybeAnalyzeHeroArc(saved: WizardDraft<P>): Promise<WizardDraft<P>> {
    const payload = runtimePayload(saved.payload);
    const heroArc = payload.heroArc;
    const heroId = heroArc?.selectedHeroId?.trim();
    const ready = Boolean(
      saved.userId &&
      payload.framework === 'hero_journey' &&
      heroId &&
      typeof payload.synopsis === 'string' && payload.synopsis.trim() &&
      Array.isArray(payload.parts) && payload.parts.length >= 3 &&
      payload.reviewConfirmed === true &&
      payload.structureConfirmed === true
    );
    if (!ready || !heroId) return saved;
    if (heroArc?.analysis?.status === 'fresh' && heroArc.analysis.heroId === heroId) return saved;

    const version = this.version;
    try {
      const result = await this.api<{ draft: WizardDraft<P> }>('/api/express/hero-arc/analyze', {
        method: 'POST',
        body: JSON.stringify({ draftId: saved.id, expectedRevision: saved.revision, heroId }),
      });
      this.publish({ draft: result.draft });
      if (version === this.version) {
        this.publish({ payload: result.draft.payload, step: result.draft.step, dirty: false });
      }
      this.backup();
      return result.draft;
    } catch (error) {
      // Saving the author's canon succeeded. JEV is an enhancement and must not
      // turn a valid save into a failed wizard step when its provider is unavailable.
      console.warn('[hero-arc] automatic JEV analysis failed:', error);
      return saved;
    }
  }
  private async saveLatest(step?: number): Promise<WizardDraft<P> | null> {
    let result = await this.save(step);
    for (let attempt = 0; this.view.dirty && attempt < 8; attempt++) result = await this.save(step);
    if (this.view.dirty) throw new Error('Дочекайтеся завершення редагування і повторіть збереження.');
    if (result) result = await this.maybeAnalyzeHeroArc(result);
    return result;
  }
  /** Both flush and AI request occupy the same queue, so autosave cannot race them. */
  generate<T extends { draft: WizardDraft<P> }>(path: string, data: object): Promise<T> {
    return this.enqueue(async () => {
      await this.saveLatest();
      let draft = this.view.draft;
      if (!draft) throw new Error('Спочатку створіть чернетку.');
      // Generation requires login. Protect a draft started as a guest before sending private context.
      if (draft.userId === null) {
        const claimed = await this.api<WizardDraft<P>>('/api/express/claim', {
          method: 'POST', body: JSON.stringify({ draftId: draft.id, expectedRevision: draft.revision }),
        });
        this.publish({ draft: claimed });
        await this.saveLatest();
        draft = this.view.draft!;
      }
      const version = this.version;
      const result = await this.api<T>(path, {
        method: 'POST', body: JSON.stringify({ ...data, draftId: draft.id, expectedRevision: draft.revision }),
      });
      this.publish({ draft: result.draft });
      if (version === this.version) {
        this.publish({ payload: result.draft.payload, step: result.draft.step, dirty: false });
      }
      this.backup();
      return result;
    });
  }
}
