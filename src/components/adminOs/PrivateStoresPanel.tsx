import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Check, Copy, HardDrive, Loader2, Mail, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';

/**
 * «Локальні сервери» — вкладка адмінпанелі (журнал #549, запит власника 11.11.2026).
 *
 * Приватне збереження книг, курсів і інструкцій на комп'ютері користувача: локальний Docker-сервер (services/private-store)
 * сам виходить на зв'язок зі Studio, браузер автора працює з ним напряму, а Studio лише знає, які сервери є, і видає короткі
 * підписані токени. Хмара лишається типовим сховищем — приватне вмикається галочкою на матеріалі.
 *
 * Розгортання пропонується ЛИШЕ за підтвердженням поштою й кодом: «Створити» надсилає код на пошту адміністратора, і тільки
 * його введення показує одноразовий код підключення та команду запуску.
 */

type Kind = 'book' | 'course' | 'instruction' | 'scan';
const KIND_TITLE: Record<Kind, string> = { book: 'Книги', course: 'Курси', instruction: 'Інструкції', scan: 'Вхідні з телефона (запечатані знімки)' };

interface Store {
  id: string;
  name: string;
  endpoint: string;
  origins: string[];
  kinds: Kind[];
  status: 'pending' | 'active' | 'revoked';
  userIds: string[];
  createdAt: string;
  pairedAt: string | null;
  lastSeen: string | null;
  online: boolean;
  info: { version?: string; docs?: number; assets?: number; bytes?: number; uptimeSec?: number } | null;
  verified: boolean;
  verificationPending: boolean;
  verificationExpiresAt: string | null;
  pairingExpiresAt: string | null;
  revokeTokensBefore: string | null;
  grabfusion?: { assignedUsers: number; connectedUsers: number };
  /** Черга запечатаних знімків із телефона, що чекають сервер (Studio вмісту не бачить). */
  inbox?: { pending: number; bytes: number };
  inboxKey?: string | null;
}
interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
}
interface Listing {
  stores: Store[];
  users: UserRow[];
  kinds: Kind[];
  suggestedOrigins: string[];
  signingKeyFingerprint: string;
  pairingTtlMinutes: number;
  verificationTtlMinutes: number;
  heartbeatSeconds: number;
  mailEnabled: boolean;
}
interface Deploy {
  storeId: string;
  code: string;
  expiresAt: string;
  env: Record<string, string>;
}

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin/private-stores${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Не вдалося виконати дію.'), { kind: data.kind });
  return data as T;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const mb = (n: number | undefined) => (n == null ? '—' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`);

function statusOf(s: Store): { text: string; cls: string } {
  if (s.status === 'revoked') return { text: 'Відкликано', cls: 'bg-red-500/15 text-red-300' };
  if (s.status === 'active') return s.online ? { text: 'В мережі', cls: 'bg-emerald-500/15 text-emerald-300' } : { text: 'Не в мережі', cls: 'bg-amber-500/15 text-amber-300' };
  if (!s.verified) return { text: 'Чекає підтвердження пошти', cls: 'bg-sky-500/15 text-sky-300' };
  return { text: 'Чекає підключення сервера', cls: 'bg-sky-500/15 text-sky-300' };
}

const field = 'w-full rounded-lg bg-slate-950/60 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50';
const btnPrimary = `${btn} bg-sky-600 hover:bg-sky-500 text-white`;
const btnGhost = `${btn} bg-slate-800 hover:bg-slate-700 text-slate-200`;
const btnDanger = `${btn} bg-red-900/40 hover:bg-red-800/60 text-red-200`;

export function PrivateStoresPanel() {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [deploy, setDeploy] = useState<Deploy | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Listing>(''));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const userName = useMemo(() => {
    const map = new Map((data?.users ?? []).map((u) => [u.id, u]));
    return (id: string) => (map.get(id) ? `${map.get(id)!.name} (${map.get(id)!.email})` : id);
  }, [data]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError('');
    setNotice('');
    try {
      await fn();
      if (label) setNotice(label);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-4" data-private-stores>
      <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 max-w-3xl">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-sky-400" /> Локальні сервери
            </h3>
            <p className="text-[12px] text-slate-400 mt-1">
              Приватне збереження книг, курсів і інструкцій на комп&apos;ютері користувача (Docker). Хмара лишається типовим сховищем: матеріал потрапляє на
              локальний сервер лише тоді, коли автор поставив галочку «Приватне збереження на локальному сервері» й для нього призначено сервер.
            </p>
          </div>
          <button onClick={() => void load()} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400" title="Оновити">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 text-[11px] text-slate-300" data-private-security>
          <div className="rounded-xl bg-slate-950/50 border border-slate-800 p-3 flex gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <span>Підключення лише після підтвердження поштою й кодом: код діє {data?.verificationTtlMinutes ?? 15} хв і має 5 спроб; код підключення — одноразовий, {data?.pairingTtlMinutes ?? 15} хв.</span>
          </div>
          <div className="rounded-xl bg-slate-950/50 border border-slate-800 p-3 flex gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <span>Сервер сам ходить до Studio (вихідний HTTPS, пульс раз на {data?.heartbeatSeconds ?? 60} с): порти на роутері не відкриваються, тунелі не потрібні.</span>
          </div>
          <div className="rounded-xl bg-slate-950/50 border border-slate-800 p-3 flex gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <span>Браузер автора працює з сервером напряму: Studio не бачить вмісту й видає лише короткі (10 хв) підписані токени.</span>
          </div>
          <div className="rounded-xl bg-slate-950/50 border border-slate-800 p-3 flex gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <span>
              Дані зашифровані (AES-256-GCM); ключ лежить окремо від бази. Відбиток ключа підпису Studio: <code className="text-sky-300">{data?.signingKeyFingerprint ?? '…'}</code> — його
              сервер виводить у журнал під час підключення: звіряйте.
            </span>
          </div>
        </div>
        {data && !data.mailEnabled && (
          <p className="mt-3 text-[12px] rounded-lg bg-amber-500/10 text-amber-200 border border-amber-500/30 p-3" data-private-mail-warning>
            Надсилання листів на сервері Studio не налаштовано, тому підключити локальний сервер не вийде: код підтвердження неможливо надіслати. Налаштуйте пошту (BREVO_API_KEY або SMTP_*).
          </p>
        )}
        {error && <p className="mt-3 text-[12px] text-red-300" data-private-error>{error}</p>}
        {notice && <p className="mt-3 text-[12px] text-emerald-300">{notice}</p>}
      </div>

      {data && <NewServerForm data={data} onCreated={async (storeId, masked) => { setNotice(`Код підтвердження надіслано на ${masked}. Введіть його нижче, щоб отримати код підключення.`); setDeploy(null); await load(); document.querySelector(`[data-store="${storeId}"] input[data-verify-code]`)?.scrollIntoView({ block: 'center' }); }} />}

      {data?.stores.map((s) => (
        <StoreCard
          key={s.id}
          store={s}
          data={data}
          userName={userName}
          deploy={deploy?.storeId === s.id ? deploy : null}
          onDeploy={setDeploy}
          run={run}
        />
      ))}
      {data && data.stores.length === 0 && <p className="text-[12px] text-slate-500 px-1">Серверів ще немає. Створіть перше підключення вище.</p>}
    </div>
  );
}

function NewServerForm({ data, onCreated }: { data: Listing; onCreated: (storeId: string, maskedEmail: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:8787');
  const [origins, setOrigins] = useState(data.suggestedOrigins.join(', ') || window.location.origin);
  const [kinds, setKinds] = useState<Kind[]>(['book', 'course', 'instruction', 'scan']);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ store: Store; verification: { emailMasked: string } }>('', 'POST', {
        name,
        endpoint,
        origins: origins.split(/[,\s]+/).filter(Boolean),
        kinds,
        userIds,
      });
      setName('');
      await onCreated(res.store.id, res.verification.emailMasked);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5 space-y-3" data-private-new>
      <h4 className="text-sm font-bold text-slate-100">Підключити новий сервер</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[11px] text-slate-400">
          Назва
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Наприклад: Домашній комп'ютер Анни" maxLength={80} required data-private-name />
        </label>
        <label className="text-[11px] text-slate-400">
          Адреса, за якою браузер звертається до сервера
          <input className={field} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://127.0.0.1:8787" required data-private-endpoint />
        </label>
      </div>
      <label className="text-[11px] text-slate-400 block">
        Дозволені сторінки Studio (через кому). Сервер приймає браузерні запити лише з них
        <input className={field} value={origins} onChange={(e) => setOrigins(e.target.value)} data-private-origins />
      </label>
      <div className="text-[11px] text-slate-400">
        Види матеріалів
        <div className="flex gap-4 mt-1">
          {data.kinds.map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-slate-200 text-xs">
              <input type="checkbox" checked={kinds.includes(k)} onChange={() => setKinds((v) => toggle(v, k))} /> {KIND_TITLE[k]}
            </label>
          ))}
        </div>
      </div>
      <div className="text-[11px] text-slate-400">
        Кому призначити (галочка «Приватне збереження» зʼявиться лише в них)
        <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
          {data.users.map((u) => (
            <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800/50">
              <input type="checkbox" checked={userIds.includes(u.id)} onChange={() => setUserIds((v) => toggle(v, u.id))} data-private-user={u.id} />
              <span className="truncate">{u.name}</span>
              <span className="text-slate-500 truncate">{u.email}</span>
              <span className="ml-auto text-slate-500">{u.role}</span>
            </label>
          ))}
        </div>
      </div>
      {error && <p className="text-[12px] text-red-300">{error}</p>}
      <button type="submit" disabled={busy || !data.mailEnabled || !name.trim() || kinds.length === 0} className={btnPrimary} data-private-create>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Створити й надіслати код на пошту
      </button>
    </form>
  );
}

function StoreCard({
  store,
  data,
  userName,
  deploy,
  onDeploy,
  run,
}: {
  store: Store;
  data: Listing;
  userName: (id: string) => string;
  deploy: Deploy | null;
  onDeploy: (d: Deploy | null) => void;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const st = statusOf(store);
  const [code, setCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [busy, setBusy] = useState(false);
  const needsVerify = !store.verified && !deploy;
  const [editing, setEditing] = useState(false);
  const [editUsers, setEditUsers] = useState<string[]>(store.userIds);
  const [editOrigins, setEditOrigins] = useState(store.origins.join(', '));
  const [editEndpoint, setEditEndpoint] = useState(store.endpoint);

  const verify = async () => {
    setBusy(true);
    setVerifyError('');
    try {
      const res = await api<{ pairing: { code: string; expiresAt: string }; deploy: { env: Record<string, string> } }>(`/${store.id}/verify`, 'POST', { code });
      onDeploy({ storeId: store.id, code: res.pairing.code, expiresAt: res.pairing.expiresAt, env: res.deploy.env });
      setCode('');
      await run('', async () => undefined); // оновити стан картки: пошту підтверджено
    } catch (err) {
      setVerifyError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5 space-y-3" data-store={store.id} data-store-status={store.status}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-bold text-slate-100">{store.name}</h4>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`} data-store-badge>{st.text}</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {store.endpoint} · створено {when(store.createdAt)}
            {store.pairedAt ? ` · підключено ${when(store.pairedAt)}` : ''}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {store.status !== 'revoked' && (
            <button className={btnGhost} onClick={() => run('', () => api(`/${store.id}/verification`, 'POST'))} data-act="resend">
              <Mail className="w-3.5 h-3.5" /> {needsVerify ? 'Надіслати код на пошту' : 'Новий код підключення'}
            </button>
          )}
          <button className={btnGhost} onClick={() => setEditing((v) => !v)}>Налаштування</button>
          {store.status === 'revoked' ? (
            <button className={btnGhost} onClick={() => run('Сервер повернуто в роботу.', () => api(`/${store.id}/restore`, 'POST'))}><RotateCcw className="w-3.5 h-3.5" /> Повернути</button>
          ) : (
            <button className={btnDanger} onClick={() => window.confirm('Відкликати сервер? Нові токени не видаватимуться, сервер замкнеться після найближчого пульсу.') && run('Сервер відкликано.', () => api(`/${store.id}/revoke`, 'POST'))} data-act="revoke"><Ban className="w-3.5 h-3.5" /> Відкликати</button>
          )}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2 text-slate-400">
        <div>Останній пульс: <span className="text-slate-200">{when(store.lastSeen)}</span></div>
        <div>Версія / записів / обсяг: <span className="text-slate-200">{store.info?.version ?? '—'} / {store.info?.docs ?? '—'} / {mb(store.info?.bytes)}</span></div>
        <div>Види: <span className="text-slate-200">{store.kinds.map((k) => KIND_TITLE[k]).join(', ')}</span></div>
        <div>Дозволені сторінки: <span className="text-slate-200">{store.origins.join(', ')}</span></div>
        <div className="sm:col-span-2">Призначено: <span className="text-slate-200">{store.userIds.length ? store.userIds.map(userName).join('; ') : 'нікому'}</span></div>
        <div className="sm:col-span-2" data-grabfusion-sync>
          Синхронізація з GrabFusion: <span className="text-slate-200">{store.status === 'active' ? 'телефон бачить статус цього сервера' : 'після підключення'}</span>
          {store.grabfusion && <span> · призначено {store.grabfusion.assignedUsers}, підключили GrabFusion {store.grabfusion.connectedUsers}</span>}
          <span className="text-slate-500"> (приватна чернетка з телефона: знімки запечатуються на телефоні ключем цього сервера, Studio лише переносить шифротекст, розпізнає сам сервер)</span>
        </div>
        <div className="sm:col-span-2" data-inbox-status>
          Знімки з телефона: <span className="text-slate-200">{store.kinds.includes('scan') ? (store.inboxKey ? 'сервер приймає' : 'чекаємо ключ скриньки (оновіть сервер: docker compose up -d --build)') : 'вимкнено для цього сервера'}</span>
          {store.inbox && store.inbox.pending > 0 && <span> · у черзі {store.inbox.pending} ({mb(store.inbox.bytes)}) — чекають, поки сервер їх забере</span>}
        </div>
      </dl>

      {needsVerify && (
        <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 p-3 space-y-2" data-verify-box>
          <p className="text-[12px] text-sky-100">
            {store.verificationPending
              ? `Код підтвердження надіслано на пошту адміністратора (діє до ${when(store.verificationExpiresAt)}). Введіть його — і ви отримаєте код підключення й команду запуску.`
              : 'Код підтвердження ще не надіслано або прострочений. Натисніть «Надіслати код на пошту».'}
          </p>
          <div className="flex gap-2 items-center">
            <input
              className={`${field} max-w-[14rem] tracking-widest uppercase`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Код з листа"
              maxLength={12}
              data-verify-code
              onKeyDown={(e) => e.key === 'Enter' && code.trim() && void verify()}
            />
            <button className={btnPrimary} disabled={busy || !code.trim()} onClick={() => void verify()} data-act="verify">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Підтвердити
            </button>
          </div>
          {verifyError && <p className="text-[12px] text-red-300" data-verify-error>{verifyError}</p>}
        </div>
      )}

      {deploy && <DeployBox deploy={deploy} store={store} onClose={() => onDeploy(null)} />}
      {!deploy && store.verified && store.status === 'pending' && store.pairingExpiresAt && (
        <p className="text-[11px] text-slate-500">Код підключення вже видано (діє до {when(store.pairingExpiresAt)}), але його не показано повторно. Щоб отримати новий, натисніть «Новий код підключення».</p>
      )}

      {editing && (
        <div className="rounded-xl bg-slate-950/50 border border-slate-800 p-3 space-y-2 text-[11px] text-slate-400" data-edit-box>
          <label className="block">Адреса сервера<input className={field} value={editEndpoint} onChange={(e) => setEditEndpoint(e.target.value)} /></label>
          <label className="block">Дозволені сторінки Studio<input className={field} value={editOrigins} onChange={(e) => setEditOrigins(e.target.value)} /></label>
          <div>
            Призначено
            <div className="mt-1 max-h-32 overflow-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
              {data.users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-1 text-xs text-slate-200">
                  <input type="checkbox" checked={editUsers.includes(u.id)} onChange={() => setEditUsers((v) => (v.includes(u.id) ? v.filter((x) => x !== u.id) : [...v, u.id]))} />
                  {u.name} <span className="text-slate-500">{u.email}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className={btnPrimary} onClick={() => run('Збережено.', () => api(`/${store.id}`, 'PUT', { endpoint: editEndpoint, origins: editOrigins.split(/[,\s]+/).filter(Boolean), userIds: editUsers })).then(() => setEditing(false))}>Зберегти</button>
            <button className={btnGhost} onClick={() => run('Токени скасовано: діятимуть лише нові.', () => api(`/${store.id}/revoke-tokens`, 'POST'))}>Скасувати видані токени</button>
            <button className={btnDanger} onClick={() => window.confirm('Видалити запис про сервер зі Studio? Дані на самому сервері лишаться, але підключити його знову можна буде лише новим кодом.') && run('Запис видалено.', () => api(`/${store.id}`, 'DELETE'))}><Trash2 className="w-3.5 h-3.5" /> Видалити запис</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeployBox({ deploy, store, onClose }: { deploy: Deploy; store: Store; onClose: () => void }) {
  const [copied, setCopied] = useState('');
  const envText = Object.entries(deploy.env).map(([k, v]) => `${k}=${v}`).join('\n');
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(''), 2000);
    } catch {
      /* буфер недоступний — користувач скопіює вручну */
    }
  };
  return (
    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 space-y-3" data-deploy-box>
      <p className="text-[12px] text-emerald-100">
        Пошту підтверджено. Код підключення показано <b>один раз</b> і діє до {when(deploy.expiresAt)}.
      </p>
      <div>
        <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
          <span>Файл <code>.env</code> у теці services/private-store</span>
          <button className={btnGhost} onClick={() => void copy('env', envText)}>{copied === 'env' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Копіювати</button>
        </div>
        <pre className="rounded-lg bg-slate-950/80 border border-slate-800 p-3 text-[11px] text-slate-100 overflow-auto" data-deploy-env>{envText}</pre>
      </div>
      <ol className="list-decimal pl-5 text-[11px] text-slate-300 space-y-1">
        <li>Встановіть і запустіть Docker Desktop (Windows/macOS) або Docker Engine (Linux).</li>
        <li>Візьміть теку <code>services/private-store</code> з репозиторію Studio (git clone або завантажений архів).</li>
        <li>Збережіть показаний вище вміст як файл <code>.env</code> у цій теці. Якщо Studio і сервер працюють на одному комп&apos;ютері, для STUDIO_URL підійде <code>http://host.docker.internal:3000</code>.</li>
        <li>Windows PowerShell: <code>.\scripts\start.ps1</code> · Linux/macOS: <code>./scripts/start.sh</code>. Скрипт сам створить головний ключ шифрування (збережіть його копію окремо!) і запустить контейнер.</li>
        <li>За хвилину статус «{store.name}» зміниться на «В мережі». Рядок «відбиток ключа Studio» в журналі сервера (<code>docker compose logs</code>) має збігтися з відбитком угорі сторінки.</li>
      </ol>
      <button className={btnGhost} onClick={onClose}>Сховати код</button>
    </div>
  );
}
