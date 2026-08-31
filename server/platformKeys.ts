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
