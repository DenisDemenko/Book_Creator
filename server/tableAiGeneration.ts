import { platformKeyFor } from './platformKeys';

export class TableImageError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

/** Only the Studio administrator's encrypted GPT key is accepted.
 * Never fall back to a caller key, environment variable or marketplace setting.
 */
export async function generateTableImage(input: { prompt?: unknown; referenceImage?: unknown; model?: unknown; interiorImages?: unknown; refinementImage?: unknown }) {
  const { prompt, referenceImage, model } = input;
  if (typeof prompt !== 'string' || !prompt.length || prompt.length > 32000 ||
      typeof referenceImage !== 'string' || referenceImage.length > 500000 ||
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(referenceImage) ||
      typeof model !== 'string' || !/^gpt-image-[a-zA-Z0-9.-]+$/.test(model))
    throw new TableImageError('Некоректні параметри візуалізації.', 400);
  const image = Buffer.from(referenceImage.split(',')[1], 'base64');
  if (!image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    throw new TableImageError('Некоректний PNG-ескіз.', 400);
  const roomImages = input.interiorImages ?? [];
  if (!Array.isArray(roomImages) || roomImages.length > 10)
    throw new TableImageError('Можна завантажити не більше 10 фото інтер’єру.', 400);
  const rooms: Uint8Array[] = roomImages.map(value => {
    if (typeof value !== 'string' || value.length > 250000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value))
      throw new TableImageError('Некоректне фото інтер’єру.', 400);
    const bytes = Buffer.from(value.split(',')[1], 'base64');
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
      throw new TableImageError('Некоректний JPEG інтер’єру.', 400);
    return new Uint8Array(bytes);
  });
  let refinement: Uint8Array | undefined;
  if (input.refinementImage !== undefined) {
    const value = input.refinementImage;
    if (typeof value !== 'string' || value.length > 20000022 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value))
      throw new TableImageError('Некоректний попередній результат.', 400);
    const bytes = Buffer.from(value.split(',')[1], 'base64');
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
      throw new TableImageError('Некоректний PNG попереднього результату.', 400);
    refinement = new Uint8Array(bytes);
  }
  const apiKey = await platformKeyFor('gpt');
  if (!apiKey) throw new TableImageError('Адміністратор має додати ключ OpenAI (GPT) у розділі «Ключі API» Студії книг.');
  const form = new FormData();
  form.set('model', model);
  form.set('prompt', prompt);
  form.set('image[]', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'tabletop.png');
  rooms.forEach((room, index) => form.append('image[]', new Blob([room], { type: 'image/jpeg' }), `room-${index + 1}.jpg`));
  if (refinement) form.append('image[]', new Blob([refinement], { type: 'image/png' }), 'previous-result.png');
  form.set('size', '1024x1024');
  form.set('quality', 'medium');
  form.set('n', '1');
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${apiKey}` },
      body: form, signal: AbortSignal.timeout(150000),
    });
  } catch { throw new TableImageError('OpenAI не відповів вчасно. Спробуйте пізніше.', 502); }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new TableImageError('Адміністратору потрібно перевірити ключ OpenAI та доступ до моделі в адмінпанелі Студії книг.');
    if (response.status === 429) throw new TableImageError('Ліміт або баланс OpenAI вичерпано. Спробуйте пізніше.');
    throw new TableImageError('Не вдалося згенерувати зображення. Спробуйте пізніше.', 502);
  }
  try {
    const payload = await response.json() as { data?: { b64_json?: string }[] };
    const result = payload.data?.[0]?.b64_json;
    if (!result || result.length > 20000000 || !/^[A-Za-z0-9+/=]+$/.test(result)) throw new Error();
    return { image: `data:image/png;base64,${result}` };
  } catch { throw new TableImageError('OpenAI повернув некоректне зображення.', 502); }
}
