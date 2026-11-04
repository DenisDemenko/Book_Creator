import React, { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileBox,
  MessageSquareWarning,
  RefreshCw,
  Users,
} from 'lucide-react';
import { parseProjectDetails } from '../utils/projectDetails';

/**
 * «Модерація STEAM проектів» — черга команд і паспортів проєктів з маркетплейсу.
 *
 * Команди живуть у базі маркетплейсу, але рішення про них власник ухвалює тут
 * (так само, як про заявки продавців). Рядок черги — лише ознайомлення;
 * рішення приймається ПІСЛЯ розкриття повної картки: короткий і детальний опис,
 * склад, файли результатів і ВЕСЬ паспорт проєкту (опис, версії моделей). Бо
 * модерувати за назвою й фото неможливо.
 *
 * Три рішення:
 *   • Опублікувати;
 *   • Відхилити із зауваженнями — заявник виправляє ТУ САМУ команду й паспорт і
 *     подає повторно (нової команди не створює); без тексту зауважень не працює;
 *   • Відхилити остаточно — з причиною, команда лишається відхиленою.
 * Жодних правил тут немає: статуси й сповіщення заявнику виконує маркетплейс.
 */

type TeamStatus = 'pending' | 'changes_requested' | 'published' | 'rejected';

type TeamRow = {
  id: string;
  name: string;
  direction: string | null;
  description: string;
  status: TeamStatus;
  note: string | null;
  memberCount: number;
  resubmissions: number;
  createdAt: string;
  submittedAt: string;
  ownerName: string;
  ownerEmail: string;
  photoUrl: string | null;
  hasPassport: boolean;
};

type ModelVersion = {
  id: string;
  modelId: string;
  version: number;
  title: string;
  filename: string;
  format: string;
  sizeBytes: number;
  units: string;
  notes: string[];
  createdAt: string;
};

type TeamDetail = TeamRow & {
  details: string | null;
  members: { id: string; role: string; status: string; displayName: string; email: string }[];
  media: { id: string; kind: string; filename: string; mimeType: string; sizeBytes: number; url: string | null }[];
  passport: {
    title: string;
    description: string;
    details: string;
    status: string;
    revision: number;
    updatedAt: string;
    versions: ModelVersion[];
  } | null;
};

type Decision = 'approve' | 'reject' | 'request-changes';

const FILTERS: { value: TeamStatus | ''; label: string }[] = [
  { value: 'pending', label: 'На модерації' },
  { value: 'changes_requested', label: 'З зауваженнями' },
  { value: 'published', label: 'Опубліковано' },
  { value: 'rejected', label: 'Відхилено' },
  { value: '', label: 'Усі' },
];

const STATUS_LABEL: Record<TeamStatus, string> = {
  pending: 'На модерації',
  changes_requested: 'Повернено із зауваженнями',
  published: 'Опубліковано',
  rejected: 'Відхилено',
};

const STATUS_TONE: Record<TeamStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  changes_requested: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  published: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

const PASSPORT_STATUS_LABEL: Record<string, string> = {
  draft: 'Чернетка',
  in_progress: 'У роботі',
  completed: 'Завершено',
};

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

/** Довгий опис: текст у вузли React, без HTML — вставлений текст не стає розміткою. */
export const ProjectText: React.FC<{ text: string }> = ({ text }) => {
  const blocks = parseProjectDetails(text || '');
  if (blocks.length === 0) return <p className="text-xs text-slate-500">Не заповнено.</p>;
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-slate-200">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h5 key={index} className="pt-2 text-sm font-bold text-slate-100">
              {block.text}
            </h5>
          );
        }
        if (block.type === 'subheading') {
          return (
            <h6 key={index} className="pt-1 text-[13px] font-semibold text-slate-100">
              {block.text}
            </h6>
          );
        }
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List key={index} className={`space-y-0.5 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </List>
          );
        }
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
};

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="rounded-xl bg-slate-900/70 border border-slate-800 p-3.5">
    <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</h4>
    {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
    <div className="mt-2">{children}</div>
  </section>
);

/** Повна картка команди + рішення. */
const TeamReview: React.FC<{
  team: TeamRow;
  onDecided: (message: string) => void;
}> = ({ team, onDecided }) => {
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<null | 'request-changes' | 'reject'>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/marketplace-bridge/teams/${encodeURIComponent(team.id)}`, {
          credentials: 'same-origin',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Не вдалося прочитати команду (HTTP ${res.status}).`);
        if (alive) setDetail(data as TeamDetail);
      } catch (err: any) {
        if (alive) setError(err?.message || 'Помилка завантаження.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [team.id]);

  const decide = async (decision: Decision) => {
    const note = text.trim();
    if (decision !== 'approve' && !note) {
      setError(
        decision === 'request-changes'
          ? 'Напишіть зауваження: без них заявник не знатиме, що виправляти.'
          : 'Потрібна причина відхилення.'
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/marketplace-bridge/teams/${encodeURIComponent(team.id)}/${decision}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(decision === 'request-changes' ? { note } : decision === 'reject' ? { reason: note } : {}),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Не вдалося (HTTP ${res.status}).`);
      onDecided(
        decision === 'approve'
          ? `«${team.name}» опубліковано.`
          : decision === 'request-changes'
            ? `«${team.name}» повернено із зауваженнями — заявник виправить і подасть повторно.`
            : `«${team.name}» відхилено.`
      );
    } catch (err: any) {
      setError(err?.message || 'Помилка.');
    } finally {
      setBusy(false);
    }
  };

  if (!detail) {
    return (
      <div className="mt-3 text-xs text-slate-500">{error ? <span className="text-rose-300">{error}</span> : 'Завантажую повну картку…'}</div>
    );
  }

  const passport = detail.passport;
  const decidable = team.status === 'pending';

  return (
    <div className="mt-3 space-y-3" data-team-review={team.id}>
      {team.status !== 'pending' && team.note && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100 whitespace-pre-wrap">
          <p className="text-[10px] font-bold uppercase tracking-wide text-sky-300 mb-1">Остання примітка модератора</p>
          {team.note}
        </div>
      )}
      {team.status === 'pending' && team.resubmissions > 0 && team.note && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100 whitespace-pre-wrap">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-300 mb-1">
            Повторна подача №{team.resubmissions} — що просили виправити
          </p>
          {team.note}
        </div>
      )}

      <Section title="Короткий опис проєкту" hint="Те, що бачать у каталозі команд.">
        <p className="text-[13px] leading-relaxed text-slate-200 whitespace-pre-wrap">{detail.description}</p>
      </Section>

      <Section title="Детальний опис проєкту" hint="З форми створення команди.">
        <ProjectText text={detail.details || ''} />
      </Section>

      <Section
        title="Електронний паспорт проєкту"
        hint={
          passport
            ? `Редакція ${passport.revision} · оновлено ${shortDate(passport.updatedAt)} · ${
                PASSPORT_STATUS_LABEL[passport.status] || passport.status
              }`
            : undefined
        }
      >
        {passport ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-100">{passport.title}</p>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Короткий опис паспорта</p>
              <p className="text-[13px] leading-relaxed text-slate-200 whitespace-pre-wrap">
                {passport.description || 'Не заповнено.'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Детальний опис паспорта</p>
              <ProjectText text={passport.details} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                Файли моделей ({passport.versions.length})
              </p>
              {passport.versions.length === 0 ? (
                <p className="text-xs text-slate-500">Моделей ще не завантажено.</p>
              ) : (
                <ul className="space-y-1.5">
                  {passport.versions.map((version) => (
                    <li key={version.id} className="flex items-start gap-2 rounded-lg bg-slate-950/60 border border-slate-800 p-2">
                      <FileBox className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                      <div className="min-w-0 text-xs">
                        <p className="text-slate-200 font-semibold truncate">
                          {version.title} <span className="text-slate-500 font-normal">· v{version.version}</span>
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {version.filename} · {version.format.toUpperCase()} · {fileSize(version.sizeBytes)} · {version.units}
                          · {shortDate(version.createdAt)}
                        </p>
                        {version.notes.length > 0 && (
                          <p className="text-[10px] text-amber-300/80 mt-0.5">{version.notes.join('; ')}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Заявник ще не відкривав паспорт проєкту — додаткових матеріалів, крім опису команди, немає.
          </p>
        )}
      </Section>

      <Section title={`Склад команди (${detail.members.length})`}>
        <ul className="space-y-1">
          {detail.members.map((member) => (
            <li key={member.id} className="flex items-center gap-2 text-xs text-slate-300">
              <Users className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-semibold">{member.displayName}</span>
              <span className="text-slate-500">{member.email}</span>
              <span className="text-[10px] text-slate-500">
                {member.role === 'owner' ? 'керівник' : 'учасник'}
                {member.status === 'invited' ? ' · запрошення не прийнято' : member.status === 'declined' ? ' · відмовився' : ''}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {detail.media.length > 0 && (
        <Section title={`Результати роботи (${detail.media.length})`}>
          <div className="flex flex-wrap gap-2">
            {detail.media.map((asset) =>
              asset.mimeType.startsWith('image/') && asset.url ? (
                <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer" title={asset.filename}>
                  <img src={asset.url} alt={asset.filename} loading="lazy" className="h-20 w-28 rounded-lg object-cover border border-slate-800" />
                </a>
              ) : (
                <a
                  key={asset.id}
                  href={asset.url || undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-slate-950/60 border border-slate-800 px-2.5 py-1.5 text-[11px] text-slate-300 hover:text-white"
                >
                  {asset.filename} · {fileSize(asset.sizeBytes)}
                </a>
              )
            )}
          </div>
        </Section>
      )}

      {error && <div className="p-2.5 rounded-xl text-xs bg-rose-500/10 text-rose-300 border border-rose-500/30">{error}</div>}

      {decidable ? (
        <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3 space-y-2.5">
          <p className="text-[11px] text-slate-400">
            Рішення про «{team.name}». Заявник отримає сповіщення на маркетплейсі.
          </p>
          {compose && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-300" htmlFor={`team-note-${team.id}`}>
                {compose === 'request-changes'
                  ? 'Зауваження заявнику — що саме виправити (він побачить текст дослівно)'
                  : 'Причина остаточного відхилення'}
              </label>
              <textarea
                id={`team-note-${team.id}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                maxLength={2000}
                autoFocus
                className="w-full rounded-lg bg-slate-900 border border-slate-700 focus:border-sky-500 outline-none p-2.5 text-xs text-slate-100"
                placeholder={
                  compose === 'request-changes'
                    ? 'Наприклад: додайте схему електроніки й фото робота; у розділі 3 вкажіть бюджет…'
                    : 'Чому проєкт не може бути опублікований'
                }
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">{text.length} / 2000</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => {
                      setCompose(null);
                      setText('');
                      setError(null);
                    }}
                    disabled={busy}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-[11px] font-semibold"
                  >
                    Скасувати
                  </button>
                  <button
                    onClick={() => void decide(compose)}
                    disabled={busy || !text.trim()}
                    className={`px-3 py-1.5 rounded-lg text-white text-[11px] font-semibold disabled:opacity-50 ${
                      compose === 'request-changes' ? 'bg-sky-600 hover:bg-sky-500' : 'bg-rose-600 hover:bg-rose-500'
                    }`}
                  >
                    {compose === 'request-changes' ? 'Повернути із зауваженнями' : 'Відхилити остаточно'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {!compose && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => void decide('approve')}
                disabled={busy}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Опублікувати
              </button>
              <button
                onClick={() => setCompose('request-changes')}
                disabled={busy}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/40 border border-sky-500/40 text-sky-200 text-[11px] font-semibold disabled:opacity-50"
              >
                <MessageSquareWarning className="w-3.5 h-3.5" /> Відхилити із зауваженнями
              </button>
              <button
                onClick={() => setCompose('reject')}
                disabled={busy}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 text-[11px] font-semibold disabled:opacity-50"
              >
                <Ban className="w-3.5 h-3.5" /> Відхилити остаточно
              </button>
            </div>
          )}
        </div>
      ) : team.status === 'changes_requested' ? (
        <p className="text-[11px] text-sky-300">
          Команда повернута заявнику з зауваженнями. Вона знову зʼявиться в черзі «На модерації», коли він виправить і подасть повторно.
        </p>
      ) : null}
    </div>
  );
};

export const AdminTeamModeration: React.FC = () => {
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [status, setStatus] = useState<TeamStatus | ''>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const query = status ? `?status=${status}` : '';
      const res = await fetch(`/api/admin/marketplace-bridge/teams${query}`, { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося прочитати команди.');
      setRows(Array.isArray(data?.teams) ? data.teams : []);
    } catch (err: any) {
      setMessage({ tone: 'err', text: err?.message || 'Помилка завантаження.' });
      setRows([]);
    }
  }, [status]);

  useEffect(() => {
    setRows(null);
    setOpenId(null);
    void load();
  }, [load]);

  return (
    <div className="rounded-2xl bg-slate-900/60 border border-white/[0.06] p-5" data-team-moderation>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-400" /> Модерація STEAM проектів
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Команди та паспорти проєктів з маркетплейсу. Відкрийте рядок, щоб побачити все, що створив заявник, і лише
            тоді публікуйте, повертайте із зауваженнями або відхиляйте.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map((filter) => (
            <button
              key={filter.value || 'all'}
              onClick={() => setStatus(filter.value)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                status === filter.value ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {filter.label}
            </button>
          ))}
          <button
            onClick={() => {
              setMessage(null);
              void load();
            }}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400"
            title="Оновити"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`mt-3 p-2.5 rounded-xl text-xs ${
            message.tone === 'ok'
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {rows === null ? (
          <p className="text-xs text-slate-500">Завантаження…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-500">Черга порожня.</p>
        ) : (
          rows.map((row) => {
            const open = openId === row.id;
            return (
              <div key={row.id} className="rounded-xl bg-slate-950/50 border border-slate-800 p-3" data-team-row={row.id}>
                <div className="flex items-start gap-3">
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-800 border border-slate-700">
                    {row.photoUrl ? (
                      <img src={row.photoUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-[10px] text-slate-600">без фото</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-semibold text-slate-100">{row.name}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_TONE[row.status]}`}>
                        {STATUS_LABEL[row.status]}
                      </span>
                      {row.resubmissions > 0 && row.status === 'pending' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-violet-500/15 text-violet-300 border-violet-500/30">
                          повторна подача №{row.resubmissions}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {row.direction ? `${row.direction} · ` : ''}
                      {row.ownerName} ({row.ownerEmail}) · {row.memberCount} уч. · подано {shortDate(row.submittedAt)}
                      {row.hasPassport ? ' · є паспорт' : ' · паспорта ще немає'}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{row.description}</p>
                  </div>
                  <button
                    onClick={() => setOpenId(open ? null : row.id)}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/40 border border-sky-500/40 text-sky-200 text-[11px] font-semibold"
                    aria-expanded={open}
                  >
                    {open ? (
                      <>
                        Згорнути <ChevronUp className="w-3.5 h-3.5" />
                      </>
                    ) : (
                      <>
                        Переглянути паспорт і рішення <ChevronDown className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
                {open && (
                  <TeamReview
                    team={row}
                    onDecided={(text) => {
                      setMessage({ tone: 'ok', text });
                      setOpenId(null);
                      void load();
                    }}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
