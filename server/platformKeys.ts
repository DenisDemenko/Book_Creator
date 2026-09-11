/**
 * Ключі провайдерів ШІ належать ПЛАТФОРМІ, а не окремому авторові.
 *
 * Бізнес-правило: коди провайдерів вводить лише адміністратор, а Nova
 * надає послугу решті ролей за цими ключами. Автор нічого не вставляє —
 * він отримує доступ до певної кількості генерацій за кредитами, що
 * входять у вартість підписки. Сама модель кредитів ще не затверджена,
 * тому її тут немає: цей модуль відповідає рівно на одне питання —
 * «яким ключем платформа виконує запит цього рушія».
 *
 * До появи цього модуля ключ шукався у ТОГО, ХТО ВИКЛИКАЄ
 * (`getUserApiKey(callerId, engine)`). При адмінській моделі ключів це
 * означало б, що рушій працює тільки в адміністратора, а письменник
 * отримує «ключ не налаштований» — попри те, що ключ у системі є.
 */

import crypto from 'node:crypto';
import { listUsers, getUserApiKey } from './store';
import { decryptApiKey, isApiKeyCryptoConfigured } from './userApiKeyCrypto';

/**
 * Ключ, збережений адміністратором у розділі «Ключі API», або undefined.
 *
 * Змінні оточення тут навмисно не читаються: у кожного рушія вони свої
 * (`OPENAI_API_KEY`, `ARK_API_KEY`, …), і кожен виклик уже вміє на них
 * відкотитись. Цей модуль додає рівно один, відсутній доти, шар — ключ,
 * який адміністратор вставив через інтерфейс.
 *
 * Помилка читання чи розшифрування не валить виклик: тоді працює
 * серверний ключ з оточення, як до появи панелі.
 */
export async function platformKeyFor(engine: string): Promise<string | undefined> {
  if (!isApiKeyCryptoConfigured()) return undefined;
  try {
    // Адміністраторів може бути кілька; ключ міг вставити будь-хто з них,
    // тож беремо перший, який справді розшифровується.
    const admins = (await listUsers()).filter((u) => u.role === 'admin' && !u.disabled);
    for (const admin of admins) {
      const stored = await getUserApiKey(admin.id, engine);
      if (!stored?.encryptedKey) continue;
      const plain = decryptApiKey(stored.encryptedKey).trim();
      if (plain) return plain;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ключ, яким виконати запит рушія для КОНКРЕТНОГО виклику: спершу
 * платформний (вставлений адміністратором у «Ключі API»), потім власний
 * ключ того, хто викликає, і лише потім — змінна оточення сервера (її
 * підхоплює вже сам виклик рушія, якщо звідси повернеться undefined).
 *
 * Потрібен тому, що маршрути ШІ в server.ts дісталися з часів, коли ключ
 * шукався ТІЛЬКИ у того, хто викликає (`getUserApiKey(callerId, engine)`),
 * і на платформну модель ключів їх так і не перевели. Наслідки були
 * рівно ті, які описані вгорі цього файлу:
 *
 *  - у письменника власного ключа немає й бути не може, тож кожен такий
 *    маршрут мовчки падав на змінну оточення — навіть коли в «Ключах API»
 *    стояв робочий ключ;
 *  - адміністратор, який САМ ключа не вставляв (його вставив інший
 *    адміністратор), отримував те саме.
 *
 * Саме так і зловили баг #146: «ядро» (expressEngine.ts) уже читало
 * платформний ключ і працювало на DeepSeek, а AI-коуч ходив старим
 * шляхом, не знаходив ключа в того, хто натиснув «Проаналізувати», і
 * йшов у DeepSeek зі старим ключем зі змінної оточення — звідси
 * «Authentication Fails, Your api key: ****… is invalid».
 *
 * Порядок саме такий (платформний → власний), бо ключі за бізнес-правилом
 * належать платформі; власний лишено запасним, щоб нічого не відібрати в
 * тих, хто його колись вставив.
 */
export async function resolveEngineKey(
  userId: string | undefined | null,
  engine: string,
  label = 'ai'
): Promise<string | undefined> {
  const platform = await platformKeyFor(engine);
  if (platform) {
    logKeySource(label, engine, 'платформний («Ключі API»)', platform);
    return platform;
  }
  if (!userId) {
    logKeySource(label, engine, 'змінна оточення сервера', undefined);
    return undefined;
  }
  try {
    const stored = await getUserApiKey(userId, engine);
    if (!stored?.encryptedKey) {
      logKeySource(label, engine, 'змінна оточення сервера', undefined);
      return undefined;
    }
    const plain = decryptApiKey(stored.encryptedKey).trim();
    logKeySource(label, engine, plain ? 'власний ключ користувача' : 'змінна оточення сервера', plain);
    return plain || undefined;
  } catch (err) {
    console.warn(`[${label}] ключ користувача не розшифрувався, пробуємо серверний:`, err);
    return undefined;
  }
}

/**
 * Один рядок у лог: ЗВІДКИ взято ключ і його відбиток — щоб на питання
 * «провайдер каже, що ключ невалідний, а який саме ключ пішов?» була
 * відповідь у логах сервера, а не здогадки. Сам ключ не пишемо ніколи:
 * лише перші 8 символів sha256, той самий відбиток, що показує панель
 * «Ключі API», тож рядок у логу можна звірити з інтерфейсом очима.
 */
function logKeySource(label: string, engine: string, source: string, key: string | undefined): void {
  const fp = key ? crypto.createHash('sha256').update(key).digest('hex').slice(0, 8) : '—';
  console.info(`[${label}] ${engine}: ключ — ${source}, відбиток ${fp}`);
}
