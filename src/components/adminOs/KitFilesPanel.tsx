import React, { useMemo, useRef, useState } from 'react';
import { Download, FileUp, History, Pencil, Trash2, Upload } from 'lucide-react';
import {
  KIT_FILE_KIND_LABELS,
  KIT_FILE_EXTENSIONS,
  MAX_KIT_FILES,
  formatBytes,
  latestVersion,
  partsUsingFile,
  totalKitFileBytes,
  type KitFile,
} from './kitFiles';
import type { KitSpec } from './kitSpec';
import type { KitThemeTokens } from './KitSpecEditor';

/**
 * Блок «Файли для виготовлення» (K4): креслення, DXF, STL — з версіями. Байти лежать на сервері
 * (приватно, лише адмін), у картці — опис. Нова версія не стирає стару. Привʼязка до деталей —
 * у рядках деталей вище (поле «Файл виготовлення»).
 *
 * Файл можна додати лише до ЗБЕРЕЖЕНОЇ картки: сервер відмовить, якщо виробу ще немає в чорнетках.
 */
interface Props {
  kit: KitSpec;
  productId: string;
  onChange: (kit: KitSpec) => void;
  t: KitThemeTokens;
}

const ACCEPT = Object.keys(KIT_FILE_EXTENSIONS).map((e) => '.' + e).join(',');
const date = (iso: string) => (iso ? new Date(iso).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' }) : '');
const api = (productId: string, tail = '') => `/api/admin/furniture-products/${encodeURIComponent(productId)}/kit-files${tail}`;

export const KitFilesPanel: React.FC<Props> = ({ kit, productId, onChange, t }) => {
  const files = kit.files ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const newInput = useRef<HTMLInputElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const [versionFor, setVersionFor] = useState<string | null>(null);
  const total = useMemo(() => totalKitFileBytes(files), [files]);

  const call = async (job: () => Promise<Response>, apply: (data: any) => void) => {
    setBusy(true);
    setError(null);
    try {
      const res = await job();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося виконати дію.');
      apply(data);
    } catch (e: any) {
      setError(e?.message || 'Помилка.');
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File, fileId?: string) => {
    const qs = new URLSearchParams();
    if (fileId) qs.set('fileId', fileId);
    else if (newName.trim()) qs.set('name', newName.trim());
    return call(
      () =>
        fetch(api(productId) + (qs.toString() ? `?${qs}` : ''), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
          body: file,
        }),
      (data) => {
        onChange({ ...kit, files: data.files as KitFile[] });
        if (!fileId) setNewName('');
      },
    );
  };

  const rename = (id: string, name: string) =>
    call(
      () => fetch(api(productId, `/${encodeURIComponent(id)}`), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),
      (data) => {
        onChange({ ...kit, files: data.files as KitFile[] });
        setRenaming(null);
      },
    );

  const remove = (id: string) =>
    call(
      () => fetch(api(productId, `/${encodeURIComponent(id)}`), { method: 'DELETE', credentials: 'same-origin' }),
      () => {
        // Сервер скинув привʼязки деталей; те саме робимо в локальному стані, щоб не було «висячих» посилань.
        onChange({
          ...kit,
          files: files.filter((f) => f.id !== id),
          parts: kit.parts.map((p) => (p.fileId === id ? { ...p, fileId: '' } : p)),
          packaging: kit.packaging.map((p) => (p.fileId === id ? { ...p, fileId: '' } : p)),
        });
        setConfirmDelete(null);
      },
    );

  return (
    <div className="space-y-2" data-kit-files>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-bold uppercase tracking-wider flex items-center gap-1.5">
          <FileUp className="w-3.5 h-3.5" /> Файли для виготовлення
        </h3>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${t.badge}`}>
          {files.length} / {MAX_KIT_FILES} · {formatBytes(total)}
        </span>
      </div>
      <p className={`text-[11px] ${t.sub}`}>
        Креслення, DXF для різання, STL для друку. Файли приватні — на вітрину не потрапляють. Нова версія додається поруч зі старою. Деталі привʼязуються до файлів у полі «Файл виготовлення» вище.
      </p>

      {files.length === 0 && <p className={`text-[11px] ${t.sub}`} data-kit-files-empty>Файлів ще немає.</p>}

      {files.map((f) => {
        const last = latestVersion(f);
        const used = partsUsingFile(kit, f.id);
        const isRenaming = renaming?.id === f.id;
        return (
          <div key={f.id} className={`rounded-xl border p-3 space-y-2 ${t.divider}`} data-kit-file={f.id}>
            <div className="flex flex-wrap items-center gap-2">
              {isRenaming ? (
                <>
                  <input
                    className={`px-2 py-1 rounded-lg text-[12px] flex-1 min-w-[10rem] ${t.input}`}
                    value={renaming!.value}
                    maxLength={120}
                    onChange={(e) => setRenaming({ id: f.id, value: e.target.value })}
                    data-kit-file-rename-input
                  />
                  <button type="button" disabled={busy || !renaming!.value.trim()} onClick={() => rename(f.id, renaming!.value)} className={`px-2 py-1 rounded-lg text-[11px] font-semibold ${t.primaryBtn} disabled:opacity-40`}>
                    Зберегти назву
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} className={`px-2 py-1 rounded-lg text-[11px] ${t.ghostBtn}`}>
                    Скасувати
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[13px] font-semibold" data-kit-file-name>{f.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded border ${t.badge}`}>{KIT_FILE_KIND_LABELS[f.kind]}</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${t.badgeOk}`} data-kit-file-version>v{last.version}</span>
                  <button type="button" onClick={() => setRenaming({ id: f.id, value: f.name })} className={`p-1 rounded-lg ${t.ghostBtn}`} title="Перейменувати">
                    <Pencil className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
            <div className={`text-[11px] ${t.sub}`}>
              {last.fileName} · {formatBytes(last.bytes)} · {date(last.uploadedAt)}
              {last.note ? ` · ${last.note}` : ''}
            </div>
            <div className={`text-[11px] ${t.sub}`} data-kit-file-used>
              {used.length ? `Деталі: ${used.map((p) => p.name.trim() || 'без назви').join(', ')}` : 'Не привʼязано до жодної деталі.'}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={api(productId, `/${encodeURIComponent(f.id)}/download`)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${t.ghostBtn}`} data-kit-file-download>
                <Download className="w-3 h-3" /> Завантажити
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setVersionFor(f.id);
                  versionInput.current?.click();
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${t.ghostBtn} disabled:opacity-40`}
                data-kit-file-new-version
              >
                <Upload className="w-3 h-3" /> Нова версія
              </button>
              {f.versions.length > 1 && (
                <button type="button" onClick={() => setOpenHistory(openHistory === f.id ? null : f.id)} className={`px-2.5 py-1 rounded-lg text-[11px] flex items-center gap-1.5 ${t.ghostBtn}`}>
                  <History className="w-3 h-3" /> Версії ({f.versions.length})
                </button>
              )}
              {confirmDelete === f.id ? (
                <>
                  <button type="button" disabled={busy} onClick={() => remove(f.id)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${t.dangerBtn}`} data-kit-file-delete-confirm>
                    Точно видалити з усіма версіями
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(null)} className={`px-2.5 py-1 rounded-lg text-[11px] ${t.ghostBtn}`}>
                    Ні
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(f.id)} className={`p-1.5 rounded-lg ${t.dangerBtn}`} title="Видалити файл" data-kit-file-delete>
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
            {openHistory === f.id && (
              <ul className="space-y-1" data-kit-file-history>
                {[...f.versions].reverse().map((v) => (
                  <li key={v.id} className={`text-[11px] flex flex-wrap gap-2 ${t.sub}`}>
                    <b className="font-mono">v{v.version}</b>
                    <span>{v.fileName}</span>
                    <span>{formatBytes(v.bytes)}</span>
                    <span>{date(v.uploadedAt)}</span>
                    <a className="underline" href={api(productId, `/${encodeURIComponent(f.id)}/versions/${encodeURIComponent(v.id)}`)}>
                      завантажити
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <input
        ref={versionInput}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-kit-file-version-input
        onChange={(e) => {
          const file = e.target.files?.[0];
          const id = versionFor;
          e.target.value = '';
          if (file && id) void upload(file, id);
        }}
      />

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <input className={`px-2 py-1.5 rounded-lg text-[12px] ${t.input}`} placeholder="Назва (необовʼязково)" maxLength={120} value={newName} onChange={(e) => setNewName(e.target.value)} data-kit-file-new-name />
        <input ref={newInput} type="file" accept={ACCEPT} className="hidden" data-kit-file-input onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }} />
        <button type="button" disabled={busy || files.length >= MAX_KIT_FILES} onClick={() => newInput.current?.click()} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${t.primaryBtn} disabled:opacity-40`} data-kit-file-add>
          <Upload className="w-3.5 h-3.5" /> {busy ? 'Завантаження…' : 'Додати файл'}
        </button>
      </div>
      {error && <p className={`text-[11px] px-3 py-1.5 rounded-lg ${t.bannerErr}`} data-kit-files-error>{error}</p>}
    </div>
  );
};
