import { createHash } from 'node:crypto';
import { roomGeminiImageAccess } from './aiCore';
import { platformKeyFor } from './platformKeys';
import { IMAGE_ENGINES, generateImage as generateRawImage, ImageGenerationError, listEngines, leonardoConfig, normalizeAspectRatio, seedreamConfig, seedreamTransportFor } from './imageGeneration';
import { priceForImage, SEEDREAM_FAL_EDIT_MODEL } from './pricing';
import { creditsForCostUsd } from './creditPricing';
import { editOpenAiImage, TableImageError } from './tableAiGeneration';

export const DEFAULT_CONSTRUCTOR_ENGINE = 'gpt-image';

export async function constructorImageAccess() {
  const googleModels = Object.values(IMAGE_ENGINES)
    .filter((engine) => engine.provider === 'google')
    .map((engine) => engine.modelId);
  const [openai, seedream, leonardo, google] = await Promise.all([
    platformKeyFor('gpt'), platformKeyFor('seedream'), platformKeyFor('leonardo'),
    roomGeminiImageAccess.resolve(googleModels),
  ]);
  const seedreamKey = seedream || seedreamConfig.apiKey;
  const registry = listEngines({ google: true, openai: !!openai, bytedance: !!seedreamKey, leonardo: !!leonardo || leonardoConfig.enabled });
  return { registry, google, seedream, leonardo, seedreamViaFal: seedreamTransportFor(seedreamKey) === 'fal' };
}

type ConstructorImageAccess = Awaited<ReturnType<typeof constructorImageAccess>>;

export function quoteConstructorImages(access: ConstructorImageAccess, requestedSize?: string, aspectRatio = '1:1') {
  return access.registry.map((engine) => {
    const isGptEdit = engine.id === DEFAULT_CONSTRUCTOR_ENGINE;
    const viaFal = engine.provider === 'bytedance' && access.seedreamViaFal;
    const modelId = viaFal ? SEEDREAM_FAL_EDIT_MODEL : engine.modelId;
    const imageSize = engine.maxSize === '1K' || requestedSize === '1K' ? '1K'
      : requestedSize === '4K' && engine.maxSize === '4K' ? '4K' : '2K';
    const costUsd = isGptEdit && modelId === 'gpt-image-1.5' && aspectRatio !== '1:1'
      ? 0.05 : priceForImage(engine.id, imageSize, modelId);
    return {
      ...engine, modelId, imageSize, costUsd,
      label: viaFal ? 'Seedream (через fal.ai)' : engine.label,
      available: engine.provider === 'google' ? access.google.has(modelId) : engine.available,
      supportsReferenceImages: isGptEdit || engine.supportsReferenceImages,
      maxReferenceImages: isGptEdit ? 16 : engine.maxReferenceImages,
      credits: costUsd > 0 ? creditsForCostUsd(costUsd) : 0,
      quoteHash: createHash('sha256').update(JSON.stringify({ id: engine.id, model: modelId, size: imageSize, usd: costUsd, aspectRatio })).digest('hex'),
    };
  }).filter((engine) => engine.maxReferenceImages >= 3 && engine.credits > 0);
}

export async function constructorImageQuotes(requestedSize?: string, aspectRatio?: string) {
  const access = await constructorImageAccess();
  return { ...access, editions: quoteConstructorImages(access, requestedSize, aspectRatio) };
}

export type ConstructorImageQuote = Awaited<ReturnType<typeof constructorImageQuotes>>['editions'][number];

export async function generateConstructorImage(
  quote: ConstructorImageQuote,
  access: ConstructorImageAccess,
  request: { prompt: string; references: string[]; aspectRatio: string; negativePrompt?: string },
) {
  const { prompt, references, aspectRatio, negativePrompt } = request;
  if (!quote.available || references.length < 1 || references.length > quote.maxReferenceImages)
    throw new TableImageError(`Двигун «${quote.label}» недоступний або підтримує до ${quote.maxReferenceImages} зображень.`, 409);
  const validated = references.map((reference, index) => {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(reference);
    if (!match || reference.length > 20_000_022) throw new TableImageError('Некоректний референс.', 400);
    const bytes = new Uint8Array(Buffer.from(match[2], 'base64'));
    const buffer = Buffer.from(bytes.buffer);
    const valid = match[1] === 'png' ? buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : match[1] === 'jpeg' ? buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
        : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    if (!valid) throw new TableImageError('Некоректний формат референсу.', 400);
    return { bytes, type: 'image/' + match[1], file: `reference-${index + 1}.${match[1]}` };
  });
  if (quote.id === DEFAULT_CONSTRUCTOR_ENGINE) {
    const base64 = await editOpenAiImage({
      model: quote.modelId, aspectRatio, references: validated,
      prompt: negativePrompt ? `${prompt}\n\nAvoid: ${negativePrompt}` : prompt,
    });
    const outputRatio = aspectRatio === '1:1' ? '1:1' : ['3:4', '9:16'].includes(aspectRatio) ? '2:3' : '3:2';
    return { buffer: Buffer.from(base64, 'base64'), mimeType: 'image/png', modelId: quote.modelId, aspectRatio: normalizeAspectRatio(outputRatio), engine: IMAGE_ENGINES[quote.id] };
  }
  const googleClient = access.google.get(quote.modelId);
  try {
    return await generateRawImage(googleClient ?? null, {
      prompt, engine: quote.id, imageSize: quote.imageSize, aspectRatio, negativePrompt,
      referenceImageUrls: references,
      apiKeyOverride: quote.provider === 'bytedance' ? access.seedream : access.leonardo,
    });
  } catch (error) {
    if (googleClient && error instanceof ImageGenerationError && error.kind === 'no_key')
      roomGeminiImageAccess.reject(googleClient, quote.modelId);
    throw error;
  }
}
