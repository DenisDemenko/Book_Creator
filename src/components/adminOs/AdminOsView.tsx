/**
 * «Адмін панель» — окрема сторінка керування платформою.
 *
 * Дизайн заданий користувачем: темна синя основа, пігулки-вузли з
 * «електричною» рамкою, кільцевий хаб у центрі з провідниками до кожної
 * пігулки, смуга «Памʼять і сутності» внизу. Два режими:
 *
 *   • КАРТА — усі вузли одразу: що взагалі є в системі. Це вхідний екран,
 *     бо адміністратор здебільшого приходить не «у вкладку», а
 *     «розібратись, де що».
 *   • СТОРІНКА ВУЗЛА — обраний розділ: шари зліва, сам розділ по центру,
 *     інспектор справа з живими показниками.
 *
 * Робочі панелі НЕ переписані: сторінка вбудовує наявний AdminPanelView у
 * керованому режимі (`chromeless`), а для трьох вузлів, які досі були
 * заглушками, показує справжні екрани (`ApiKeysView`, `CoreAiPanel`,
 * `AdminModerationView`). Переписування тисячі рядків робочої аналітики
 * заради нової рамки коштувало б регресій там, де сьогодні все працює.
 *
 * Шрифти Barlow / Barlow Condensed підвантажуються тут же: решта Nova
 * живе на іншій парі гарнітур, і тягнути їх у глобальний index.html
 * означало б вантажити всім авторам шрифти однієї адмінської сторінки.
 *
 * «Сонечко» (аура, перетягуване сонце, вибір кольору) тут не чіпається:
 * воно глобальне й працює на цій сторінці так само, як на решті студії.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ArrowLeft } from 'lucide-react';
import { AdminPanelView } from '../AdminPanelView';
import { AdminModerationView } from '../AdminModerationView';
import { ApiKeysView } from '../ApiKeysView';
import { CoreAiPanel } from '../QuickAiModal';
import type { ChatModelOption } from '../QuickAiModal';
import { ADMIN_NODES, ENTITY_BAND, findNode, type AdminNode, type AdminView } from './nodes';
import fusionLabLogo from '../../assets/fusion-lab-studio-logo.png';
import { ALL_ROLES, getRolePermissions } from '../../utils/rbac';
import './adminOs.css';
import type { AuthUser } from '../../types';


/** Живі числа для інспектора: рівно ті, що вже віддають наявні адмінські маршрути. */
interface OsStats {
  users?: number;
  admins?: number;
  spendUsd?: number;
  generations?: number;
  revenueUah?: number;
  activeSubscribers?: number;
  paidPayments?: number;
  books?: number;
  listings?: number;
  coreModules?: number;
  engines?: { total: number; withKey: number };
  bridgeConfigured?: boolean;
}

const FONT_LINK_ID = 'nova-admin-os-fonts';

function useAdminOsFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);
}

const H = 'font-[\'Barlow_Condensed\',system-ui,sans-serif]';
const B = 'font-[\'Barlow\',system-ui,sans-serif]';

/**
 * Пігулка вузла — основний елемент карти й консолі.
 *
 * Рамка «електрична»: конічний градієнт обертається всередині рамки, а
 * яскравість циклічно наростає (класи `os-pill*` в `adminOs.css`). Червоний
 * варіант дістається вузлу з `tone: 'danger'` — це «Історія комітів», яка
 * працює лише при локальному запуску.
 */
const NodePill: React.FC<{
  node: AdminNode;
  active?: boolean;
  onClick: () => void;
  compact?: boolean;
}> = ({ node, active, onClick, compact }) => (
  <button
    type="button"
    onClick={onClick}
    title={`${node.title} — ${node.hint}`}
    aria-label={`${node.title}. ${node.hint}`}
    className={`os-pill w-full focus:outline-none ${node.tone === 'danger' ? 'os-pill--danger' : ''} ${
      active ? 'os-pill--active' : ''
    }`}
  >
    <span className={`os-pill-inner flex flex-col items-center gap-0.5 px-4 text-center ${compact ? 'py-2' : 'py-3'}`}>
      <span className={`${H} text-[11px] font-semibold uppercase tracking-[0.1em] text-[#eef6ff]`}>{node.title}</span>
      {!compact && <span className={`${B} text-[9.5px] leading-tight text-[rgba(214,235,255,.6)]`}>{node.hint}</span>}
    </span>
  </button>
);

/** Плитка смуги «Памʼять і сутності» — не кнопка, а склад системи. */
const BandTile: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div className="flex flex-col items-center justify-center gap-0.5 rounded-full border border-cyan-400/25 bg-[rgba(0,180,255,.06)] px-3 py-2 text-center">
    <span className={`${H} text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[#a8dcff]`}>{label}</span>
    <span className={`${B} text-[11px] font-bold tabular-nums text-cyan-300`}>{value ?? '—'}</span>
  </div>
);

export interface AdminOsViewProps {
  /** Потрібен розділу «Ключі API»: він показує, чий ключ і чи це гість. */
  authUser?: AuthUser | null;
}

export const AdminOsView: React.FC<AdminOsViewProps> = ({ authUser }) => {
  useAdminOsFonts();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [stats, setStats] = useState<OsStats>({});
  const [loading, setLoading] = useState(false);
  /**
   * Список моделей потрібен лише вузлу «Промти ядра»: там обирають, якою
   * моделлю працює кожен модуль, і тестують виклик. Беремо той самий
   * `/api/chat/models`, що й «Швидкий AI» — інакше два екрани показували б
   * різні списки моделей.
   */
  const [models, setModels] = useState<ChatModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');

  const active = findNode(activeId);

  /**
   * Показники беруться з тих самих маршрутів, що живлять старі вкладки.
   * Кожен запит обгорнутий окремо: адмінка не має темніти цілком через те,
   * що один із восьми ендпоінтів відповів помилкою.
   */
  const loadStats = useCallback(async () => {
    setLoading(true);
    const grab = async (url: string) => {
      try {
        const r = await fetch(url, { credentials: 'same-origin' });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    };
    const [users, usage, revenue, engines, bridge, crm, listings, core, chatModels] = await Promise.all([
      grab('/api/admin/users'),
      grab('/api/admin/usage?days=30'),
      grab('/api/admin/revenue?days=30'),
      grab('/api/ai/image-engines'),
      grab('/api/admin/marketplace-bridge'),
      grab('/api/admin/crm/users'),
      grab('/api/admin/marketplace-bridge/books'),
      grab('/api/ai/core-prompt-templates'),
      grab('/api/chat/models'),
    ]);

    setStats({
      users: users?.users?.length,
      admins: users?.users?.filter((u: any) => u.role === 'admin').length,
      spendUsd: usage?.totals?.totalUsd,
      generations: usage?.totals?.successful,
      revenueUah: revenue?.totals?.revenueUah,
      activeSubscribers: revenue?.totals?.activeSubscribersCount,
      paidPayments: revenue?.totals?.paidPaymentsCount,
      // Книг окремого маршруту немає — рахуємо те, що вже прийшло в CRM.
      books: crm?.users
        ? (crm.users as any[]).reduce((sum, u) => sum + (u?.stats?.booksCount || 0), 0)
        : undefined,
      // Міст не налаштований — перелік лістингів віддає помилку й приходить null.
      listings: listings?.books?.length,
      coreModules: core?.modules?.length,
      engines: engines?.engines
        ? { total: engines.engines.length, withKey: engines.engines.filter((e: any) => e.available).length }
        : undefined,
      bridgeConfigured: bridge ? Boolean(bridge.keySet && bridge.url) : undefined,
    });
    if (chatModels?.models) {
      setModels(chatModels.models);
      setSelectedModel((prev: string) => prev || chatModels.defaultModelId || chatModels.models[0]?.id || '');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  /** Рядки інспектора для конкретного вузла — лише реальні числа, без вигаданих. */
  const inspectorRows = useMemo((): { label: string; value: string }[] => {
    if (!active) return [];
    const n = (v: number | undefined, suffix = '') => (v === undefined ? '—' : `${v}${suffix}`);
    switch (active.id) {
      case 'providers':
        return [
          { label: 'Двигуни зображень', value: n(stats.engines?.total) },
          { label: 'З ключем', value: n(stats.engines?.withKey) },
          { label: 'Джерело ключів', value: 'платформні (адмін)' },
        ];
      case 'prompts':
        return [
          // Було вигадане «9»: модулів ядра насправді 19, і число тепер береться
          // з того самого реєстру, яким користується редактор промтів.
          { label: 'Модулів ядра', value: n(stats.coreModules) },
          { label: 'Редагує', value: 'лише адміністратор' },
          { label: 'Дія правки', value: 'негайна, на весь сайт' },
        ];
      case 'pricing':
        return [
          { label: 'Витрати за 30 днів', value: stats.spendUsd === undefined ? '—' : `$${stats.spendUsd.toFixed(4)}` },
          { label: 'Успішних генерацій', value: n(stats.generations) },
        ];
      case 'costs':
        return [
          { label: 'Витрати за 30 днів', value: stats.spendUsd === undefined ? '—' : `$${stats.spendUsd.toFixed(4)}` },
          { label: 'Генерацій', value: n(stats.generations) },
        ];
      case 'business':
        return [
          { label: 'Дохід за 30 днів', value: stats.revenueUah === undefined ? '—' : `${stats.revenueUah.toFixed(2)} ₴` },
          { label: 'Активних підписок', value: n(stats.activeSubscribers) },
        ];
      case 'users':
        return [
          { label: 'Акаунтів', value: n(stats.users) },
          { label: 'Адміністраторів', value: n(stats.admins) },
        ];
      case 'roles':
        return [
          // Обидва числа — з коду прав, а не з памʼяті: раніше стояли «7» і
          // «6 на роль», і обидва не мали джерела.
          { label: 'Ролей', value: String(ALL_ROLES.length) },
          { label: 'Прав у матриці', value: String(Object.keys(getRolePermissions('admin')).length) },
        ];
      case 'bridge':
        return [
          {
            label: 'Стан',
            value:
              stats.bridgeConfigured === undefined
                ? '—'
                : stats.bridgeConfigured
                  ? 'налаштовано'
                  : 'ключ не заданий',
          },
          { label: 'Формати товару', value: 'друк + електронний' },
        ];
      case 'moderation':
        return [
          { label: 'Черга', value: 'погодження публікацій' },
          { label: 'Що вирішує', value: 'ухвалити / відхилити' },
          { label: 'Лістингів у вітрині', value: n(stats.listings) },
        ];
      case 'git':
        return [
          { label: 'Джерело', value: 'живий git log' },
          { label: 'Працює', value: 'лише локально' },
        ];
      default:
        return [];
    }
  }, [active, stats]);

  /**
   * Вибір вузла. Модальних вузлів більше немає: кожен відкриває свою сторінку
   * (див. `NodeAction` у `nodes.ts`).
   */
  const openNode = (node: AdminNode) => setActiveId(node.id);

  /** Пігулки за місцем на карті — розкладка задана в реєстрі, а не порядком масиву. */
  const bySlot = (slot: AdminNode['slot']) => ADMIN_NODES.filter((n) => n.slot === slot);

  /** Шари консолі — те саме, але за призначенням розділу. */
  const coreNodes = ADMIN_NODES.filter((n) => n.group === 'core');
  const opsNodes = ADMIN_NODES.filter((n) => n.group === 'operations');

  /**
   * Який екран малює обраний вузол. Три вузли — самостійні сторінки: ключі API,
   * редактор промтів ядра й черга модерації. Решта — вкладки наявного
   * AdminPanelView, який для цього й отримав режим `chromeless`.
   */
  const renderView = (view: AdminView) => {
    if (view === 'api-keys') return <ApiKeysView authUser={authUser} />;
    if (view === 'moderation') return <AdminModerationView />;
    if (view === 'core-ai') {
      return (
        <CoreAiPanel
          models={models}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
        />
      );
    }
    return null;
  };

  /**
   * Числа смуги «Памʼять і сутності». `undefined` тут — не «нуль», а «джерело
   * не відповіло»: плитка тоді показує прочерк, а не вигадане нульове значення.
   * Лістинги порожні, коли міст не налаштований — це теж чесно видно.
   */
  const entityValues: Record<string, number | undefined> = {
    users: stats.users,
    books: stats.books,
    subscriptions: stats.activeSubscribers,
    payments: stats.paidPayments,
    keys: stats.engines?.withKey,
    prompts: stats.coreModules,
    usage: stats.generations,
    listings: stats.listings,
  };

  const systemOk = Boolean(stats.bridgeConfigured && stats.engines?.withKey);

  return (
    <div className={`os-map-bg flex-1 overflow-y-auto ${B} text-[#eef6ff]`}>
      {/* Шапка сторінки */}
      <div className="flex flex-wrap items-center gap-4 border-b border-cyan-400/20 px-6 py-3">
        <span className={`${H} text-[15px] font-black uppercase tracking-[0.16em] text-white`}>
          Fusion Lab Studio <span className="text-cyan-400">•</span> Адмін панель
        </span>
        <span className="font-mono text-[10px] tracking-[0.1em] text-[rgba(181,217,253,.75)]">
          {active ? `карта / ${active.title.toLowerCase()}` : `карта системи · ${ADMIN_NODES.length} вузлів`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/*
            Стан системи — не прикраса: «активна» означає, що міст до вітрини
            налаштований і хоч один двигун має ключ. Обидві умови беруться з
            живих маршрутів, тому бейдж не може збрехати.
          */}
          <span
            className={`hidden items-center gap-2 rounded-full border px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] sm:inline-flex ${
              systemOk
                ? 'border-cyan-400/50 bg-[#0d1b2d] text-cyan-300 shadow-[0_0_15px_rgba(0,210,255,0.25)]'
                : 'border-rose-500/50 bg-[#22121a] text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${systemOk ? 'animate-ping bg-emerald-400' : 'bg-rose-400'}`} />
            {systemOk ? 'Система активна' : 'Потребує уваги'}
          </span>
          {active && (
            <button
              onClick={() => setActiveId(null)}
              className={`${H} flex items-center gap-1.5 rounded-full border border-cyan-400/35 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#d6ebff] transition-colors hover:bg-cyan-400/10`}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              До карти
            </button>
          )}
          <button
            onClick={() => void loadStats()}
            disabled={loading}
            className={`${H} flex items-center gap-1.5 rounded-full border border-cyan-400/35 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#d6ebff] transition-colors hover:bg-cyan-400/10 disabled:opacity-50`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Оновити
          </button>
        </div>
      </div>

      {!active ? (
        /* ------------------------------ КАРТА ------------------------------ */
        <div className="px-5 py-8">
          <div className="relative mx-auto max-w-[1180px]">
            {/*
              Провідники малюються ПІД пігулками одним SVG-шаром. Координати
              привʼязані до тієї самої сітки, що й пігулки (3 зверху, по 4 в
              бічних колонках), тому лінії сходяться до ядра, а не «десь».
              Нижче lg шару немає: на вузькому екрані лінії вели б у порожнечу.
            */}
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 hidden h-full w-full lg:block"
              viewBox="0 0 1200 620"
              preserveAspectRatio="none"
            >
              <defs>
                <radialGradient id="osHubGlow" cx="50%" cy="48%" r="50%">
                  <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.32" />
                  <stop offset="60%" stopColor="#0066cc" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="#080d14" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx="600" cy="300" fill="url(#osHubGlow)" r="240" />
              <circle className="os-circuit os-circuit-pulse" cx="600" cy="300" fill="none" r="130" strokeDasharray="4 4" strokeOpacity="0.35" />
              <circle className="os-circuit" cx="600" cy="300" fill="none" r="185" strokeOpacity="0.25" />
              {/* Ліва колонка */}
              <path className="os-circuit" d="M 500 240 C 430 240, 390 90, 300 90" />
              <path className="os-circuit" d="M 495 285 C 410 285, 370 230, 300 230" />
              <path className="os-circuit" d="M 495 320 C 420 320, 370 370, 300 370" />
              <path className="os-circuit" d="M 505 365 C 440 365, 380 510, 300 510" />
              {/* Правий бік */}
              <path className="os-circuit" d="M 700 240 C 770 240, 810 90, 900 90" />
              <path className="os-circuit" d="M 705 285 C 790 285, 830 230, 900 230" />
              <path className="os-circuit" d="M 705 320 C 780 320, 830 370, 900 370" />
              <path className="os-circuit" d="M 695 365 C 760 365, 820 510, 900 510" />
              {/* Верхній ряд */}
              <path className="os-circuit" d="M 570 210 C 540 150, 480 60, 380 45" />
              <path className="os-circuit" d="M 600 200 L 600 40" />
              <path className="os-circuit" d="M 630 210 C 660 150, 720 60, 820 45" />
            </svg>

            <div className="relative z-10">
              {/* Верхній ряд: три вузли ядра */}
              <div className="mx-auto mb-5 grid max-w-[760px] grid-cols-1 gap-4 sm:grid-cols-3">
                {bySlot('top').map((n) => (
                  <NodePill key={n.id} node={n} onClick={() => openNode(n)} />
                ))}
              </div>

              {/* Бічні колонки + кільцевий хаб */}
              <div className="grid items-center gap-4 lg:grid-cols-[1fr_auto_1fr]">
                <div className="flex flex-col gap-3.5">
                  {bySlot('left').map((n) => (
                    <NodePill key={n.id} node={n} onClick={() => openNode(n)} />
                  ))}
                </div>

                {/* Ядро: дві обертові дуги, пульсуюче кільце, лого й назва. */}
                <div className="relative mx-auto grid h-[320px] w-[320px] place-items-center">
                  <div className="os-arc-spin pointer-events-none absolute h-[300px] w-[300px] rounded-full border border-dashed border-cyan-400/30" />
                  <div className="os-arc-rev pointer-events-none absolute h-[345px] w-[345px] rounded-full border-r border-t-2 border-transparent border-t-cyan-300/60 border-r-cyan-400/40" />
                  <div className="os-core-pulse relative flex h-[260px] w-[260px] items-center justify-center rounded-full border border-cyan-300/70 bg-gradient-to-b from-[#0e2744] via-[#091729] to-[#040b14] shadow-[0_0_50px_rgba(0,180,255,0.35),inset_0_0_35px_rgba(0,210,255,0.4)]">
                    <div className="px-8 text-center">
                      <img
                        src={fusionLabLogo}
                        alt=""
                        className="mx-auto mb-2 h-12 w-12 rounded-xl object-contain drop-shadow-[0_0_14px_rgba(0,210,255,0.85)]"
                      />
                      <div className={`${H} text-[26px] font-black uppercase leading-none tracking-[0.12em] text-white`}>
                        Ядро
                      </div>
                      <div className={`${B} mt-1 text-[13px] font-extrabold tracking-wide text-[#eef6ff]`}>Fusion Lab</div>
                      <div className={`${B} text-[11px] font-bold tracking-wider text-cyan-300`}>Studio</div>
                      <div className={`${B} mt-2 text-[9.5px] uppercase tracking-[0.14em] text-[rgba(181,217,253,.8)]`}>
                        {ADMIN_NODES.length} вузлів
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3.5">
                  {bySlot('right').map((n) => (
                    <NodePill key={n.id} node={n} onClick={() => openNode(n)} />
                  ))}
                </div>
              </div>
            </div>

            {/* Смуга сутностей */}
            <div className="relative z-10 mt-7 rounded-3xl border border-cyan-500/35 bg-[#09111c]/90 p-4 backdrop-blur-md shadow-[0_0_25px_rgba(0,180,255,0.1)] md:p-5">
              <span className={`${H} mb-3 block text-center text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#b5d9fd]`}>
                Памʼять і сутності
              </span>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
                {ENTITY_BAND.map((e) => (
                  <BandTile
                    key={e.id}
                    label={e.label}
                    value={entityValues[e.id] === undefined ? undefined : String(entityValues[e.id])}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* --------------------------- СТОРІНКА ВУЗЛА --------------------------- */
        <div className="grid min-h-[520px] grid-cols-1 lg:grid-cols-[186px_1fr_302px]">
          {/* Шари й операції */}
          <div className="flex flex-col gap-1.5 border-b border-cyan-400/20 p-3 lg:border-b-0 lg:border-r">
            <span className={`${H} px-1 pb-1.5 pt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[rgba(181,217,253,.7)]`}>
              Ядро
            </span>
            {coreNodes.map((n) => (
              <NodePill key={n.id} node={n} compact active={n.id === active.id} onClick={() => openNode(n)} />
            ))}
            <span className={`${H} px-1 pb-1.5 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[rgba(181,217,253,.7)]`}>
              Операції
            </span>
            {opsNodes.map((n) => (
              <NodePill key={n.id} node={n} compact active={n.id === active.id} onClick={() => openNode(n)} />
            ))}
          </div>

          {/*
            Робоча область: справжній екран розділу — жодних модалок-заглушок.
            `data-admin-work` — не прикраса: за ним живий прогін
            (scripts/live-adminMap.mts) знаходить саме цю колонку, щоб
            перевірити, ЩО показав розділ, а не «на сторінці щось є».
          */}
          <div className="min-w-0 p-4 lg:p-5" data-admin-work="1">
            {active.action.kind === 'panel' ? (
              <AdminPanelView tab={active.action.tab} chromeless />
            ) : (
              renderView(active.action.view)
            )}
          </div>

          {/* Інспектор вузла */}
          <div className="flex flex-col gap-3 border-t border-cyan-400/20 p-4 lg:border-l lg:border-t-0">
            <span className={`${H} text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[rgba(181,217,253,.7)]`}>
              Інспектор вузла
            </span>
            <span className={`${H} text-[24px] font-semibold uppercase leading-[1.05] tracking-[0.03em] text-white`}>
              {active.title}
            </span>
            <p className={`${B} text-[11.5px] leading-[1.5] text-[rgba(214,235,255,.62)]`}>{active.description}</p>

            <div className="flex flex-col border-t border-cyan-400/20">
              {inspectorRows.map((row) => (
                <div
                  key={row.label}
                  className={`${B} flex items-center justify-between gap-3 border-b border-cyan-400/10 py-1.5 text-[11.5px] text-[rgba(238,246,255,.85)]`}
                >
                  <span>{row.label}</span>
                  <span className="tabular-nums text-cyan-300">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
