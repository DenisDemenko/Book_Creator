/**
 * «Мої роботи» — усе, що автор створив як комплексні продукти, одним переліком для дашборда
 * (журнал #532, запит власника 09.11.2026: «блок з книгами, блок з інструкціями й блок з курсами»).
 *
 * Книги й курси мають власні переліки (`/api/books`, `/api/courses`) — дашборд бере їх звідти. Тут
 * лише те, чого окремого переліку не було:
 *  - ІНСТРУКЦІЇ: експрес-чернетки майстра «Інструкція з фото й техдокументації» (живуть 24 години) і
 *    інструкції, надіслані з телефона (GrabFusion), чия експрес-чернетка вже згасла. Остання лишається
 *    в чернетці за фото, тож «Відновити» створює свіжу експрес-чернетку з неї — інструкція з телефона
 *    не пропадає разом із добовим терміном.
 *  - ЧЕРНЕТКИ З ТЕЛЕФОНА: незавершені (ще не відправлені) чернетки за фото всіх видів.
 */

import type { Express } from 'express';
import { requireAuth } from './auth';
import { listUserDrafts as listExpressDrafts, type ExpressDraft } from './expressStore';
import { getDraft as getPhotoDraft, listDrafts as listPhotoDrafts, mutateDraft, type StoredDraft } from './external/photoDraftStore';
import { toExpressPayload } from './external/photoDraftMapping';
import { createExpressInstruction } from './external/photoDraftSinks';
import type { PhotoDraftStatus } from '../shared/photoDraftContract';
import type { MyInstruction, MyPhoneDraft, MyWorks } from '../shared/myWorks';
import { grabfusionPublicUrl } from '../shared/grabfusionPair';

export type { MyInstruction, MyPhoneDraft, MyWorks };

const IN_PROGRESS: PhotoDraftStatus[] = ['collecting', 'structured', 'written'];

function technicalOf(d: ExpressDraft): Record<string, any> | null {
  const t = d.payload.technical as Record<string, any> | undefined;
  return d.payload.track === 'technical_instruction' || t ? (t ?? {}) : null;
}

function frameCount(d: ExpressDraft): number {
  const ids = new Set<string>();
  for (const s of (d.payload.sourceMaterials ?? []) as Array<{ assetId?: string; assetIds?: string[] }>) {
    for (const id of [s.assetId, ...(s.assetIds ?? [])]) if (id) ids.add(id);
  }
  return ids.size;
}

function lessonCount(d: StoredDraft): number {
  return (d.structure?.modules ?? []).reduce((n, m) => n + m.lessons.length, 0);
}

const titleOf = (title: string | null | undefined, fallback: string) => (title ?? '').trim() || fallback;

/** Чистий збір переліку: без мережі, лише зі сховищ — тест підставляє свої дані. */
export function buildMyWorks(express: ExpressDraft[], phone: StoredDraft[], grabfusionUrl: string | null): MyWorks {
  const alive = new Map(express.map((d) => [d.id, d]));
  const phoneOf = new Map<string, string>(); // id експрес-чернетки → id чернетки за фото
  for (const p of phone) if (p.kind === 'instruction' && p.submitted?.kind === 'express') phoneOf.set(p.submitted.id, p.id);

  const instructions: MyInstruction[] = [];
  for (const d of express) {
    const t = technicalOf(d);
    if (!t) continue;
    instructions.push({
      id: d.id,
      origin: 'express',
      title: titleOf(t.title ?? t.proposal?.title, 'Інструкція без назви'),
      steps: Array.isArray(t.proposal?.steps) ? t.proposal.steps.length : 0,
      frames: frameCount(d),
      updatedAt: d.updatedAt,
      expiresAt: d.expiresAt,
      phoneDraftId: phoneOf.get(d.id) ?? null,
    });
  }
  // Надіслана з телефона, а експрес-чернетка вже згасла: лишається чернетка за фото — її можна відновити.
  for (const p of phone) {
    if (p.kind !== 'instruction' || p.status !== 'submitted' || p.submitted?.kind !== 'express') continue;
    if (alive.has(p.submitted.id) || !p.structure) continue;
    instructions.push({
      id: p.id,
      origin: 'phone',
      title: titleOf(p.title, 'Інструкція з телефона'),
      steps: lessonCount(p),
      frames: p.photos.length,
      updatedAt: p.updatedAt,
      expiresAt: null,
      phoneDraftId: p.id,
    });
  }
  instructions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const phoneDrafts: MyPhoneDraft[] = phone
    .filter((p) => IN_PROGRESS.includes(p.status))
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      title: titleOf(p.title, p.kind === 'manuscript' ? 'Набір книги' : 'Чернетка без назви'),
      status: p.status,
      photoCount: p.photos.length,
      updatedAt: p.updatedAt,
    }));
  return { instructions, phoneDrafts, grabfusionUrl };
}

// Живе в shared/grabfusionPair.ts (потрібне й видачі QR підключення); тут реекспорт для наявних імпортів і тестів.
export { grabfusionPublicUrl };

export function registerMyWorksRoutes(app: Express): void {
  app.get('/api/my-works', requireAuth, async (req, res) => {
    try {
      const userId = String(req.principal!.id);
      const phone = await listPhotoDrafts(userId);
      res.json(buildMyWorks(listExpressDrafts(userId), phone, grabfusionPublicUrl()));
    } catch (err) {
      console.error('[my-works] перелік:', err);
      res.status(500).json({ error: 'Не вдалося зібрати перелік робіт. Спробуйте ще раз.' });
    }
  });

  /**
   * Відновити інструкцію з телефона: свіжа експрес-чернетка з уже надісланої чернетки за фото. Посилання
   * «Відкрити в Studio» у GrabFusion після цього веде на нову чернетку, а не на згаслу.
   */
  app.post('/api/my-works/phone-drafts/:id/reopen-instruction', requireAuth, async (req, res) => {
    try {
      const userId = String(req.principal!.id);
      const id = String(req.params.id);
      const found = await getPhotoDraft(id, userId);
      if (!found || found.kind !== 'instruction' || !found.structure) {
        return res.status(404).json({ error: 'Інструкцію з цієї чернетки відновити не можна: вона не знайдена або ще не розкладена на кроки.' });
      }
      const changed = await mutateDraft(
        id,
        userId,
        async (d) => {
          const draftId = await createExpressInstruction(userId, toExpressPayload(d));
          if (d.submitted?.kind === 'express') d.submitted = { ...d.submitted, id: draftId, studioUrl: `/express/${draftId}` };
          return draftId;
        },
        { byTeacher: false }
      );
      if (!changed) return res.status(404).json({ error: 'Чернетку не знайдено.' });
      res.json({ draftId: changed.result });
    } catch (err) {
      console.error('[my-works] відновлення інструкції:', err);
      res.status(500).json({ error: 'Не вдалося відновити інструкцію. Спробуйте ще раз.' });
    }
  });
}
