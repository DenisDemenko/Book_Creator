/**
 * «Адмін панель» — окрема сторінка керування платформою.
 *
 * Дизайн заданий користувачем (макети 2a і 2b з Marketplace OS): темна
 * синя основа, вузькі великі літери заголовків, вузли-пігулки, кільцевий
 * хаб у центрі. Два режими:
 *
 *   • КАРТА (2a) — усі вузли одразу: що взагалі є в системі. Це вхідний
 *     екран, бо адміністратор здебільшого приходить не «у вкладку», а
 *     «розібратись, де що».
 *   • КОНСОЛЬ (2b) — обраний вузол: шари зліва, карта по центру,
 *     інспектор справа з живими показниками й кнопкою «Відкрити».
 *
 * Робочі панелі НЕ переписані: сторінка вбудовує наявний AdminPanelView у
 * керованому режимі (`chromeless`). Переписування тисячі рядків робочої
 * аналітики заради нової рамки коштувало б регресій там, де сьогодні все
 * працює.
 *
 * Шрифти Barlow / Barlow Condensed підвантажуються тут же: решта Nova
 * живе на іншій парі гарнітур, і тягнути їх у глобальний index.html
 * означало б вантажити всім авторам шрифти однієї адмінської сторінки.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, X, ArrowLeft, ExternalLink } from 'lucide-react';
import { AdminPanelView } from '../AdminPanelView';
import { ApiKeysView } from '../ApiKeysView';
import { ADMIN_NODES, ENTITY_BAND, findNode, type AdminNode } from './nodes';
import type { AuthUser } from '../../types';

/** Живі числа для інспектора: рівно ті, що вже віддають наявні адмінські маршрути. */
interface OsStats {
  users?: number;
  admins?: number;
  spendUsd?: number;
  generations?: number;
  revenueUah?: number;
  activeSubscribers?: number;
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

/** Пігулка вузла — основний елемент обох екранів (макет: border-radius 999px). */
const NodePill: React.FC<{
  node: AdminNode;
  active?: boolean;
  onClick: () => void;
  compact?: boolean;
}> = ({ node, active, onClick, compact }) => (
  <button
    onClick={onClick}
    title={node.description}
    className={`group relative flex w-full flex-col items-center gap-1 rounded-full border px-4 text-center transition-all ${
      compact ? 'py-2' : 'py-3.5'
    } ${
      active
        ? 'border-[#b5d9fd] bg-[rgba(148,188,227,.22)] shadow-[0_0_22px_rgba(116,157,196,.45)]'
        : 'border-[rgba(148,188,227,.42)] bg-[rgba(89,126,163,.13)] hover:border-[rgba(181,217,253,.8)] hover:bg-[rgba(89,126,163,.22)]'
    }`}
  >
    <span className={`${H} text-[11px] font-semibold uppercase tracking-[0.1em] text-[#eef6ff]`}>{node.title}</span>
    {!compact && <span className={`${B} text-[9.5px] leading-tight text-[rgba(214,235,255,.6)]`}>{node.hint}</span>}
  </button>
);

/** Плитка смуги «Памʼять і сутності» — не кнопка, а склад системи. */
const BandTile: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div className="flex flex-col items-center gap-1 rounded-full border border-[rgba(148,188,227,.3)] bg-[rgba(89,126,163,.09)] px-3 py-2.5 text-center">
    <span className={`${H} text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[#d6ebff]`}>{label}</span>
    {value && <span className={`${B} text-[10px] tabular-nums text-[rgba(181,217,253,.75)]`}>{value}</span>}
  </div>
);

export interface AdminOsViewProps {
  /** Потрібен розділу «Ключі API»: він показує, чий ключ і чи це гість. */
  authUser?: AuthUser | null;
}

export const AdminOsView: React.FC<AdminOsViewProps> = ({ authUser }) => {
  useAdminOsFonts();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [modal, setModal] = useState<'api-keys' | 'prompts' | null>(null);
  const [stats, setStats] = useState<OsStats>({});
  const [loading, setLoading] = useState(false);

  const active = findNode(activeId);

  /**
   * Показники беруться з тих самих маршрутів, що живлять старі вкладки.
   * Кожен запит обгорнутий окремо: адмінка не має темніти цілком через те,
   * що один із чотирьох ендпоінтів відповів помилкою.
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
    const [users, usage, revenue, engines, bridge] = await Promise.all([
      grab('/api/admin/users'),
      grab('/api/admin/usage?days=30'),
      grab('/api/admin/revenue?days=30'),
      grab('/api/ai/image-engines'),
      grab('/api/admin/marketplace-bridge'),
    ]);

    setStats({
      users: users?.users?.length,
      admins: users?.users?.filter((u: any) => u.role === 'admin').length,
      spendUsd: usage?.totals?.totalUsd,
      generations: usage?.totals?.successful,
      revenueUah: revenue?.totals?.revenueUah,
      activeSubscribers: revenue?.totals?.activeSubscribersCount,
      engines: engines?.engines
        ? { total: engines.engines.length, withKey: engines.engines.filter((e: any) => e.available).length }
        : undefined,
      bridgeConfigured: bridge ? Boolean(bridge.keySet && bridge.url) : undefined,
    });
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
          { label: 'Модулів ядра', value: '9' },
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
          { label: 'Ролей', value: '7' },
          { label: 'Прав у матриці', value: '6 на роль' },
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
      default:
        return [];
    }
  }, [active, stats]);

  const openNode = (node: AdminNode) => {
    if (node.action.kind === 'modal') {
      setModal(node.action.modal);
      setActiveId(node.id);
    } else {
      setActiveId(node.id);
    }
  };

  const coreNodes = ADMIN_NODES.filter((n) => n.group === 'core');
  const opsNodes = ADMIN_NODES.filter((n) => n.group === 'operations');

  return (
    <div className={`flex-1 overflow-y-auto bg-[#16232f] ${B} text-[#eef6ff]`}>
      {/* Шапка сторінки */}
      <div className="flex flex-wrap items-center gap-4 border-b border-[rgba(148,188,227,.25)] px-6 py-3">
        <span className={`${H} text-[15px] font-semibold uppercase tracking-[0.14em] text-[#eef6ff]`}>Nova · Адмін панель</span>
        <span className="font-mono text-[10px] tracking-[0.1em] text-[rgba(181,217,253,.75)]">
          {active ? `карта / ${active.title.toLowerCase()}` : 'карта системи · 8 вузлів'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {active && (
            <button
              onClick={() => setActiveId(null)}
              className={`${H} flex items-center gap-1.5 border border-[rgba(148,188,227,.35)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#d6ebff] transition-colors hover:bg-[rgba(89,126,163,.2)]`}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              До карти
            </button>
          )}
          <button
            onClick={() => void loadStats()}
            disabled={loading}
            className={`${H} flex items-center gap-1.5 border border-[rgba(148,188,227,.35)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#d6ebff] transition-colors hover:bg-[rgba(89,126,163,.2)] disabled:opacity-50`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Оновити
          </button>
        </div>
      </div>

      {!active ? (
        /* ---------------------------- КАРТА (2a) ---------------------------- */
        <div
          className="px-5 py-6"
          style={{ background: 'radial-gradient(60% 55% at 50% 40%, rgba(89,126,163,.22), transparent 70%)' }}
        >
          <div className="mx-auto max-w-[1120px]">
            {/* Верхній ряд */}
            <div className="mx-auto mb-4 grid max-w-[640px] grid-cols-1 gap-3.5 sm:grid-cols-3">
              {coreNodes.slice(0, 3).map((n) => (
                <NodePill key={n.id} node={n} onClick={() => openNode(n)} />
              ))}
            </div>

            {/* Бічні колонки + кільцевий хаб */}
            <div className="grid items-center gap-4 lg:grid-cols-[1fr_auto_1fr]">
              <div className="flex flex-col gap-3">
                {coreNodes.slice(3, 5).map((n) => (
                  <NodePill key={n.id} node={n} onClick={() => openNode(n)} />
                ))}
              </div>

              <div className="relative mx-auto grid h-[300px] w-[300px] place-items-center">
                <div className="absolute inset-0 rounded-full border border-[rgba(148,188,227,.25)]" />
                <div className="absolute inset-[26px] rounded-full border border-[rgba(148,188,227,.4)] shadow-[0_0_30px_rgba(116,157,196,.35)]" />
                <div className="absolute inset-[52px] rounded-full border border-dashed border-[rgba(148,188,227,.3)]" />
                <div className="px-10 text-center">
                  <div className={`${H} text-[30px] font-semibold uppercase leading-[1.02] tracking-[0.04em] text-white`}>
                    Ядро
                    <br />
                    Nova
                  </div>
                  <div className={`${B} mt-2 text-[10px] uppercase tracking-[0.14em] text-[rgba(181,217,253,.8)]`}>
                    {ADMIN_NODES.length} вузлів
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {coreNodes.slice(5).map((n) => (
                  <NodePill key={n.id} node={n} onClick={() => openNode(n)} />
                ))}
                {opsNodes.map((n) => (
                  <NodePill key={n.id} node={n} onClick={() => openNode(n)} />
                ))}
              </div>
            </div>

            {/* Смуга сутностей */}
            <div className="mt-5 border border-[rgba(148,188,227,.38)] bg-[rgba(89,126,163,.07)] p-3">
              <span className={`${H} mb-2.5 block text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b5d9fd]`}>
                Памʼять і сутності
              </span>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
                {ENTITY_BAND.map((e) => (
                  <BandTile
                    key={e.id}
                    label={e.label}
                    value={
                      e.id === 'users'
                        ? stats.users === undefined
                          ? undefined
                          : String(stats.users)
                        : e.id === 'subscriptions'
                          ? stats.activeSubscribers === undefined
                            ? undefined
                            : String(stats.activeSubscribers)
                          : undefined
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* --------------------------- КОНСОЛЬ (2b) --------------------------- */
        <div className="grid min-h-[520px] grid-cols-1 lg:grid-cols-[186px_1fr_302px]">
          {/* Шари й операції */}
          <div className="flex flex-col gap-1.5 border-b border-[rgba(148,188,227,.22)] p-3 lg:border-b-0 lg:border-r">
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

          {/* Робоча область: сама панель розділу */}
          <div
            className="min-w-0 p-4 lg:p-5"
            style={{
              background:
                'repeating-linear-gradient(0deg,transparent 0 39px,rgba(148,188,227,.07) 39px 40px),repeating-linear-gradient(90deg,transparent 0 39px,rgba(148,188,227,.07) 39px 40px)',
            }}
          >
            {active.action.kind === 'panel' ? (
              <AdminPanelView tab={active.action.tab} chromeless />
            ) : (
              <div className="grid h-full place-items-center py-16 text-center">
                <div className="max-w-sm">
                  <div className={`${H} text-[22px] font-semibold uppercase tracking-[0.05em] text-white`}>{active.title}</div>
                  <p className={`${B} mt-2 text-[12px] leading-relaxed text-[rgba(214,235,255,.62)]`}>{active.description}</p>
                  <button
                    onClick={() => setModal(active.action.kind === 'modal' ? active.action.modal : null)}
                    className={`${H} mt-4 inline-flex items-center gap-2 bg-[#597ea3] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#6b93b8]`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Відкрити
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Інспектор вузла */}
          <div className="flex flex-col gap-3 border-t border-[rgba(148,188,227,.22)] p-4 lg:border-l lg:border-t-0">
            <span className={`${H} text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[rgba(181,217,253,.7)]`}>
              Інспектор вузла
            </span>
            <span className={`${H} text-[24px] font-semibold uppercase leading-[1.05] tracking-[0.03em] text-white`}>
              {active.title}
            </span>
            <p className={`${B} text-[11.5px] leading-[1.5] text-[rgba(214,235,255,.62)]`}>{active.description}</p>

            <div className="flex flex-col border-t border-[rgba(148,188,227,.22)]">
              {inspectorRows.map((row) => (
                <div
                  key={row.label}
                  className={`${B} flex items-center justify-between gap-3 border-b border-[rgba(148,188,227,.13)] py-1.5 text-[11.5px] text-[rgba(238,246,255,.85)]`}
                >
                  <span>{row.label}</span>
                  <span className="tabular-nums text-[#b5d9fd]">{row.value}</span>
                </div>
              ))}
            </div>

            {active.action.kind === 'modal' && (
              <button
                onClick={() => setModal(active.action.kind === 'modal' ? active.action.modal : null)}
                className={`${H} mt-auto block w-full bg-[#597ea3] p-3 text-center text-[12px] font-semibold uppercase tracking-[0.1em] text-white transition-colors hover:bg-[#6b93b8]`}
              >
                Відкрити вузол
              </button>
            )}
          </div>
        </div>
      )}

      {/* ------------------------- Модальні вузли ------------------------- */}
      {modal && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col border border-[rgba(148,188,227,.35)] bg-[#1d2d3d] shadow-2xl">
            <div className="flex items-center gap-3 border-b border-[rgba(148,188,227,.25)] px-5 py-3">
              <span className={`${H} text-[14px] font-semibold uppercase tracking-[0.12em] text-[#eef6ff]`}>
                {modal === 'api-keys' ? 'Ключі API · платформні' : 'Промти ядра'}
              </span>
              <span className="font-mono text-[10px] text-[rgba(181,217,253,.65)]">
                {modal === 'api-keys' ? 'діють на всіх авторів' : 'конструктор інструкцій'}
              </span>
              <button
                onClick={() => setModal(null)}
                className="ml-auto p-1.5 text-[rgba(214,235,255,.7)] transition-colors hover:text-white"
                aria-label="Закрити"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {modal === 'api-keys' ? (
                <ApiKeysView authUser={authUser} />
              ) : (
                <div className="p-6">
                  <p className={`${B} text-[12.5px] leading-relaxed text-[rgba(214,235,255,.75)]`}>
                    Конструктор промтів відкривається кнопкою «Швидкий AI» у шапці Студії — вкладка «Ядро AI (адмін)».
                    Там же для кожного модуля задається модель, якою він працює.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
