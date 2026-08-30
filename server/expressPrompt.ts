/**
 * Промпти експрес-майстра (Wisart Book Crealiry.md §3.4, «Quick Start
 * Suggester»).
 *
 * Кожен крок — окремий виклик, а не один великий запит: користувач бачить
 * і приймає результат по частинах, і перегенерувати каст, не чіпаючи вже
 * схвалений синопсис, можна лише коли вони згенеровані окремо.
 */

import type { ExpressPayload } from './expressStore';

const ROLE = `Ти — наративний архітектор у режимі швидкого прототипування. З одного-двох речень задуму ти пропонуєш готовий каркас книги, який користувач лише приймає або підправляє.

Пропозиції мають бути конкретними. Жодних «можливо», «на ваш розсуд» чи порожніх заготовок: порожня заготовка тут гірша за помилкову здогадку, бо повертає користувача до чистого аркуша, від якого його й рятує експрес.

Відповідай виключно валідним JSON без коментарів і без markdown-огорожі.`;

/** Крок Е1 «Кинути кубик»: задум для того, хто прийшов подивитись. */
export function seedPrompt(): { system: string; prompt: string } {
  return {
    system: ROLE,
    prompt: `Придумай несподіваний, але життєздатний задум книги українською.

Уникай найзатертішого: обраного, який рятує світ; амнезії; «все виявилось сном».

Формат відповіді:
{"seed": "1-2 речення про те, про що книга", "genre": "жанр або власне формулювання"}`,
  };
}

/** Крок Е2: модель розповіді + прапорці патернів. */
export function frameworkPrompt(payload: ExpressPayload): { system: string; prompt: string } {
  return {
    system: ROLE,
    prompt: `Задум: «${payload.seed ?? ''}»
Жанр: «${payload.genre ?? 'не вказано'}»

Обери ОДНУ модель розповіді, яка найкраще пасує саме цьому задуму:
- hero_journey — подорож героя, 12 стадій Кемпбелла;
- psychotypes — сюжет через зіткнення характерів і внутрішніх суперечностей;
- vedic_archetypes — еволюція через гуни (Тамас -> Раджас -> Саттва);
- buddhist_skandhas — розгортання через 5 скандх.

Поясни вибір ОДНИМ реченням — чому саме ця модель, а не інші.
Визнач також два прапорці: natureConnection (звʼязок стану героїв із природою) та archetypes36 (патерни Польті).

Формат відповіді:
{"framework": "one_of_the_four", "rationale": "одне речення", "natureConnection": true, "archetypes36": true}`,
  };
}

/** Крок Е3: каст із ведичними ролями й патернами Польті. */
export function castPrompt(payload: ExpressPayload): { system: string; prompt: string } {
  return {
    system: ROLE,
    prompt: `Задум: «${payload.seed ?? ''}»
Жанр: «${payload.genre ?? 'не вказано'}»
Модель розповіді: ${payload.framework ?? 'hero_journey'}

Згенеруй 5 персонажів українською.

Обовʼязкові умови:
- vedicRole — одна з: ATMA_MATA, GURU_PATNI, RADJA_PATNI, BRAHMANI, DHENU_GAU, DHATRI, PRITHVI_BHUMI, JANITA, UPANITA, VIDYA_DATA, ANNA_DATA, BHAYA_TRATA. У касті НЕ повторюються.
- poltiPatternId — число 1..36 (драматичні ситуації Польті), poltiRoleName — назва амплуа українською.
- Патерни мають утворювати щонайменше ДВІ комплементарні пари (напр. 33 «Невинно засуджений» проти 32 «Наклепник»), інакше графу конфліктів не буде з чого будуватися.

Формат відповіді:
{"cast": [{"firstName": "Імʼя", "lastName": "Прізвище", "psychotype": "стислий опис", "vedicRole": "DHATRI", "poltiPatternId": 33, "poltiRoleName": "Невинно засуджений", "hook": "одне речення про роль у сюжеті"}]}`,
  };
}

/** Крок Е4: синопсис на 500-700 слів. */
export function synopsisPrompt(payload: ExpressPayload): { system: string; prompt: string } {
  const cast = (payload.cast ?? [])
    .map((c) => `${c.firstName} ${c.lastName} — ${c.psychotype ?? ''} (${c.poltiRoleName ?? ''})`)
    .join('\n');

  return {
    system: ROLE,
    prompt: `Задум: «${payload.seed ?? ''}»
Жанр: «${payload.genre ?? 'не вказано'}»
Модель розповіді: ${payload.framework ?? 'hero_journey'}

Персонажі:
${cast || '(каст не задано)'}

Напиши синопсис українською на 500-700 слів. Імена персонажів вживай ДОСЛІВНО, як вище — від цього залежить автодоповнення в редакторі.

Формат відповіді:
{"synopsis": "текст синопсису"}`,
  };
}

/**
 * Крок Е5: одна частина книги на виклик.
 *
 * Частина за частиною, а не одним запитом на всю структуру: у Nova немає
 * стрімінгу, і послідовні виклики дають той самий поступовий показ — кожна
 * частина приходить готовою одиницею, — не вимагаючи нової інфраструктури.
 */
export function partPrompt(
  payload: ExpressPayload,
  partNumber: number,
  totalParts: number
): { system: string; prompt: string } {
  const cast = (payload.cast ?? [])
    .map((c) => `${c.firstName} ${c.lastName} (${c.poltiRoleName ?? ''})`)
    .join(', ');

  return {
    system: `Ти — провідний сценарний аналітик, наративний архітектор та літературний редактор. Відповідай виключно валідним JSON.`,
    prompt: `Книга: «${payload.seed ?? ''}»
Жанр: ${payload.genre ?? 'не вказано'}
Модель розповіді: ${payload.framework ?? 'hero_journey'}
Персонажі: ${cast || '(не задано)'}
${payload.natureConnection ? 'У кожній главі має бути звʼязок стану героїв зі стихією, погодою чи порою року.' : ''}
${payload.archetypes36 ? 'Кожна глава розвиває щонайменше одну пару конфліктів із патернів Польті.' : ''}

Синопсис:
${payload.synopsis ?? '(немає)'}

Згенеруй ЧАСТИНУ ${partNumber} з ${totalParts}. У частині 3-4 глави.

Формат відповіді:
{"partNumber": ${partNumber}, "partTitle": "назва частини", "frameworkStage": "етап моделі", "chapters": [{"chapterNumber": 1, "chapterTitle": "назва", "involvedCharacters": ["Імʼя Прізвище"], "environmentalContext": "опис стихії або null", "summary": "детальний опис подій сцени, 80-120 слів", "turningPoint": "поворотний момент"}]}`,
  };
}
