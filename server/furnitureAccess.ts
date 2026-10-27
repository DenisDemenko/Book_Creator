import { readBridgeSettings } from './marketplaceBridge';
import { saveUser, type StoredUser } from './store';

export interface FurnitureAccess {
  role: string | null;
  firebaseUid: string | null;
  allowed: boolean;
}

async function bridgeRequest(path: string, method: string, body?: object) {
  const settings = await readBridgeSettings();
  const response = await fetch(`${settings.url}/bridge/tables/${path}`, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', 'x-bridge-key': settings.key },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(Array.isArray(data.message) ? data.message.join('; ') : data.message || 'Не вдалося перевірити доступ до складу.');
  }
  return data;
}

async function furnitureRequest(path: string, method: string, body: object): Promise<FurnitureAccess> {
  const data = await bridgeRequest(path, method, body);
  if (typeof data.allowed !== 'boolean' || (data.firebaseUid !== null && typeof data.firebaseUid !== 'string'))
    throw new Error('Маркетплейс повернув некоректний стан доступу.');
  return data;
}

export function readFurnitureAccess(user: Pick<StoredUser, 'email' | 'firebaseUid'>) {
  return furnitureRequest('designer-access/lookup', 'POST', {
    email: user.email,
    ...(user.firebaseUid ? { firebaseUid: user.firebaseUid } : {}),
  });
}

export async function setSharedFurnitureRole(user: StoredUser, enabled: boolean) {
  return furnitureRequest('designer-access', 'PUT', {
    email: user.email,
    ...(user.firebaseUid ? { firebaseUid: user.firebaseUid } : {}),
    enabled,
  });
}

/** Marketplace is authoritative for the shared furniture role. Book roles stay local. */
export async function refreshFurnitureRole(user: StoredUser): Promise<StoredUser> {
  if (user.role === 'admin' || !user.firebaseUid) return user;
  const access = await readFurnitureAccess(user);
  const role: StoredUser['role'] = access.role === 'furniture_designer'
    ? 'furniture_designer'
    : user.role === 'furniture_designer' && !access.allowed ? 'reader' : user.role;
  if (role === user.role) return user;
  const updated = { ...user, role };
  await saveUser(updated);
  return updated;
}

/** One upstream read keeps the admin roster current without a request per user. */
export async function refreshFurnitureRoster(users: StoredUser[]): Promise<StoredUser[]> {
  const data = await bridgeRequest('designer-access', 'GET');
  if (!Array.isArray(data.designers) || data.designers.some((u: unknown) =>
    !u || typeof u !== 'object' || typeof (u as { firebaseUid?: unknown }).firebaseUid !== 'string' || typeof (u as { email?: unknown }).email !== 'string'))
    throw new Error('Не вдалося синхронізувати список дизайнерів меблів.');
  const byUid = new Map<string, string>(data.designers.map((u: { firebaseUid: string; email: string }) => [u.firebaseUid, u.email.toLowerCase()]));
  const byEmail = new Set<string>(data.designers.map((u: { email: string }) => u.email.toLowerCase()));
  return Promise.all(users.map(async (user) => {
    if (user.role === 'admin') return user;
    const shared = user.firebaseUid
      ? byUid.get(user.firebaseUid) === user.email.toLowerCase()
      : user.role === 'furniture_designer' && byEmail.has(user.email.toLowerCase());
    const role: StoredUser['role'] = shared ? 'furniture_designer' : user.role === 'furniture_designer' ? 'reader' : user.role;
    if (role === user.role) return user;
    const updated = { ...user, role };
    await saveUser(updated);
    return updated;
  }));
}
