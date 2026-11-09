/**
 * «Мої роботи» на дашборді: типи відповіді `GET /api/my-works` (server/myWorksRoutes.ts) — спільні для сервера
 * і клієнта. Книги й курси мають власні переліки (`/api/books`, `/api/courses`), тут лише те, чого окремого
 * переліку не було: інструкції та чернетки з телефона.
 */

export type MyWorkPhoneKind = 'course' | 'instruction' | 'book' | 'manuscript';
export type MyWorkPhoneStatus = 'collecting' | 'structured' | 'written' | 'submitted' | 'discarded';

export interface MyInstruction {
  /** Для `express` — id експрес-чернетки; для `phone` — id чернетки за фото. */
  id: string;
  origin: 'express' | 'phone';
  title: string;
  steps: number;
  frames: number;
  updatedAt: string;
  /** Коли згасне експрес-чернетка; для `phone` — немає (вона вже згасла, чернетка за фото лишилась). */
  expiresAt: string | null;
  /** Чернетка за фото, з якої створено інструкцію (якщо вона з телефона). */
  phoneDraftId: string | null;
}

export interface MyPhoneDraft {
  id: string;
  kind: MyWorkPhoneKind;
  title: string;
  status: MyWorkPhoneStatus;
  photoCount: number;
  updatedAt: string;
}

export interface MyWorks {
  instructions: MyInstruction[];
  phoneDrafts: MyPhoneDraft[];
  /** Де відкрити GrabFusion (змінна `GRABFUSION_PUBLIC_URL`); немає — посилання не показуємо. */
  grabfusionUrl: string | null;
}

/** Курс у переліку дашборда: лише те, що потрібно для рядка списку. */
export interface MyCourseBrief {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  modules: number;
  /** Створено з телефона (чернетка за фото). */
  fromPhone: boolean;
  /** Чужий курс, відкритий для співавторства. */
  shared: boolean;
}
