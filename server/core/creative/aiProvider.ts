/** Provider boundary: private references travel as inline bytes, never public Studio URLs. */
import { GoogleGenAI } from "@google/genai";
import {
  generateImage,
  IMAGE_ENGINES,
  listEngines,
} from "../../imageGeneration";
import {
  generateVideo,
  VIDEO_ENGINES,
  listVideoEngines,
  engineModelId,
} from "../../videoGeneration";
import { platformKeyFor } from "../../platformKeys";
import { logImageUsage, logVideoUsage } from "../../aiCore";
import type { CreativeAiModel } from "../../../shared/creativeAi";
import type { CreativeProviderInput, CreativeProviderResult } from "./ai";
async function keys() {
  return {
    google: (await platformKeyFor("gemini")) || process.env.GEMINI_API_KEY,
    bytedance:
      (await platformKeyFor("seedream")) ||
      process.env.ARK_API_KEY ||
      process.env.SEEDREAM_API_KEY ||
      process.env.FAL_KEY,
    openai: (await platformKeyFor("gpt")) || process.env.OPENAI_API_KEY,
    leonardo:
      (await platformKeyFor("leonardo")) || process.env.LEONARDO_API_KEY,
  };
}
export async function creativeAiModels(): Promise<CreativeAiModel[]> {
  const k = await keys();
  return [
    ...listEngines({
      google: !!k.google,
      bytedance: !!k.bytedance,
      openai: !!k.openai,
      leonardo: !!k.leonardo,
    }).map((e) => ({
      id: e.id,
      label: e.label,
      kind: "image" as const,
      provider: e.provider,
      available: e.available,
      maxReferences: e.provider === "openai" ? 0 : e.maxReferenceImages,
      edit: e.provider !== "openai" && e.supportsReferenceImages,
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      sizes:
        e.maxSize === "1K"
          ? ["1K"]
          : ["1K", "2K", ...(e.maxSize === "4K" ? ["4K"] : [])],
      durations: [],
    })),
    ...listVideoEngines({ leonardo: !!k.leonardo }).map((e) => ({
      id: e.id,
      label: e.label,
      kind: "video" as const,
      provider: e.provider,
      available: e.available,
      maxReferences: e.supportsEndFrame ? 2 : 1,
      edit: true,
      aspectRatios: [...e.aspectRatios],
      sizes: [...e.resolutions],
      durations: e.durationsSec
        ? [...e.durationsSec]
        : Array.from(
            { length: (e.durationMaxSec ?? 10) - (e.durationMinSec ?? 5) + 1 },
            (_, i) => (e.durationMinSec ?? 5) + i,
          ),
    })),
  ];
}
export async function generateCreativeMedia(
  p: CreativeProviderInput,
): Promise<CreativeProviderResult> {
  const k = await keys(),
    video = p.operation.includes(":video:"),
    ctx = { req: p.req, label: "Creative Workspace AI", bookId: p.bookId };
  if (video) {
    const e = VIDEO_ENGINES[p.model as keyof typeof VIDEO_ENGINES];
    try {
      const v = await generateVideo({
        prompt: p.prompt,
        engine: e.id,
        resolution: p.settings.size,
        aspectRatio: p.settings.aspectRatio,
        durationSec: p.settings.duration,
        apiKeyOverride: k.leonardo,
        startFrameImageUrl: p.references[0],
        endFrameImageUrl: p.references[1],
      });
      await logVideoUsage(
        ctx,
        e.id,
        v.modelId,
        v.resolution,
        v.durationSec,
        true,
      );
      return {
        bytes: v.buffer,
        mimeType: v.mimeType,
        provider: e.provider,
        model: v.modelId,
        settings: {
          resolution: v.resolution,
          aspectRatio: v.aspectRatio,
          ...(v.durationSec !== null ? { duration: v.durationSec } : {}),
        },
      };
    } catch (err) {
      await logVideoUsage(
        ctx,
        e.id,
        engineModelId(e),
        p.settings.size,
        p.settings.duration ?? null,
        false,
      );
      throw err;
    }
  }
  const e = IMAGE_ENGINES[p.model as keyof typeof IMAGE_ENGINES];
  try {
    const v = await generateImage(
      k.google ? new GoogleGenAI({ apiKey: k.google }) : null,
      {
        prompt: p.prompt,
        engine: e.id,
        aspectRatio: p.settings.aspectRatio,
        imageSize: p.settings.size,
        referenceImageUrls: p.references.length ? p.references : undefined,
        apiKeyOverride: k[e.provider],
      },
    );
    await logImageUsage(ctx, e.id, v.modelId, p.settings.size, true);
    return {
      bytes: v.buffer,
      mimeType: v.mimeType,
      provider: e.provider,
      model: v.modelId,
      settings: { imageSize: p.settings.size, aspectRatio: v.aspectRatio },
    };
  } catch (err) {
    await logImageUsage(ctx, e.id, e.modelId, p.settings.size, false);
    throw err;
  }
}
