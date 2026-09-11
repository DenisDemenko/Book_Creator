/**
 * Вкладення (фото й знімки екрана) у чаті підтримки — спільна частина для
 * обох боків розмови: віджета користувача (SupportChatWidget.tsx) і
 * розділу CRM в адмінці (AdminCrmView.tsx). Логіка однакова, тож живе в
 * одному місці, а не двома копіями, які розійдуться з часом.
 */

/** Скільки картинок можна причепити до однієї репліки (звірено з сервером). */
export const MAX_SUPPORT_ATTACHMENTS = 4;

/** Межа на одну картинку (звірено з сервером). */
export const MAX_SUPPORT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Адреса картинки вкладення. Окремий маршрут, бо /api/media/file віддає файл лише власникові. */
export function supportAttachmentUrl(assetId: string): string {
  return `/api/support/attachment/${encodeURIComponent(assetId)}`;
}

/** Файл → data:URL, у форматі, який чекає сервер. */
export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не вдалося прочитати файл.'));
    reader.readAsDataURL(file);
  });
}

/** Чи це взагалі картинка і чи влазить у межу. Повертає текст помилки або null. */
export function checkAttachment(file: File | Blob): string | null {
  if (!file.type.startsWith('image/')) return 'Прикріпити можна лише зображення.';
  if (file.size > MAX_SUPPORT_ATTACHMENT_BYTES) {
    return `Зображення завелике (максимум ${(MAX_SUPPORT_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0)} МБ).`;
  }
  return null;
}

/**
 * Дістає картинки з події вставки (Ctrl+V). Саме так потрапляє в чат
 * знімок, зроблений системними засобами (Win+Shift+S, PrintScreen) — він
 * лежить у буфері обміну як зображення, а не як файл на диску.
 */
export function imagesFromPaste(e: ClipboardEvent): File[] {
  const items = Array.from(e.clipboardData?.items || []);
  return items
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);
}

/**
 * Знімок екрана засобами браузера: показує системний вибір вікна/екрана,
 * бере ОДИН кадр і одразу глушить доріжку — запису відео тут не ведеться.
 *
 * Повертає null, якщо користувач скасував вибір вікна (це не помилка, і
 * лякати його повідомленням не треба). Кидає виняток, якщо браузер такого
 * не вміє — тоді лишається шлях через Ctrl+V.
 */
export async function captureScreenshot(): Promise<Blob | null> {
  const media = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  };
  if (!media?.getDisplayMedia) {
    throw new Error('Цей браузер не вміє робити знімок екрана. Зробіть його системними засобами і вставте сюди (Ctrl+V).');
  }

  let stream: MediaStream;
  try {
    stream = await media.getDisplayMedia({ video: true });
  } catch {
    return null; // користувач закрив вибір вікна
  }

  try {
    const track = stream.getVideoTracks()[0];
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // Один кадр: без цієї паузи перший кадр часто ще порожній (чорний).
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const settings = track.getSettings();
    const canvas = document.createElement('canvas');
    canvas.width = settings.width || video.videoWidth || 1280;
    canvas.height = settings.height || video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не вдалося підготувати полотно для знімка.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    // Доріжку глушимо завжди — інакше браузер далі показує «йде запис екрана».
    stream.getTracks().forEach((t) => t.stop());
  }
}
