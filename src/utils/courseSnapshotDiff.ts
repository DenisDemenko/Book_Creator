/**
 * Що змінилось у курсі ПІСЛЯ того, як його подали на модерацію.
 *
 * Адмін погоджує знімок курсу на момент подання (а не живий стан), тож
 * правки автора після подання у вітрину не потраплять, доки він не надішле
 * курс ще раз. Цей модуль каже, ЩО саме змінилось, — щоб адмін бачив: «автор
 * уже виправляє цей курс», а автор — що його правки ще не подані.
 *
 * Чиста функція без залежностей: ті самі рядки показує і сервер (у відповіді
 * деталей запису), і тест.
 */
import { GRADUATE_SELLING_LABELS, normalizeGraduateSelling } from './coursePublishRules';

export interface DiffCourse {
  title?: string;
  subtitle?: string;
  summary?: string;
  description?: string;
  audience?: string[];
  outcomes?: string[];
  highlights?: string[];
  coverUrl?: string;
  categorySlug?: string;
  category?: string;
  priceMinor?: number;
  free?: boolean;
  graduateSelling?: string;
  skills?: Array<{ name?: string }>;
  modules?: Array<{
    title?: string;
    summary?: string;
    introVideoUrl?: string;
    lessons?: Array<{ title?: string; videoUrl?: string; durationMin?: number; description?: string; goal?: string }>;
  }>;
}

const uah = (minor?: number, free?: boolean) =>
  free ? 'безкоштовно' : minor === undefined || minor === null ? 'не вказано' : `${(minor / 100).toLocaleString('uk-UA')} грн`;

const clean = (list?: string[]) => (list || []).map((s) => String(s).trim()).filter(Boolean);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function courseSnapshotChanges(snapshot: DiffCourse, current: DiffCourse): string[] {
  const out: string[] = [];

  const text: Array<[keyof DiffCourse, string]> = [
    ['title', 'Назва'],
    ['subtitle', 'Підзаголовок'],
    ['summary', 'Короткий опис'],
    ['description', 'Повний опис'],
    ['coverUrl', 'Обкладинка'],
  ];
  for (const [key, label] of text) {
    if ((snapshot[key] ?? '') !== (current[key] ?? '')) out.push(`${label} змінено.`);
  }

  if (snapshot.priceMinor !== current.priceMinor || (snapshot.free === true) !== (current.free === true)) {
    out.push(`Ціна: ${uah(snapshot.priceMinor, snapshot.free)} → ${uah(current.priceMinor, current.free)}.`);
  }
  if (normalizeGraduateSelling(snapshot.graduateSelling) !== normalizeGraduateSelling(current.graduateSelling)) {
    out.push(`Продаж робіт студентів: «${GRADUATE_SELLING_LABELS[normalizeGraduateSelling(snapshot.graduateSelling)]}» → «${GRADUATE_SELLING_LABELS[normalizeGraduateSelling(current.graduateSelling)]}».`);
  }
  if ((snapshot.categorySlug ?? '') !== (current.categorySlug ?? '')) {
    out.push(`Категорія вітрини: «${snapshot.categorySlug || 'без категорії'}» → «${current.categorySlug || 'без категорії'}».`);
  }

  const lists: Array<[keyof DiffCourse, string]> = [
    ['audience', 'Аудиторію'],
    ['outcomes', 'Результати навчання'],
    ['highlights', 'Вигоди на картку'],
  ];
  for (const [key, label] of lists) {
    if (!same(clean(snapshot[key] as string[]), clean(current[key] as string[]))) out.push(`${label} змінено.`);
  }

  const sn = (snapshot.skills || []).map((s) => s.name || '').filter(Boolean);
  const cn = (current.skills || []).map((s) => s.name || '').filter(Boolean);
  if (!same(sn, cn)) out.push(`Навички: ${sn.length} → ${cn.length}.`);

  const lessonTitles = (c: DiffCourse) =>
    (c.modules || []).flatMap((m, mi) => (m.lessons || []).map((l) => `${mi + 1}|${l.title || ''}`));
  const sLessons = lessonTitles(snapshot);
  const cLessons = lessonTitles(current);
  const sMods = (snapshot.modules || []).length;
  const cMods = (current.modules || []).length;
  if (!same(snapshot.modules, current.modules)) {
    const added = cLessons.filter((x) => !sLessons.includes(x)).map((x) => x.split('|')[1]).filter(Boolean);
    const removed = sLessons.filter((x) => !cLessons.includes(x)).map((x) => x.split('|')[1]).filter(Boolean);
    const parts = [`модулів ${sMods} → ${cMods}`, `уроків ${sLessons.length} → ${cLessons.length}`];
    if (added.length) parts.push(`додано: ${added.slice(0, 3).join(', ')}${added.length > 3 ? '…' : ''}`);
    if (removed.length) parts.push(`прибрано: ${removed.slice(0, 3).join(', ')}${removed.length > 3 ? '…' : ''}`);
    out.push(`Програма змінена (${parts.join('; ')}).`);
  }
  return out;
}
