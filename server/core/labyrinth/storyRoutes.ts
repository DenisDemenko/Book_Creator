import type { Express, Request, Response } from "express";
import type { GroupRouteDeps } from "./groupRoutes";
import type { GroupGuard } from "./groupStore";
import type { StoredBook } from "../../bookStore";
import type { StoryBookWriter } from "./storyStore";
import { LabyrinthError } from "./model";
import { canRead } from "../collaboration/access";
import { resolveProjectAccess } from "../projectRoutes";
export interface StoryRouteDeps extends GroupRouteDeps {
  recheckAi?: (q: Request) => Promise<void>;
  generateStory?: (q: Request, input: string, signal: AbortSignal) => Promise<{ text: string; modelId: string; inputTokens?: number; outputTokens?: number; costUsd?: number }>;
  storyBooks?: { read: (id: string) => Promise<StoredBook | null>; write: StoryBookWriter; created?: (book: StoredBook, userId: string) => Promise<void> };
}
const body = (q: Request, keys: string[]) => {
  const b = q.body;
  if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).length !== keys.length || Object.keys(b).some(k => !keys.includes(k)))
    throw new LabyrinthError(422, "Некоректні поля запиту збірки.");
  return b;
};
export function registerLabyrinthStoryRoutes(app: Express, d: StoryRouteDeps) {
  const base = "/api/core/projects/:projectId/labyrinth";
  const check = async (q: Request) => {
    if (!q.principal?.id || q.principal.isGuest || (q.principal as any).disabled) throw new LabyrinthError(401, "Увійдіть у систему.");
    await d.refreshPrincipal?.(q);
    if (!q.principal?.id || q.principal.isGuest || (q.principal as any).disabled) throw new LabyrinthError(401, "Обліковий запис недоступний.");
    const a = await resolveProjectAccess(q.principal, String(q.params.projectId), d.access);
    if (!a || (!a.isOwner && a.role !== "admin")) throw new LabyrinthError(403, "Збірка доступна власнику книги або адміністратору.");
    return a;
  };
  const handle = (fn: (q: Request, r: Response, p: string, user: string, guard: GroupGuard) => Promise<void>) => async (q: Request, r: Response) => {
    r.set("Cache-Control", "no-store");
    try {
      const a = await check(q);
      if (!d.store()?.story) throw new LabyrinthError(503, "Для збірки потрібне доступне ядро PostgreSQL.");
      if (Object.keys(q.query).length) throw new LabyrinthError(422, "Некоректні параметри запиту.");
      const guard: GroupGuard = { recheck: async () => { await check(q); }, canReadUser: async id => {
        const principal = await d.groupPrincipal?.(id);
        const access = principal ? await resolveProjectAccess(principal, a.projectId, d.access) : null;
        return !!access && canRead(access.effective.book);
      } };
      await fn(q, r, a.projectId, a.userId, guard);
    } catch (e) {
      if (e instanceof LabyrinthError) { r.status(e.status).json({ error: e.message }); return; }
      if (["40001", "40P01", "23505"].includes((e as any)?.code)) { r.status(409).json({ error: "Збірку вже змінили. Оновіть стан." }); return; }
      console.error("[labyrinth-story] request failed", { code: (e as any)?.code ?? "internal" });
      r.status(500).json({ error: "Не вдалося виконати збірку. Повторіть той самий запит або оновіть стан." });
    }
  };
  app.get(base + "/maps/:mapId/story-drafts", handle(async (q, r, p, _u, g) => {
    r.json(await d.store()!.story.list(p, String(q.params.mapId), g));
  }));
  app.post(base + "/runs/:runId/story-drafts", handle(async (q, r, p, u, g) => {
    const b = body(q, ["expectedRunRevision", "title", "key"]);
    r.status(201).json(await d.store()!.story.create(p, String(q.params.runId), b.expectedRunRevision, b.title, u, b.key, g));
  }));
  app.get(base + "/story-drafts/:draftId", handle(async (q, r, p, _u, g) => {
    r.json(await d.store()!.story.get(p, String(q.params.draftId), g));
  }));
  app.post(base + "/story-drafts/:draftId/edit", handle(async (q, r, p, u, g) => {
    const b = body(q, ["expectedRevision", "title", "edits", "key"]);
    r.json(await d.store()!.story.edit(p, String(q.params.draftId), b.expectedRevision, b.title, b.edits, u, b.key, g));
  }));
  app.post(base + "/story-drafts/:draftId/rewrite", handle(async (q, r, p, u, g) => {
    const b = body(q, ["expectedRevision", "confirmAi", "key"]);
    if (b.confirmAi !== true) throw new LabyrinthError(422, "Підтвердьте окремий запит літературної редакції ШІ.");
    if (!d.generateStory || !d.recheckAi) throw new LabyrinthError(503, "ШІ для літературної редакції недоступний. Можна працювати вручну.");
    const recheck = async () => { await g.recheck(); await d.recheckAi!(q); };
    r.json(await d.store()!.story.rewrite(p, String(q.params.draftId), b.expectedRevision, u, b.key, g, recheck,
      (input, signal) => d.generateStory!(q, input, signal)));
  }));
  app.post(base + "/story-drafts/:draftId/reject", handle(async (q, r, p, u, g) => {
    const b = body(q, ["expectedRevision", "key"]);
    r.json(await d.store()!.story.reject(p, String(q.params.draftId), b.expectedRevision, u, b.key, g));
  }));
  app.post(base + "/story-drafts/:draftId/accept", handle(async (q, r, p, u, g) => {
    const b = body(q, ["expectedRevision", "confirm", "causalityReviewed", "key"]);
    if (b.confirm !== true || b.causalityReviewed !== true) throw new LabyrinthError(422, "Перевірте джерела й причинність та підтвердьте створення нової чернетки книги.");
    if (!d.storyBooks) throw new LabyrinthError(503, "Сховище книг недоступне.");
    const draft = await d.store()!.story.accept(p, String(q.params.draftId), b.expectedRevision, u, b.key, g, d.storyBooks.write, d.storyBooks.read);
    if (draft.newBookId && d.storyBooks.created) {
      const book = await d.storyBooks.read(draft.newBookId);
      if (book) void d.storyBooks.created(book, u).catch(() => {});
    }
    r.json(draft);
  }));
  app.get(base + "/story-drafts/:draftId/book", handle(async (q, r, p, u, g) => {
    const draft = await d.store()!.story.get(p, String(q.params.draftId), g);
    if (!draft.newBookId || !d.storyBooks) throw new LabyrinthError(404, "Нову книгу ще не створено.");
    const book = await d.storyBooks.read(draft.newBookId);
    if (!book || (book.ownerId !== u && q.principal?.role !== "admin")) throw new LabyrinthError(404, "Книгу не знайдено.");
    await g.recheck(); r.json(book);
  }));
}
