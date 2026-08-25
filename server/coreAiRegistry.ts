/**
 * Реєстр «Ядро AI» — третя вкладка конструктора промтів, виключно для
 * адміна (server/promptTemplates.ts лишається окремим файлом і далі
 * обслуговує лише письменницький конструктор «Аналіз фото→текст», з двома
 * шарами — автор+адмін; тут шар лише ОДИН, адмінський, бо решта модулів
 * ядра не мають сенсу персоналізувати на кожного автора).
 *
 * Сім модулів, кожен — рівно ОДИН шаблон `{system, user}` (не варіанти
 * '1'/'2'/'3', як у фото-модуля): жоден з них не має числового виміру на
 * кшталт «кількість абзаців».
 *
 * Ця частина файлу — ЛИШЕ сховище/зведення шарів. Побудова фінального
 * тексту (підстановка значень у плейсхолдери) лишається в чистому файлі
 * кожного модуля (server/chatPrompt.ts, server/textFromImagePrompt.ts…) —
 * реєстр не знає, ЯК рендерити, лише ЩО зберігати.
 */

import { factoryChatSystemTemplate, renderChatSystemTemplate } from './chatPrompt';
import {
  factoryTextFromImageTemplate,
  textFromImageSystemInstruction,
  renderTextFromImageTemplate,
} from './textFromImagePrompt';
import {
  factoryClaudeManuscriptSystemTemplate,
  factoryClaudeManuscriptUserTemplate,
  renderClaudeManuscriptUserTemplate,
} from './claudeManuscriptPrompt';
import {
  factoryIllustrationPromptCraftSystemTemplate,
  factoryIllustrationPromptCraftUserTemplate,
  renderIllustrationPromptCraftSystemTemplate,
  renderIllustrationPromptCraftUserTemplate,
} from './illustrationPromptCraft';
import {
  factoryCharacterPromptCraftSystemTemplate,
  factoryCharacterPromptCraftUserTemplate,
  renderCharacterPromptCraftUserTemplate,
} from './characterPromptCraft';
import {
  factoryCharacterBioSystemTemplate,
  factoryCharacterBioUserTemplate,
  renderCharacterBioSystemTemplate,
  renderCharacterBioUserTemplate,
} from './characterBioPrompt';
import {
  synopsisToChapterSystemInstruction,
  factorySynopsisToChapterTemplate,
  renderSynopsisToChapterTemplate,
} from './synopsisToChapterPrompt';

/** Ключ у таблиці `meta`, під яким лежить ЄДИНИЙ адмінський шар усіх 7 модулів ядра. */
export const CORE_PROMPT_TEMPLATES_META_KEY = 'prompt_templates_core_admin';

/** Та сама стеля, що й у письменницького конструктора — промпт оплачується токенами. */
export const CORE_MAX_TEMPLATE_CHARS = 8000;

export const CORE_MODULE_KEYS = [
  'chat',
  'textFromImage',
  'kdp',
  'illustrationPromptCraft',
  'characterPromptCraft',
  'characterBioPrompt',
  'synopsisToChapter',
] as const;

export type CoreModuleKey = (typeof CORE_MODULE_KEYS)[number];

export interface CorePromptTemplate {
  system: string;
  user: string;
}

/** Адмінський шар — по одному шаблону на модуль, будь-який може бути відсутнім (адмін ще не чіпав). */
export type CorePromptTemplateBundle = Partial<Record<CoreModuleKey, CorePromptTemplate>>;

/** Плейсхолдери, які підставляє кожен модуль — для чипів «вставити» й попередження «жодної підстановки». */
export const CORE_MODULE_PLACEHOLDERS: Record<CoreModuleKey, string[]> = {
  chat: ['{МОВА_МОДЕЛІ}', '{СТИЛЬ}', '{НАЗВА_КНИГИ}', '{ЖАНР}', '{СИНОПСИС}'],
  textFromImage: ['{НАЗВА_КНИГИ}', '{ЖАНР}', '{РОЗДІЛ}', '{ПІДКАЗКА}'],
  kdp: ['{НАЗВА_КНИГИ}', '{АВТОР}', '{ЖАНР}', '{РУКОПИС}'],
  illustrationPromptCraft: [
    '{МОДЕЛЬ}',
    '{НАЗВА_КНИГИ}',
    '{РОЗДІЛ}',
    '{ЖАНР}',
    '{СТИЛЬ_ПРЕСЕТ}',
    '{СПІВВІДНОШЕННЯ}',
    '{VISUAL_BIBLE}',
    '{ТЕКСТ}',
  ],
  characterPromptCraft: [
    '{МОДЕЛЬ}',
    '{ІМ_Я}',
    '{ПРІЗВИЩЕ}',
    '{РОЛЬ}',
    '{ПРОФЕСІЯ}',
    '{ЗОВНІШНІСТЬ}',
    '{ПСИХОЛОГІЯ}',
    '{ЖАНР}',
    '{СТИЛЬ_ПРЕСЕТ}',
  ],
  characterBioPrompt: ['{ЖАНР}', '{РОЛЬ}', '{ОПИС}'],
  synopsisToChapter: ['{НАЗВА_КНИГИ}', '{ЖАНР}', '{РОЗДІЛ}', '{СТИЛЬ}', '{СИНОПСИС}', '{ОБСЯГ}'],
};

/** Чи модуль повертає JSON за жорсткою схемою (схема — readonly-текст у конструкторі, не редагується). */
export const CORE_MODULE_HAS_JSON_SCHEMA: Record<CoreModuleKey, boolean> = {
  chat: false,
  textFromImage: false,
  kdp: true,
  illustrationPromptCraft: true,
  characterPromptCraft: true,
  characterBioPrompt: true,
  synopsisToChapter: false,
};

/**
 * Чат — єдиний модуль, де редагується ЛИШЕ системна інструкція (Q10
 * grilling-сесії): «user»-половина — це протокол `buildPromptContext`
 * (формат «Автор:/Асистент:», ковзне вікно історії), не текст-інструкція,
 * і ламати його редагуванням небезпечно — результат розбирає МОДЕЛЬ, не
 * читає людина. Конструктор показує цю пояснювальну заглушку в полі
 * «user» як readonly замість текстового редактора.
 */
export const CHAT_USER_FIELD_PLACEHOLDER =
  '(автоматично — історія розмови й нова репліка автора, server/chatPrompt.ts::buildPromptContext. Не редагується.)';

/**
 * Маркер, з якого починається жорсткий контракт JSON-відповіді (однаковий
 * текст у всіх чотирьох модулів із JSON-схемою). Q2/Q9 grilling-сесії:
 * схема лишається жорсткою в коді, але ВИДИМА в конструкторі (не
 * прихована поза екраном) — адмін бачить повну картину того, що піде в
 * модель, редагує лише текст ДО маркера.
 */
const JSON_SCHEMA_MARKER = '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ';

/** Розділяє текст на редаговану частину й жорстку схему (readonly у конструкторі). Використовується і сервером (resolveCoreTemplate), і GET-роутом для відображення. */
export function splitAtSchemaMarker(text: string): { editable: string; schema: string } {
  const idx = text.indexOf(JSON_SCHEMA_MARKER);
  if (idx === -1) return { editable: text.trim(), schema: '' };
  return { editable: text.slice(0, idx).trim(), schema: text.slice(idx).trim() };
}

/**
 * Прибирає з тексту адміна все, що йде ПІСЛЯ маркера схеми, — навіть якщо
 * адмін спробував переписати чи стерти схему прямим запитом до API (не
 * лише через UI, де поле просто readonly). Викликається ПЕРЕД записом у
 * сховище: гарантія на рівні сервера, а не інтерфейсу.
 */
export function stripSchemaForStorage(module: CoreModuleKey, text: string): string {
  if (!CORE_MODULE_HAS_JSON_SCHEMA[module]) return text;
  return splitAtSchemaMarker(text).editable;
}

/** Заводські (незмінні кодом) шаблони кожного модуля. */
export function factoryCoreTemplate(module: CoreModuleKey): CorePromptTemplate {
  switch (module) {
    case 'chat':
      return { system: factoryChatSystemTemplate(), user: CHAT_USER_FIELD_PLACEHOLDER };
    case 'textFromImage':
      return { system: textFromImageSystemInstruction(), user: factoryTextFromImageTemplate() };
    case 'kdp':
      return { system: factoryClaudeManuscriptSystemTemplate(), user: factoryClaudeManuscriptUserTemplate() };
    case 'illustrationPromptCraft':
      return {
        system: factoryIllustrationPromptCraftSystemTemplate(),
        user: factoryIllustrationPromptCraftUserTemplate(),
      };
    case 'characterPromptCraft':
      return {
        system: factoryCharacterPromptCraftSystemTemplate(),
        user: factoryCharacterPromptCraftUserTemplate(),
      };
    case 'characterBioPrompt':
      return { system: factoryCharacterBioSystemTemplate(), user: factoryCharacterBioUserTemplate() };
    case 'synopsisToChapter':
      return { system: synopsisToChapterSystemInstruction(), user: factorySynopsisToChapterTemplate() };
  }
}

export function factoryCoreTemplateBundle(): Required<CorePromptTemplateBundle> {
  const out = {} as Required<CorePromptTemplateBundle>;
  for (const key of CORE_MODULE_KEYS) out[key] = factoryCoreTemplate(key);
  return out;
}

/**
 * Зводить адмінський шар із заводським. Порожнє поле в шарі трактується як
 * «нічого не задано» — той самий принцип, що й у промпту фото: адмін, що
 * випадково стер поле, отримує тихий відкат, а не порожній запит.
 */
export function resolveCoreTemplate(module: CoreModuleKey, adminLayer?: CorePromptTemplateBundle): CorePromptTemplate {
  const factory = factoryCoreTemplate(module);
  const admin = adminLayer?.[module];

  let system = admin?.system?.trim() || factory.system;
  if (CORE_MODULE_HAS_JSON_SCHEMA[module]) {
    // У всіх чотирьох JSON-модулів схема живе в SYSTEM. Незалежно від
    // того, що адмін зберіг (навіть прямим запитом до API, повз readonly
    // поле в UI) — схема ЗАВЖДИ береться з заводського тексту, а
    // редагована частина адміна йде ПЕРЕД нею. Гарантія на рівні сервера.
    const editablePart = admin?.system ? splitAtSchemaMarker(admin.system).editable : splitAtSchemaMarker(factory.system).editable;
    const { schema } = splitAtSchemaMarker(factory.system);
    system = editablePart ? `${editablePart}\n\n${schema}` : factory.system;
  }

  return {
    system,
    // Чат: 'user' завжди лишається протоколом buildPromptContext,
    // незалежно від того, що записано в шарі адміна — гарантія на рівні
    // сервера, а не лише інтерфейсу конструктора (readonly-поле там можна
    // обійти прямим запитом до API, тому перевірка тут, а не тільки в UI).
    user: module === 'chat' ? CHAT_USER_FIELD_PLACEHOLDER : admin?.user?.trim() || factory.user,
  };
}

/** Чи є в тексті хоч один плейсхолдер, зареєстрований для ЦЬОГО модуля. */
export function usedCorePlaceholders(module: CoreModuleKey, text: string): string[] {
  return CORE_MODULE_PLACEHOLDERS[module].filter((p) => text.includes(p));
}

/**
 * Тестовий виклик і живий перегляд — обидва потребують одного: підставити
 * значення в шаблон ЦЬОГО модуля. Кожен модуль має власну типізовану форму
 * значень (server/*Prompt.ts), а тут — єдина точка входу з простим
 * рядковим «мішком» полів (те, що реально прийде з форми в конструкторі
 * або з тіла тестового запиту), яка розкладає його по потрібних полях.
 * Поля, яких конкретний модуль не використовує, просто ігноруються.
 */
export function renderCoreTemplate(
  module: CoreModuleKey,
  template: CorePromptTemplate,
  fields: Record<string, string | undefined>
): CorePromptTemplate {
  switch (module) {
    case 'chat':
      return {
        system: renderChatSystemTemplate(template.system, {
          modelLabel: fields.modelLabel,
          styleGuide: fields.styleGuide,
          bookTitle: fields.bookTitle,
          bookGenre: fields.genre,
          bookSynopsis: fields.synopsis,
        }),
        user: CHAT_USER_FIELD_PLACEHOLDER,
      };
    case 'textFromImage':
      return {
        system: template.system,
        user: renderTextFromImageTemplate(template.user, {
          bookTitle: fields.bookTitle,
          genre: fields.genre,
          chapterTitle: fields.chapterTitle,
          captionHint: fields.captionHint,
        }),
      };
    case 'kdp':
      return {
        system: template.system,
        user: renderClaudeManuscriptUserTemplate(template.user, {
          bookTitle: fields.bookTitle,
          author: fields.author,
          genre: fields.genre,
          manuscriptText: fields.manuscriptText || '',
        }),
      };
    case 'illustrationPromptCraft': {
      const values = {
        selectedText: fields.selectedText || '',
        modelLabel: fields.modelLabel,
        stylePreset: fields.stylePreset,
        aspectRatio: fields.aspectRatio,
        genre: fields.genre,
        bookTitle: fields.bookTitle,
        chapterTitle: fields.chapterTitle,
        visualBibleJson: fields.visualBibleJson,
      };
      return {
        system: renderIllustrationPromptCraftSystemTemplate(template.system, values),
        user: renderIllustrationPromptCraftUserTemplate(template.user, values),
      };
    }
    case 'characterPromptCraft':
      return {
        system: template.system,
        user: renderCharacterPromptCraftUserTemplate(template.user, {
          characterName: fields.characterName,
          characterSurname: fields.characterSurname,
          characterRole: fields.characterRole,
          characterProfession: fields.characterProfession,
          appearanceJson: fields.appearanceJson,
          personalityJson: fields.personalityJson,
          genre: fields.genre,
          stylePreset: fields.stylePreset,
          modelLabel: fields.modelLabel,
        }),
      };
    case 'characterBioPrompt': {
      const values = { role: fields.role, genre: fields.genre, promptDescription: fields.promptDescription || '' };
      return {
        system: renderCharacterBioSystemTemplate(template.system, values),
        user: renderCharacterBioUserTemplate(template.user, values),
      };
    }
    case 'synopsisToChapter':
      return {
        system: template.system,
        user: renderSynopsisToChapterTemplate(template.user, {
          synopsis: fields.synopsis || '',
          bookTitle: fields.bookTitle,
          genre: fields.genre,
          chapterTitle: fields.chapterTitle,
          styleGuide: fields.styleGuide,
          wordBudget: fields.wordBudget,
        }),
      };
  }
}
