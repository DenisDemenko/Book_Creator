/**
 * Прив'язка «модуль ядра AI → модель, якою він виконується».
 *
 * Досі кожен модуль ішов на ту модель, яку прислав клієнт, а без неї — на
 * зашитий GEMINI_MODEL. Коли з'ясувалось, що доступність провайдерів
 * змінюється (Gemini періодично перевантажений, у частині середовищ до
 * нього взагалі немає мережі), стало потрібно керувати цим із адмінпанелі:
 * власник платформи обирає, ЯКА модель виконує кожну функцію, і зміна діє
 * одразу, без передеплою.
 *
 * Порядок пріоритетів свідомо такий:
 *   1) модель, явно прислана в запиті (вибір автора в панелі редактора);
 *   2) адмінська прив'язка для цього модуля;
 *   3) серверний дефолт викликача.
 * Тобто адмін задає поведінку «за замовчуванням», але не відбирає в автора
 * право вибрати іншу модель для СВОЄЇ книги.
 */

import { getAppSetting, setAppSetting } from './store';
import { CORE_MODULE_KEYS, type CoreModuleKey } from './coreAiRegistry';

/** Ключ у таблиці `meta`, під яким лежить уся мапа прив'язок. */
export const CORE_MODULE_MODELS_META_KEY = 'core_module_models';

export type CoreModuleModelMap = Partial<Record<CoreModuleKey, string>>;

function isCoreModuleKey(value: unknown): value is CoreModuleKey {
  return typeof value === 'string' && (CORE_MODULE_KEYS as readonly string[]).includes(value);
}

/** Читає мапу, мовчки ігноруючи зіпсовані записи — крива мапа не має валити всі AI-виклики. */
export async function readCoreModuleModels(): Promise<CoreModuleModelMap> {
  const raw = await getAppSetting(CORE_MODULE_MODELS_META_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: CoreModuleModelMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isCoreModuleKey(key) && typeof value === 'string' && value.trim()) {
        out[key] = value.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Порожній/відсутній modelId — це «прибрати прив'язку», а не «зберегти порожнечу». */
export async function setCoreModuleModel(module: CoreModuleKey, modelId: string | null): Promise<CoreModuleModelMap> {
  const current = await readCoreModuleModels();
  const next: CoreModuleModelMap = { ...current };
  const trimmed = (modelId || '').trim();
  if (trimmed) next[module] = trimmed;
  else delete next[module];
  await setAppSetting(CORE_MODULE_MODELS_META_KEY, JSON.stringify(next));
  return next;
}

/**
 * Єдина точка, якою маршрути з'ясовують модель. `requested` — те, що
 * прислав клієнт; порожнє значення означає «хай вирішує адмін».
 */
export async function resolveModuleModelId(
  module: CoreModuleKey,
  requested?: string | null
): Promise<string | undefined> {
  const explicit = (requested || '').trim();
  if (explicit) return explicit;
  const map = await readCoreModuleModels();
  return map[module];
}
