/**
 * Каталог «скільки балів коштує одна генерація» — для адмін-панелі й звітів.
 * Рахується тією ж creditsForCostUsd(), що й живе списання (creditGate.ts),
 * тож таблиця в панелі завжди збігається з тим, що реально знімається.
 */

import { IMAGE_PRICING, VIDEO_PRICING, priceForVideo } from './pricing';
import { VIDEO_ENGINES, engineModelId, type VideoEngineInfo } from './videoGeneration';
import { creditsForCostUsd } from './creditPricing';

export interface ImageCostRow {
  key: string;
  label: string;
  size: string;
  costUsd: number;
  credits: number;
}

export interface VideoCostRow {
  engineId: string;
  label: string;
  resolution: string;
  /** Тривалість, за якої пораховано (типова). null — фіксована ціна за кліп. */
  durationSec: number | null;
  costUsd: number;
  credits: number;
  /** Бали за секунду; null для моделей із фіксованою ціною за кліп. */
  creditsPerSecond: number | null;
  minDurationSec: number | null;
  maxDurationSec: number | null;
}

export function imageCostTable(): ImageCostRow[] {
  const rows: ImageCostRow[] = [];
  for (const [key, table] of Object.entries(IMAGE_PRICING)) {
    for (const [size, usd] of Object.entries(table.perImageUsd)) {
      if (!(usd > 0)) continue;
      rows.push({ key, label: table.label, size, costUsd: usd, credits: creditsForCostUsd(usd) });
    }
  }
  return rows.sort((a, b) => a.credits - b.credits);
}

function durationBounds(e: VideoEngineInfo): { min: number | null; max: number | null; def: number | null } {
  if (e.apiVersion === 'v1') {
    const list = e.durationsSec;
    return list ? { min: Math.min(...list), max: Math.max(...list), def: e.defaultDurationSec } : { min: null, max: null, def: null };
  }
  return { min: e.durationMinSec, max: e.durationMaxSec, def: e.defaultDurationSec };
}

export function videoCostTable(): VideoCostRow[] {
  const rows: VideoCostRow[] = [];
  for (const engine of Object.values(VIDEO_ENGINES)) {
    const modelId = engineModelId(engine);
    const { min, max, def } = durationBounds(engine);
    for (const resolution of engine.resolutions) {
      const costUsd = priceForVideo(engine.id, modelId, resolution, def);
      if (!(costUsd > 0)) continue;
      const credits = creditsForCostUsd(costUsd);
      const flat = VIDEO_PRICING[modelId]?.flatUsd !== undefined || VIDEO_PRICING[engine.id]?.flatUsd !== undefined;
      const perSecUsd = !flat && def ? priceForVideo(engine.id, modelId, resolution, 1) : 0;
      rows.push({
        engineId: engine.id,
        label: engine.label,
        resolution,
        durationSec: def,
        costUsd,
        credits,
        creditsPerSecond: perSecUsd > 0 ? creditsForCostUsd(perSecUsd) : null,
        minDurationSec: min,
        maxDurationSec: max,
      });
    }
  }
  return rows.sort((a, b) => a.credits - b.credits);
}
