/**
 * Промпт «опиши персонажа, якого ти СПРАВДІ бачиш на цьому фото».
 *
 * Окремий, чистий файл — за тим самим принципом, що й
 * `server/textFromImagePrompt.ts`: текст промпту має бути видно й
 * перевіряти можна без Express, без ключів і без мережі
 * (`scripts/test-describeCharacter.mts`).
 *
 * ЧОМУ ЦЕ НЕ ТОЙ САМИЙ ПРОМПТ, ЩО «ТЕКСТ СЦЕНИ». Модуль `textFromImage`
 * пише художній фрагмент сцени «за мотивами» зображення — це література.
 * Тут інша задача: автор подивився на щойно згенерований портрет і хоче
 * знати, КОГО ж насправді намалювала модель, щоб або прийняти кадр, або
 * перегенерувати. Тому в промпті три жорсткі правила: описувати лише те,
 * що видно; прямо казати, чого на зображенні немає; і тримати опис у ключі
 * книги (жанр, аудиторія, синопсис, склад персонажів), а не в порожнечі.
 */

export interface CharacterFromImageOptions {
  /** Назва, під якою фото лежить у галереї (файл або підпис картки). */
  photoLabel?: string;
  /** Промпт, яким це зображення колись згенерували — якщо він зберігся. */
  generationPrompt?: string;
  /** Імʼя персонажа, якщо автор уже знає, кого саме перевіряє. */
  characterHint?: string;
  /** Дані книги — «ядро письменника», з якого опис бере контекст. */
  bookTitle?: string;
  genre?: string;
  audience?: string;
  synopsis?: string;
  characters?: { name: string; role?: string; description?: string }[];
}

/** Обрізає довгі поля, щоб промпт не роздувся на цілу книгу. */
function clip(value: string | undefined | null, max: number): string {
  const s = String(value || '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Список персонажів книги — імена, ролі й короткий опис (по одному рядку). */
function characterRoster(characters: CharacterFromImageOptions['characters']): string {
  const list = (characters || []).filter((c) => c && String(c.name || '').trim());
  if (!list.length) return '';
  return list
    .slice(0, 20)
    .map((c) => {
      const role = clip(c.role, 60);
      const desc = clip(c.description, 220);
      return `  • ${clip(c.name, 80)}${role ? ` — ${role}` : ''}${desc ? `: ${desc}` : ''}`;
    })
    .join('\n');
}

export function buildCharacterFromImagePrompt(opts: CharacterFromImageOptions): string {
  const lines: string[] = [];

  lines.push('Опиши персонажа, якого ти СПРАВДІ бачиш на цьому зображенні.');
  lines.push('');
  lines.push(
    'Це не текст сцени й не художній фрагмент. Це робочий опис для автора: він подивився на щойно згенерований портрет і має вирішити — прийняти кадр чи перегенерувати. Тому найважливіше — чесність: описуй те, що є на зображенні, а не те, що мало бути.'
  );

  const photoLabel = clip(opts.photoLabel, 160);
  const generationPrompt = clip(opts.generationPrompt, 700);
  const environment: string[] = [];
  if (photoLabel) environment.push(`  • файл у галереї: ${photoLabel}`);
  if (opts.characterHint) environment.push(`  • автор вважає, що це: ${clip(opts.characterHint, 120)}`);
  if (generationPrompt) {
    environment.push(
      `  • ПРОМПТ, яким це згенеровано (це НАМІР, а не факт — порівняй із тим, що бачиш): ${generationPrompt}`
    );
  }
  if (environment.length) {
    lines.push('');
    lines.push('Що відомо про це зображення до того, як ти на нього подивився:');
    lines.push(...environment);
  }

  const roster = characterRoster(opts.characters);
  const book: string[] = [];
  if (opts.bookTitle) book.push(`  • назва книги: ${clip(opts.bookTitle, 160)}`);
  if (opts.genre) book.push(`  • жанр: ${clip(opts.genre, 120)}`);
  if (opts.audience) book.push(`  • аудиторія: ${clip(opts.audience, 160)}`);
  if (opts.synopsis) book.push(`  • синопсис: ${clip(opts.synopsis, 900)}`);
  if (roster) book.push(`  • персонажі книги:\n${roster}`);
  if (book.length) {
    lines.push('');
    lines.push('Ядро книги, у ключі якої має бути опис (це контекст, а не джерело фактів про фото):');
    lines.push(...book);
  }

  lines.push('');
  lines.push('Як писати:');
  lines.push(
    '  1. Спершу — зовнішність: стать і приблизний вік, статура, волосся, обличчя, одяг і його стан, помітні деталі (шрами, прикраси, зброя, речі в руках), поза й погляд. Лише те, що справді видно.'
  );
  lines.push(
    '  2. Далі — враження: ким ця людина здається (вік, професія, стан, настрій), і чому саме таке враження створює зображення. Це висновок, тому позначай його як враження, а не як факт.'
  );
  lines.push(
    '  3. Якщо в книзі є персонаж, на якого це схоже, — назви його і скажи, у чому збіг, а в чому розбіжність. Якщо жоден не підходить — скажи прямо, що схожого персонажа в наданих даних немає.'
  );
  lines.push(
    '  4. Останній абзац — «Чого на зображенні не видно»: що саме неможливо перевірити за цим кадром (зріст, хода, голос, деталі за кадром, обличчя в профіль тощо).'
  );
  lines.push(
    '  5. Якщо на зображенні кілька людей — назви це й опиши того, хто найбільше відповідає підказці; решту згадай одним рядком.'
  );
  lines.push(
    '  6. Мова — українська. Обсяг — 5–9 речень (приблизно 120–220 слів). Без списків, без заголовків, без Markdown: звичайні абзаци, які автор зможе одразу вставити в книгу.'
  );
  lines.push(
    '  7. Не вигадуй імені, якщо його не дано. Не вигадуй біографії. Не описуй те, чого на зображенні немає, навіть якщо цього вимагає промпт генерації.'
  );

  return lines.join('\n');
}

export function characterFromImageSystemInstruction(): string {
  return [
    'Ти — співавтор українського письменника й уважний редактор-портретист.',
    'Твоя робота — дивитися на зображення й чесно переказувати побачене словами, без прикрас і без вигадок.',
    'Ти ніколи не описуєш те, чого не бачиш; натомість прямо називаєш, чого на зображенні не видно.',
    'Ти пишеш літературною українською мовою, живими абзацами, без списків і без службових формулювань.',
  ].join(' ');
}
