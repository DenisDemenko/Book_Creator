/**
 * Вкладка «Публікація та експорт» — інтерфейс модуля KDP + Etsy.
 *
 * Екран навмисно розділений на чотири підвкладки, що повторюють чотири
 * підсистеми ТЗ, і різниця між ними принципова, а не косметична:
 *
 *   • «Amazon KDP» закінчується файлами й листом метаданих — офіційного API
 *     для публікації в KDP не існує, тож остання дія за автором;
 *   • «Etsy» доходить до кінця — до живого лістингу, бо Open API v3 це
 *     дозволяє;
 *   • «Набір курсу» — пакувальник, який має відпрацювати ДО публікації;
 *   • «Дослідження попиту» показує лише оцінні показники й прямо про це
 *     попереджає (вимога ТЗ 6.2: не вводити автора в оману словом «продажі»).
 *
 * Уся логіка платформи — на сервері. Тут немає ані ключів, ані токенів, ані
 * копії лімітів Etsy: обмеження приходять із /api/etsy/status, специфікація
 * KDP — із /api/publishing/kdp/spec. Це те саме рішення, що й у решті
 * проєкту: числа живуть в одному місці, екран лише показує їх.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileArchive,
  Info,
  Link2,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  Upload,
} from 'lucide-react';
import type { AuthUser, Book, NavigationTab } from '../types';
import { calculateWordCount, estimatePageCount } from '../utils/helpers';
import { useLanguage } from '../i18n/LanguageContext';

interface PublishingHubViewProps {
  book: Book;
  authUser: AuthUser | null;
  totalWords: number;
  onNavigateToTab: (tab: NavigationTab) => void;
}

type SubTab = 'kdp' | 'etsy' | 'bundle' | 'research' | 'vitryna';

interface Issue {
  severity: 'blocker' | 'warning';
  field: string;
  messageUk: string;
}

interface ProductFile {
  name: string;
  bytes: number;
  updatedAt: string;
}

interface Product {
  id: string;
  title: string;
  description: string;
  priceUsd: number;
  tags: string[];
  exportFiles: { bundleZip?: string };
}

interface Publication {
  id: string;
  productId: string;
  platform: 'kdp' | 'etsy';
  status: 'not_started' | 'files_ready' | 'draft' | 'published' | 'failed';
  externalUrl?: string;
  errorLog?: string;
}

interface PublishJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  step: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp'];

function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${bytes} Б`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error: any = new Error(data?.error || `Помилка ${res.status}`);
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data as T;
}

const IssueList: React.FC<{ issues: Issue[]; emptyLabel: string }> = ({ issues, emptyLabel }) => {
  if (!issues.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-300">
        <CheckCircle2 className="w-4 h-4" /> {emptyLabel}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {issues.map((issue, index) => (
        <li
          key={`${issue.field}-${index}`}
          className={`flex gap-2 text-sm rounded-lg px-3 py-2 border ${
            issue.severity === 'blocker'
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{issue.messageUk}</span>
        </li>
      ))}
    </ul>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="block text-xs uppercase tracking-wide text-slate-400 mb-1">{label}</span>
    {children}
  </label>
);

const inputClass =
  'w-full rounded-lg bg-slate-900/70 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500';

export const PublishingHubView: React.FC<PublishingHubViewProps> = ({
  book,
  authUser,
  totalWords,
  onNavigateToTab,
}) => {
  const { t } = useLanguage();
  const [tab, setTab] = useState<SubTab>('kdp');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1800);
      },
      () => undefined
    );
  }, []);

  const isGuest = !authUser?.id;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-100 flex items-center gap-2">
          <ShoppingBag className="w-6 h-6 text-cyan-400" /> {t('publishingHub.title')}
        </h1>
        <p className="text-slate-400 text-sm mt-1">{t('publishingHub.subtitle')}</p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {([
          ['kdp', t('publishingHub.tabKdp'), BookMarked],
          ['etsy', t('publishingHub.tabEtsy'), Store],
          ['bundle', t('publishingHub.tabBundle'), Package],
          ['research', t('publishingHub.tabResearch'), Search],
          ['vitryna', 'Вітрина Fusion Lab', Store],
        ] as [SubTab, string, React.ComponentType<{ className?: string }>][]).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm border transition ${
              tab === id
                ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200'
                : 'bg-slate-900/50 border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </nav>

      {isGuest && tab !== 'kdp' && (
        <p className="flex items-center gap-2 text-sm text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
          <Info className="w-4 h-4" /> {t('publishingHub.guestNote')}
        </p>
      )}

      {tab === 'kdp' && (
        <KdpPanel book={book} totalWords={totalWords} copy={copy} copiedKey={copiedKey} onNavigateToTab={onNavigateToTab} />
      )}
      {tab === 'etsy' && <EtsyPanel book={book} isGuest={isGuest} />}
      {tab === 'bundle' && <BundlePanel isGuest={isGuest} />}
      {tab === 'research' && <ResearchPanel copy={copy} copiedKey={copiedKey} isGuest={isGuest} />}
      {tab === 'vitryna' && <VitrynaPanel book={book} isGuest={isGuest} />}
    </div>
  );
};

// ===========================================================================
// Вітрина Fusion Lab — увесь конвеєр публікації однією дією
//
// Кнопки живуть саме тут, а не в адмінпанелі, з простої причини: книга
// зберігається в браузері (localStorage), а не на сервері, тож надіслати її
// може лише той екран, який її має. Адмінпанель книги не бачить.
// ===========================================================================

interface EditionResult {
  format: 'digital' | 'print';
  published?: { slug?: string; created?: boolean };
  attached?: { attached?: boolean };
  pdf?: { pageCount?: number; sizeBytes?: number };
  layout?: { variant?: string; noteUk?: string; trimId?: string; gutterMm?: number };
  warningsUk?: string[];
}

const VitrynaPanel: React.FC<{ book: Book; isGuest: boolean }> = ({ book, isGuest }) => {
  const [variant, setVariant] = useState<'code' | 'design'>('code');
  const [withPrint, setWithPrint] = useState(true);
  const [trimId, setTrimId] = useState('6x9');
  const [priceDigital, setPriceDigital] = useState('150');
  const [pricePrint, setPricePrint] = useState('390');
  // Той самий памʼятливий продавець, що й у панелі мосту: значення одне на
  // інсталяцію, а не на екран.
  const [sellerSlug, setSellerSlug] = useState(() => {
    try {
      return localStorage.getItem('nova_bridge_seller_slug') || 'fusion-lab';
    } catch {
      return 'fusion-lab';
    }
  });
  const [busy, setBusy] = useState<'' | 'preview' | 'publish'>('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EditionResult[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const preview = async (format: 'digital' | 'print') => {
    setBusy('preview');
    setError(null);
    setNote(null);
    try {
      const res = await fetch('/api/admin/pdf/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ book, variant, format, trimId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Перегляд не вдався (HTTP ${res.status}).`);
      }
      setNote(decodeURIComponent(res.headers.get('x-pdf-note') || ''));
      // Файл відкриваємо у вкладці: автор має побачити верстку до того,
      // як вона стане товаром.
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (err: any) {
      setError(err?.message || 'Помилка перегляду.');
    } finally {
      setBusy('');
    }
  };

  const publish = async () => {
    setBusy('publish');
    setError(null);
    setResult(null);
    try {
      const editions: Record<string, unknown>[] = [
        { format: 'digital', priceMinor: Math.round(Number(priceDigital) * 100), variant },
      ];
      if (withPrint) {
        editions.push({
          format: 'print',
          priceMinor: Math.round(Number(pricePrint) * 100),
          variant,
          trimId,
        });
      }
      const res = await fetch('/api/admin/pdf/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ book, sellerSlug: sellerSlug.trim() || undefined, editions }),
      });
      try {
        if (sellerSlug.trim()) localStorage.setItem('nova_bridge_seller_slug', sellerSlug.trim());
      } catch {
        // приватний режим — просто не запамʼятається
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Публікація не вдалася.');
      setResult(data.editions || []);
    } catch (err: any) {
      setError(err?.message || 'Помилка публікації.');
    } finally {
      setBusy('');
    }
  };

  if (isGuest) {
    return (
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-white/[0.06] text-sm text-slate-400">
        Публікація у вітрину доступна власнику книги після входу.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-white/[0.06] space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-100">Публікація у вітрину Fusion Lab</h3>
          <p className="text-[11px] text-slate-400 leading-snug mt-1">
            Складає PDF цієї книги і кладе його в каталог магазину разом із карткою товару.
            Електронна й друкована редакції — два сусідні лістинги: у маркетплейсі одна ціна на
            лістинг. Друкована верстається під Amazon KDP — інший обріз, дзеркальні поля,
            корінець за обсягом.
          </p>
        </div>

        <div>
          <span className="block text-[11px] font-semibold text-slate-300 mb-1">Хто вирішує макет</span>
          <div className="flex flex-wrap gap-2">
            {([
              ['code', 'Макет із книги', 'Бере налаштування «Верстки PDF»: формат, поля, кегль, нумерацію.'],
              ['design', 'Дизайн від моделі', 'Модель пропонує макет під жанр і обсяг; числа затискаються в читабельні межі.'],
            ] as const).map(([id, label, hint]) => (
              <button
                key={id}
                onClick={() => setVariant(id)}
                title={hint}
                className={`px-3 py-2 rounded-xl text-xs border transition ${
                  variant === id
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-300 mb-1">Ціна електронної, грн</span>
            <input
              value={priceDigital}
              onChange={(e) => setPriceDigital(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 outline-none focus:border-cyan-500/60 font-mono"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-300 mb-1">Продавець (slug)</span>
            <input
              value={sellerSlug}
              onChange={(e) => setSellerSlug(e.target.value)}
              placeholder="fusion-lab"
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 outline-none focus:border-cyan-500/60 font-mono"
            />
          </label>
        </div>

        <div className="rounded-xl border border-slate-800 p-3 space-y-3">
          <label className="flex items-center gap-2 text-xs text-slate-200">
            <input type="checkbox" checked={withPrint} onChange={(e) => setWithPrint(e.target.checked)} />
            Додати друковану редакцію (макет Amazon KDP)
          </label>
          {withPrint && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-300 mb-1">Ціна друкованої, грн</span>
                <input
                  value={pricePrint}
                  onChange={(e) => setPricePrint(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 outline-none focus:border-cyan-500/60 font-mono"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-300 mb-1">Обріз KDP</span>
                <select
                  value={trimId}
                  onChange={(e) => setTrimId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 outline-none focus:border-cyan-500/60"
                >
                  {['5x8', '5.5x8.5', '6x9', '7x10', '8.5x11'].map((id) => (
                    <option key={id} value={id}>{id.replace('x', ' × ')}″</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void preview('digital')}
            disabled={busy !== ''}
            className="px-4 py-2 rounded-xl bg-slate-800 text-slate-100 text-xs font-bold disabled:opacity-50"
          >
            {busy === 'preview' ? 'Складаю…' : 'Переглянути PDF'}
          </button>
          {withPrint && (
            <button
              onClick={() => void preview('print')}
              disabled={busy !== ''}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-100 text-xs font-bold disabled:opacity-50"
            >
              Переглянути макет KDP
            </button>
          )}
          <button
            onClick={() => void publish()}
            disabled={busy !== ''}
            className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold disabled:opacity-50"
          >
            {busy === 'publish' ? 'Публікую…' : 'Опублікувати у вітрину'}
          </button>
        </div>

        {note && (
          <p className="text-[11px] text-slate-400 border-l-2 border-slate-700 pl-3">{note}</p>
        )}
        {error && (
          <p className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px]">{error}</p>
        )}
      </div>

      {result && (
        <div className="space-y-3">
          {result.map((edition) => (
            <div key={edition.format} className="p-4 rounded-2xl bg-slate-900/60 border border-emerald-500/30 space-y-2">
              <p className="text-sm font-bold text-emerald-200">
                {edition.format === 'print' ? 'Друкована редакція (KDP)' : 'Електронна редакція'} —{' '}
                {edition.published?.created === false ? 'оновлено' : 'опубліковано'}
              </p>
              <p className="text-[11px] text-slate-300">
                Сторінок: {edition.pdf?.pageCount} · Розмір: {Math.round((edition.pdf?.sizeBytes || 0) / 1024)} КБ
                {edition.layout?.trimId ? ` · Обріз ${edition.layout.trimId}` : ''}
                {edition.layout?.gutterMm ? ` · Норма корінця ${edition.layout.gutterMm} мм` : ''}
                {edition.attached?.attached ? ' · Файл у лістингу' : ' · Файл НЕ прикріплено'}
              </p>
              {edition.published?.slug && (
                <a
                  href={`https://app.fusionlab.in.ua/uk/catalog/${edition.published.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-cyan-300 underline"
                >
                  /uk/catalog/{edition.published.slug}
                </a>
              )}
              {edition.layout?.noteUk && (
                <p className="text-[11px] text-slate-400 border-l-2 border-slate-700 pl-3">{edition.layout.noteUk}</p>
              )}
              {(edition.warningsUk || []).map((w) => (
                <p key={w} className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                  {w}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ===========================================================================
// Підсистема 1 — Amazon KDP
// ===========================================================================

interface KdpSpec {
  trimSizes: { id: string; label: string; required: boolean; noteUk: string }[];
  minPageCount: number;
  maxPageCount: number;
  maxDescriptionChars: number;
  keywordSlots: number;
  minCoverDpi: number;
  noteUk: string;
}

const KdpPanel: React.FC<{
  book: Book;
  totalWords: number;
  copy: (text: string, key: string) => void;
  copiedKey: string | null;
  onNavigateToTab: (tab: NavigationTab) => void;
}> = ({ book, totalWords, copy, copiedKey, onNavigateToTab }) => {
  const { t } = useLanguage();
  const [spec, setSpec] = useState<KdpSpec | null>(null);
  const [trimId, setTrimId] = useState('6x9');
  const [paper, setPaper] = useState<'white' | 'cream' | 'color'>('white');
  const [cover, setCover] = useState<any>(null);
  const [validation, setValidation] = useState<{ ok: boolean; issues: Issue[] } | null>(null);
  const [sheet, setSheet] = useState<{ text: string; issues: Issue[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Кількість сторінок беремо з тих самих налаштувань верстки, що й решта
  // проєкту, — щоб корінець на цій вкладці не розходився з макетом
  // у «Верстці».
  const estimatedPages = useMemo(
    () =>
      estimatePageCount(
        totalWords,
        book.layoutConfig?.formatPreset || '6x9',
        book.layoutConfig?.typography?.fontSizePt || 11,
        book.layoutConfig?.typography?.lineHeight || 1.5
      ),
    [totalWords, book.layoutConfig]
  );
  const [pageCount, setPageCount] = useState(estimatedPages);
  useEffect(() => setPageCount(estimatedPages), [estimatedPages]);

  const [subtitle, setSubtitle] = useState(book.subtitle || '');
  const [description, setDescription] = useState(book.synopsis || '');
  const [keywords, setKeywords] = useState('');
  const [bisac, setBisac] = useState('');

  useEffect(() => {
    api<KdpSpec>('/api/publishing/kdp/spec')
      .then(setSpec)
      .catch(() => setSpec(null));
  }, []);

  useEffect(() => {
    if (!pageCount) return;
    let cancelled = false;
    api('/api/publishing/kdp/cover-spec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trimId, pageCount, paper }),
    })
      .then((data) => !cancelled && setCover(data))
      .catch(() => !cancelled && setCover(null));
    return () => {
      cancelled = true;
    };
  }, [trimId, pageCount, paper]);

  /**
   * Рівні заголовків збираються з реальної структури книги: глава — рівень 1,
   * розділ — рівень 2. Саме цю послідовність перевіряє сервер на «дірки».
   */
  const headingLevels = useMemo(() => {
    const levels: number[] = [];
    for (const chapter of book.chapters || []) {
      levels.push(1);
      for (const _section of chapter.sections || []) levels.push(2);
    }
    return levels;
  }, [book.chapters]);

  const emptyChapters = useMemo(
    () =>
      (book.chapters || [])
        .filter((chapter) =>
          (chapter.sections || []).every((section) => calculateWordCount(section.content || '') === 0)
        )
        .map((chapter) => chapter.title),
    [book.chapters]
  );

  const runValidation = async () => {
    setBusy(true);
    setError(null);
    try {
      setValidation(
        await api('/api/publishing/kdp/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageCount,
            wordCount: totalWords,
            hasTableOfContents: Boolean(book.layoutConfig?.tocConfig),
            headingLevels,
            emptyChapters,
            trimId,
          }),
        })
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const buildSheet = async () => {
    setBusy(true);
    setError(null);
    try {
      setSheet(
        await api('/api/publishing/kdp/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: book.title,
            subtitle,
            authorName: book.author,
            description,
            keywords: keywords.split('\n').map((k) => k.trim()).filter(Boolean),
            bisacCategories: bisac.split('\n').map((b) => b.trim()).filter(Boolean),
            language: book.language,
            trimId,
            pageCount,
            paper,
          }),
        })
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Info className="w-4 h-4 text-cyan-400" /> {t('publishingHub.kdpIntroTitle')}
        </h2>
        <p className="text-sm text-slate-400 mt-2">{t('publishingHub.kdpIntroText')}</p>
        <p className="text-xs text-slate-500 mt-2">{t('publishingHub.kdpExportHint')}</p>
        <button onClick={() => onNavigateToTab('export')} className="text-cyan-400 text-sm mt-2 hover:underline">
          {t('publishingHub.kdpGoToExport')}
        </button>
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('publishingHub.kdpTrim')}>
            <select className={inputClass} value={trimId} onChange={(e) => setTrimId(e.target.value)}>
              {(spec?.trimSizes || []).map((size) => (
                <option key={size.id} value={size.id}>
                  {size.label}
                  {size.required ? ' ★' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('publishingHub.kdpPages')}>
            <input
              type="number"
              className={inputClass}
              value={pageCount}
              min={1}
              onChange={(e) => setPageCount(Number(e.target.value) || 0)}
            />
          </Field>
          <Field label={t('publishingHub.kdpPaper')}>
            <select className={inputClass} value={paper} onChange={(e) => setPaper(e.target.value as any)}>
              <option value="white">{t('publishingHub.kdpPaperWhite')}</option>
              <option value="cream">{t('publishingHub.kdpPaperCream')}</option>
              <option value="color">{t('publishingHub.kdpPaperColor')}</option>
            </select>
          </Field>
        </div>

        {cover && (
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-3">
              <div className="text-xs uppercase text-slate-500">{t('publishingHub.kdpSpine')}</div>
              <div className="text-slate-100 text-lg">
                {cover.spineMm} мм <span className="text-slate-500 text-sm">({cover.spineInches}″)</span>
              </div>
            </div>
            <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-3">
              <div className="text-xs uppercase text-slate-500">{t('publishingHub.kdpCoverCanvas')}</div>
              <div className="text-slate-100">
                {cover.widthMm} × {cover.heightMm} мм
              </div>
              <div className="text-slate-500 text-xs">
                {cover.widthPx} × {cover.heightPx} px · {cover.dpi} dpi · {t('publishingHub.kdpColorProfileValue')}
              </div>
            </div>
            <p className="sm:col-span-2 text-xs text-slate-500">{cover.noteUk}</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">{t('publishingHub.kdpValidateTitle')}</h2>
        <button
          onClick={runValidation}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/15 border border-cyan-500/40 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {t('publishingHub.kdpValidateBtn')}
        </button>
        {validation && (
          <IssueList
            issues={validation.issues}
            emptyLabel={t('publishingHub.kdpValidatePassed')}
          />
        )}
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-4">
        <h2 className="text-sm font-semibold text-slate-200">{t('publishingHub.kdpMetadataTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('publishingHub.kdpSubtitleField')}>
            <input className={inputClass} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
          </Field>
          <Field label={t('publishingHub.kdpKeywords')}>
            <textarea
              className={`${inputClass} h-24`}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={`1…${spec?.keywordSlots || 7}`}
            />
          </Field>
          <Field label={t('publishingHub.kdpDescription')}>
            <textarea
              className={`${inputClass} h-32`}
              value={description}
              maxLength={spec?.maxDescriptionChars || 4000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label={t('publishingHub.kdpBisac')}>
            <textarea className={`${inputClass} h-32`} value={bisac} onChange={(e) => setBisac(e.target.value)} />
          </Field>
        </div>
        <button
          onClick={buildSheet}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/15 border border-cyan-500/40 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookMarked className="w-4 h-4" />}
          {t('publishingHub.kdpBuildSheet')}
        </button>

        {sheet && (
          <div className="space-y-3">
            <IssueList issues={sheet.issues} emptyLabel={t('publishingHub.noIssues')} />
            <div className="relative">
              <pre className="whitespace-pre-wrap text-xs text-slate-300 bg-slate-950/70 border border-slate-800 rounded-lg p-4 max-h-96 overflow-auto">
                {sheet.text}
              </pre>
              <button
                onClick={() => copy(sheet.text, 'kdp-sheet')}
                className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-slate-800/90 border border-slate-600 px-2 py-1 text-xs text-slate-200"
              >
                <Copy className="w-3 h-3" />
                {copiedKey === 'kdp-sheet' ? t('publishingHub.copied') : t('publishingHub.copy')}
              </button>
            </div>
          </div>
        )}
      </section>

      {error && <p className="text-sm text-rose-300">{error}</p>}
    </div>
  );
};

// ===========================================================================
// Спільне: товар і його файли (використовується Etsy-панеллю й пакувальником)
// ===========================================================================

function useProduct(book: Book, isGuest: boolean) {
  const [product, setProduct] = useState<Product | null>(null);
  const [files, setFiles] = useState<ProductFile[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(!isGuest);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (isGuest) return;
    setLoading(true);
    try {
      const data = await api<{ products: Product[]; publications: Publication[] }>('/api/publishing/products');
      const current = data.products[0] || null;
      setProduct(current);
      setPublications(data.publications || []);
      if (current) {
        const detail = await api<{ files: ProductFile[] }>(`/api/publishing/products/${current.id}`);
        setFiles(detail.files || []);
      } else {
        setFiles([]);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isGuest]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(async () => {
    const created = await api<{ product: Product }>('/api/publishing/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: book.title || 'Новий товар',
        description: book.synopsis || '',
        bookId: book.id,
        type: book.course ? 'course' : 'book',
        priceUsd: 9.99,
      }),
    });
    setProduct(created.product);
    await reload();
  }, [book, reload]);

  return { product, files, publications, loading, error, reload, create, setProduct };
}

async function uploadFile(productId: string, file: File): Promise<void> {
  // Сирі байти, а не base64: 20 МБ у base64 перетворилися б на 27 МБ тексту.
  const res = await fetch(`/api/publishing/products/${productId}/files`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `Не вдалося завантажити «${file.name}».`);
  }
}

const FileRow: React.FC<{
  file: ProductFile;
  checked: boolean;
  onToggle: () => void;
  onDelete?: () => void;
}> = ({ file, checked, onToggle, onDelete }) => (
  <li className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm">
    <input type="checkbox" checked={checked} onChange={onToggle} className="accent-cyan-500" />
    <span className="flex-1 text-slate-200 truncate">{file.name}</span>
    <span className="text-slate-500 text-xs">{formatBytes(file.bytes)}</span>
    {onDelete && (
      <button onClick={onDelete} className="text-slate-500 hover:text-rose-300" title="Видалити">
        <Trash2 className="w-4 h-4" />
      </button>
    )}
  </li>
);

// ===========================================================================
// Підсистема 2 — Etsy
// ===========================================================================

interface EtsyStatus {
  configured: boolean;
  cryptoConfigured: boolean;
  connected?: boolean;
  reasonUk?: string;
  shopName?: string;
  shopId?: string;
  limits: { maxFiles: number; maxFileBytes: number; maxTags: number; allowedExtensions: string[] };
}

const EtsyPanel: React.FC<{ book: Book; isGuest: boolean }> = ({ book, isGuest }) => {
  const { t } = useLanguage();
  const { product, files, publications, reload, create } = useProduct(book, isGuest);
  const [status, setStatus] = useState<EtsyStatus | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [activate, setActivate] = useState(true);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [job, setJob] = useState<PublishJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('9.99');
  const [tags, setTags] = useState('');

  useEffect(() => {
    if (!product) return;
    setTitle(product.title);
    setDescription(product.description);
    setPrice(String(product.priceUsd));
    setTags(product.tags.join(', '));
    setSelectedFiles(product.exportFiles?.bundleZip ? [product.exportFiles.bundleZip] : []);
  }, [product]);

  const loadStatus = useCallback(() => {
    api<EtsyStatus>('/api/etsy/status').then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(loadStatus, [loadStatus]);

  // Після OAuth Etsy повертає автора на головну з ?etsy=ok|error — знімаємо
  // параметр із адреси, щоб він не «залипав» на весь сеанс.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('etsy');
    if (!result) return;
    setNotice(result === 'ok' ? t('publishingHub.etsyConnected') : params.get('message') || 'Etsy');
    params.delete('etsy');
    params.delete('message');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    loadStatus();
  }, [loadStatus, t]);

  const etsyPublication = publications.find((p) => p.productId === product?.id && p.platform === 'etsy');

  // Поки задача в черзі — опитуємо її стан. Це навмисно опитування, а не
  // WebSocket: публікація триває десятки секунд, і одне звернення на 3 с
  // дешевше за окремий канал заради лічильника кроків.
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return;
    const timer = setInterval(async () => {
      try {
        const data = await api<{ job: PublishJob }>(`/api/publishing/jobs/${job.id}`);
        setJob(data.job);
        if (data.job.status === 'done' || data.job.status === 'failed') reload();
      } catch {
        /* тимчасова помилка опитування не має ламати екран */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [job, reload]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ url: string }>('/api/etsy/oauth/start', { method: 'POST' });
      window.open(data.url, '_blank', 'noopener');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await api('/api/etsy/connection', { method: 'DELETE' }).catch(() => undefined);
    loadStatus();
  };

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const list: File[] = Array.from(event.target.files || []);
    if (!list.length || !product) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of list) await uploadFile(product.id, file);
      await reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const payload = () => ({
    title,
    description,
    priceUsd: Number(price),
    tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
    fileNames: selectedFiles,
    imageNames: selectedImages,
    activate,
  });

  const validate = async () => {
    if (!product) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ issues: Issue[] }>(
        `/api/publishing/products/${product.id}/publish/etsy/validate`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) }
      );
      setIssues(data.issues);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!product) return;
    setBusy(true);
    setError(null);
    setIssues(null);
    try {
      // Зберігаємо поля товару перед публікацією, щоб чернетка й лістинг не
      // розійшлися, якщо автор правив текст просто тут.
      await api(`/api/publishing/products/${product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, priceUsd: Number(price), tags: payload().tags }),
      });
      const data = await api<{ job: PublishJob }>(`/api/publishing/products/${product.id}/publish/etsy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      setJob(data.job);
      setNotice(t('publishingHub.etsyPublishQueued'));
      reload();
    } catch (err: any) {
      setError(err.message);
      if (err.payload?.issues) setIssues(err.payload.issues);
    } finally {
      setBusy(false);
    }
  };

  const statusLabel: Record<Publication['status'], string> = {
    not_started: t('publishingHub.etsyStatusNotStarted'),
    files_ready: t('publishingHub.etsyStatusFilesReady'),
    draft: t('publishingHub.etsyStatusDraft'),
    published: t('publishingHub.etsyStatusPublished'),
    failed: t('publishingHub.etsyStatusFailed'),
  };

  const digitalFiles = files.filter((f) => !isImageName(f.name));
  const imageFiles = files.filter((f) => isImageName(f.name));

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        {status && !status.configured ? (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-amber-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {t('publishingHub.etsyNotConfigured')}
            </h2>
            <p className="text-sm text-slate-400">{status.reasonUk}</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-slate-300 flex items-center gap-2">
                <Store className="w-4 h-4 text-cyan-400" />
                {status?.connected
                  ? `${t('publishingHub.etsyShop')}: ${status.shopName || status.shopId || '—'}`
                  : t('publishingHub.etsyConnect')}
              </div>
              {status && (
                <p className="text-xs text-slate-500 mt-1">
                  {t('publishingHub.etsyLimits', {
                    files: status.limits.maxFiles,
                    size: formatBytes(status.limits.maxFileBytes),
                    tags: status.limits.maxTags,
                  })}
                </p>
              )}
            </div>
            {status?.connected ? (
              <button
                onClick={disconnect}
                className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:border-rose-500 hover:text-rose-300"
              >
                {t('publishingHub.etsyDisconnect')}
              </button>
            ) : (
              <button
                onClick={connect}
                disabled={busy || isGuest}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/15 border border-cyan-500/40 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
              >
                <Link2 className="w-4 h-4" /> {t('publishingHub.etsyConnect')}
              </button>
            )}
          </div>
        )}
        {notice && <p className="text-sm text-emerald-300">{notice}</p>}
      </section>

      {!isGuest && !product && (
        <button
          onClick={() => create().catch((err) => setError(err.message))}
          className="rounded-lg bg-cyan-500/15 border border-cyan-500/40 px-4 py-2 text-sm text-cyan-200"
        >
          {t('publishingHub.etsyCreateProduct')}
        </button>
      )}

      {product && (
        <>
          <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('publishingHub.etsyProductTitle')}>
                <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label={t('publishingHub.etsyPrice')}>
                <input className={inputClass} value={price} onChange={(e) => setPrice(e.target.value)} />
              </Field>
              <Field label={t('publishingHub.etsyProductDescription')}>
                <textarea
                  className={`${inputClass} h-28`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field label={t('publishingHub.etsyTags')}>
                <textarea className={`${inputClass} h-28`} value={tags} onChange={(e) => setTags(e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">{t('publishingHub.etsyFiles')}</h2>
              <div className="flex items-center gap-2">
                <input ref={fileInput} type="file" multiple onChange={onUpload} className="hidden" id="etsy-upload" />
                <label
                  htmlFor="etsy-upload"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 cursor-pointer hover:border-cyan-500"
                >
                  <Upload className="w-4 h-4" /> {t('publishingHub.etsyUpload')}
                </label>
                <button onClick={reload} className="text-slate-400 hover:text-slate-200" title={t('publishingHub.refresh')}>
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {files.length === 0 ? (
              <p className="text-sm text-slate-500">{t('publishingHub.etsyNoFiles')}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase text-slate-500 mb-2">{t('publishingHub.etsyFiles')}</p>
                  <ul className="space-y-2">
                    {digitalFiles.map((file) => (
                      <FileRow
                        key={file.name}
                        file={file}
                        checked={selectedFiles.includes(file.name)}
                        onToggle={() =>
                          setSelectedFiles((prev) =>
                            prev.includes(file.name) ? prev.filter((n) => n !== file.name) : [...prev, file.name]
                          )
                        }
                      />
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500 mb-2">{t('publishingHub.etsyImages')}</p>
                  <ul className="space-y-2">
                    {imageFiles.map((file) => (
                      <FileRow
                        key={file.name}
                        file={file}
                        checked={selectedImages.includes(file.name)}
                        onToggle={() =>
                          setSelectedImages((prev) =>
                            prev.includes(file.name) ? prev.filter((n) => n !== file.name) : [...prev, file.name]
                          )
                        }
                      />
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} className="accent-cyan-500" />
              {t('publishingHub.etsyActivate')}
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={validate}
                disabled={busy}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:border-cyan-500 disabled:opacity-50"
              >
                {t('publishingHub.etsyValidate')}
              </button>
              <button
                onClick={publish}
                disabled={busy || !status?.connected}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/20 border border-cyan-500/50 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingBag className="w-4 h-4" />}
                {t('publishingHub.etsyPublish')}
              </button>
            </div>

            {issues && <IssueList issues={issues} emptyLabel={t('publishingHub.noIssues')} />}
          </section>
        </>
      )}

      {(job || etsyPublication) && (
        <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-2 text-sm">
          <h2 className="text-sm font-semibold text-slate-200">{t('publishingHub.etsyPublications')}</h2>
          {etsyPublication && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">
                {statusLabel[etsyPublication.status]}
              </span>
              {etsyPublication.externalUrl && (
                <a
                  href={etsyPublication.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-cyan-400 hover:underline"
                >
                  {t('publishingHub.etsyOpenListing')} <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {etsyPublication.errorLog && <span className="text-rose-300">{etsyPublication.errorLog}</span>}
            </div>
          )}
          {job && (
            <p className="flex items-center gap-2 text-slate-400">
              <Clock className="w-4 h-4" />
              {t('publishingHub.etsyJobStep')}: {job.step} · {t('publishingHub.etsyJobAttempts')}: {job.attempts}/
              {job.maxAttempts}
              {job.lastError ? ` · ${job.lastError}` : ''}
            </p>
          )}
        </section>
      )}

      {error && <p className="text-sm text-rose-300">{error}</p>}
    </div>
  );
};

// ===========================================================================
// Підсистема 3 — пакувальник
// ===========================================================================

const BundlePanel: React.FC<{ isGuest: boolean }> = ({ isGuest }) => {
  const { t } = useLanguage();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [files, setFiles] = useState<ProductFile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [accessLink, setAccessLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(async (id: string) => {
    if (!id) return;
    const detail = await api<{ files: ProductFile[] }>(`/api/publishing/products/${id}`);
    setFiles(detail.files || []);
    setSelected(detail.files.map((f) => f.name));
  }, []);

  useEffect(() => {
    if (isGuest) return;
    api<{ products: Product[] }>('/api/publishing/products')
      .then((data) => {
        setProducts(data.products);
        if (data.products[0]) {
          setProductId(data.products[0].id);
          loadFiles(data.products[0].id);
        }
      })
      .catch((err) => setError(err.message));
  }, [isGuest, loadFiles]);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      setAnalysis(
        await api(`/api/publishing/products/${productId}/bundle/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileNames: selected }),
        })
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<any>(`/api/publishing/products/${productId}/bundle/package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileNames: selected, accessLink: accessLink || undefined }),
      });
      setResult(data);
      setAnalysis(data.analysis);
      await loadFiles(productId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <FileArchive className="w-4 h-4 text-cyan-400" /> {t('publishingHub.bundleTitle')}
        </h2>
        <p className="text-sm text-slate-400">{t('publishingHub.bundleIntro')}</p>

        {products.length > 1 && (
          <Field label={t('publishingHub.etsyProduct')}>
            <select
              className={inputClass}
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                loadFiles(e.target.value);
              }}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div>
          <p className="text-xs uppercase text-slate-500 mb-2">{t('publishingHub.bundleSelect')}</p>
          <ul className="space-y-2">
            {files.map((file) => (
              <FileRow
                key={file.name}
                file={file}
                checked={selected.includes(file.name)}
                onToggle={() =>
                  setSelected((prev) =>
                    prev.includes(file.name) ? prev.filter((n) => n !== file.name) : [...prev, file.name]
                  )
                }
              />
            ))}
          </ul>
          {!files.length && <p className="text-sm text-slate-500">{t('publishingHub.etsyNoFiles')}</p>}
        </div>

        <Field label={t('publishingHub.bundleAccessLink')}>
          <input className={inputClass} value={accessLink} onChange={(e) => setAccessLink(e.target.value)} />
        </Field>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={analyze}
            disabled={busy || !productId || !selected.length}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:border-cyan-500 disabled:opacity-50"
          >
            {t('publishingHub.bundleAnalyze')}
          </button>
          <button
            onClick={build}
            disabled={busy || !productId || !selected.length}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/20 border border-cyan-500/50 px-4 py-2 text-sm text-cyan-100 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
            {t('publishingHub.bundlePackage')}
          </button>
        </div>
      </section>

      {analysis && (
        <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3 text-sm">
          <div className="flex flex-wrap gap-6">
            <div>
              <div className="text-xs uppercase text-slate-500">{t('publishingHub.bundleTotal')}</div>
              <div className="text-slate-100 text-lg">{formatBytes(analysis.totalBytes)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">{t('publishingHub.bundleScenario')}</div>
              <div className={analysis.recommendation.scenario === 'B' ? 'text-emerald-300' : 'text-amber-300'}>
                {analysis.recommendation.scenario === 'B'
                  ? t('publishingHub.bundleScenarioB')
                  : t('publishingHub.bundleScenarioA')}
              </div>
            </div>
          </div>
          <p className="text-slate-400">{analysis.recommendation.reasonUk}</p>
          {(analysis.warningsUk || []).map((warning: string, index: number) => (
            <p key={index} className="text-amber-200 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {warning}
            </p>
          ))}
        </section>
      )}

      {result && (
        <section className="rounded-xl border border-emerald-600/40 bg-emerald-500/10 p-4 text-sm space-y-2">
          <p className="text-emerald-200">{t('publishingHub.bundleReady', { name: result.file.name })}</p>
          <ul className="text-slate-300 text-xs space-y-1">
            {result.entries.map((entry: any) => (
              <li key={entry.path}>
                {entry.path} — {formatBytes(entry.bytes)}
              </li>
            ))}
          </ul>
          {(result.warningsUk || []).map((warning: string, index: number) => (
            <p key={index} className="text-amber-200 text-xs">
              {warning}
            </p>
          ))}
        </section>
      )}

      {error && <p className="text-sm text-rose-300">{error}</p>}
    </div>
  );
};

// ===========================================================================
// Підсистема 4 — дослідження попиту
// ===========================================================================

const ResearchPanel: React.FC<{
  copy: (text: string, key: string) => void;
  copiedKey: string | null;
  isGuest: boolean;
}> = ({ copy, copiedKey, isGuest }) => {
  const { t } = useLanguage();
  const [topic, setTopic] = useState('');
  const [result, setResult] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!topic.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<any>('/api/etsy/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });
      setResult(data);
      const trendData = await api<any>(`/api/etsy/research/trend?topic=${encodeURIComponent(topic)}`);
      setTrend(trendData.points || []);
    } catch (err: any) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const report = result?.report;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Search className="w-4 h-4 text-cyan-400" /> {t('publishingHub.researchTitle')}
        </h2>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Field label={t('publishingHub.researchTopic')}>
              <input
                className={inputClass}
                value={topic}
                placeholder="watercolor journal"
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
            </Field>
          </div>
          <button
            onClick={search}
            disabled={busy || isGuest}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/20 border border-cyan-500/50 px-4 py-2 text-sm text-cyan-100 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {t('publishingHub.researchSearch')}
          </button>
        </div>
        <p className="text-xs text-slate-500">{t('publishingHub.researchTopicHint')}</p>
      </section>

      {report && (
        <>
          {/* Застереження стоїть ПЕРЕД цифрами навмисно: воно має бути
              прочитане до того, як автор побудує на них рішення. */}
          <p className="flex gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" /> {report.disclaimerUk}
          </p>
          {result.fromCache && (
            <p className="text-xs text-slate-500">
              {t('publishingHub.researchFromCache', {
                date: new Date(report.collectedAt).toLocaleString('uk-UA'),
              })}
            </p>
          )}

          <section className="grid gap-3 sm:grid-cols-4 text-sm">
            {[
              [t('publishingHub.researchTotalActive'), report.totalActive],
              [t('publishingHub.researchAnalyzed'), report.listingCount],
              [t('publishingHub.researchAvgFavorers'), report.avgFavorers],
              [t('publishingHub.researchMedianPrice'), `$${report.medianPriceUsd}`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg bg-slate-950/60 border border-slate-800 p-3">
                <div className="text-xs uppercase text-slate-500">{label}</div>
                <div className="text-slate-100 text-lg">{value}</div>
              </div>
            ))}
          </section>

          <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">{t('publishingHub.researchTags')}</h3>
              <button
                onClick={() => copy(report.suggestedTags.join(', '), 'tags')}
                className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-cyan-300"
              >
                <Copy className="w-3 h-3" />
                {copiedKey === 'tags' ? t('publishingHub.copied') : t('publishingHub.researchCopyTags')}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {report.keywordCandidates.map((candidate: any) => (
                <span
                  key={candidate.tag}
                  title={`${candidate.listings} лістингів · тегом у ${candidate.asTag}`}
                  className="rounded-full bg-slate-800 border border-slate-700 px-3 py-1 text-xs text-slate-200"
                >
                  {candidate.tag}
                  <span className="text-slate-500"> · {candidate.listings}</span>
                </span>
              ))}
              {!report.keywordCandidates.length && (
                <span className="text-sm text-slate-500">{t('publishingHub.noIssues')}</span>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">
              {t('publishingHub.researchTopListings')}{' '}
              <span className="text-xs text-slate-500">({t('publishingHub.researchEstimateBadge')})</span>
            </h3>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left py-2">#</th>
                    <th className="text-left py-2">Title</th>
                    <th className="text-right py-2">{t('publishingHub.researchFavorers')}</th>
                    <th className="text-right py-2">{t('publishingHub.researchPrice')}</th>
                    <th className="text-right py-2">{t('publishingHub.researchPopularity')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topListings.map((listing: any, index: number) => (
                    <tr key={listing.listingId} className="border-t border-slate-800">
                      <td className="py-2 text-slate-500">{index + 1}</td>
                      <td className="py-2 text-slate-200">{listing.title}</td>
                      <td className="py-2 text-right text-slate-400">{listing.numFavorers}</td>
                      <td className="py-2 text-right text-slate-400">${listing.priceUsd}</td>
                      <td className="py-2 text-right text-cyan-300">{listing.popularity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">{t('publishingHub.researchTrend')}</h3>
            {trend.length > 1 ? (
              <ul className="text-sm text-slate-300 space-y-1">
                {trend.map((point) => (
                  <li key={point.collectedAt} className="flex justify-between border-b border-slate-800 py-1">
                    <span className="text-slate-500">{new Date(point.collectedAt).toLocaleDateString('uk-UA')}</span>
                    <span>
                      {point.totalActive} · ♥ {point.avgFavorers} · ${point.medianPriceUsd}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">{t('publishingHub.researchTrendEmpty')}</p>
            )}
          </section>
        </>
      )}

      {error && <p className="text-sm text-rose-300">{error}</p>}
    </div>
  );
};
