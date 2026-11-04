import React, { useMemo, useState } from 'react';
import { AlertTriangle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { KitFilesPanel } from './KitFilesPanel';
import { KitInstructionPanel } from './KitInstructionPanel';
import { KitSafetyEditor } from './KitSafetyEditor';
import {
  KIT_MATERIAL_MAX,
  KIT_NAME_MAX,
  KIT_SUPPLIER_MAX,
  KIT_UNITS,
  MAX_KIT_PACKAGING,
  MAX_KIT_PARTS,
  blankKit,
  blankKitLine,
  kitCost,
  kitIssues,
  kitPricePatch,
  type KitLine,
  type KitSpec,
} from './kitSpec';

/**
 * Секція «Набір» картки виробу (K1): специфікація деталей, пакування, робота,
 * собівартість і рекомендована ціна. Підсумки рахуються на льоту з даних, які
 * тут же редагуються (`kitCost`), тож зміна ціни деталі одразу видна в наборі.
 *
 * Тема й кнопки приходять із редактора виробу (`t`): секція не має власних
 * кольорів, щоб день/ніч працювали так само, як в інших секціях картки.
 */

export interface KitThemeTokens {
  input: string;
  select: string;
  ghostBtn: string;
  primaryBtn: string;
  dangerBtn: string;
  sub: string;
  badge: string;
  badgeOk: string;
  bannerErr: string;
  bannerInfo: string;
  divider: string;
}

interface Props {
  kit: KitSpec | undefined;
  onChange: (kit: KitSpec) => void;
  /** Поточна ціна виробу — щоб показати різницю з рекомендованою. */
  priceUah: number;
  /** Застосувати рекомендовану ціну до картки (`priceUah` і `basePriceUah`). */
  onApplyPrice: (patch: { priceUah: number; basePriceUah: number }) => void;
  /** Назва й артикул виробу — для нової інструкції набору (K3). */
  productName?: string;
  productSku?: string;
  /** Ідентифікатор виробу — для файлів виготовлення (K4). */
  productId?: string;
  t: KitThemeTokens;
}

const money = (n: number) => n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface TeamOption {
  id: string;
  name: string;
}

export const KitSpecEditor: React.FC<Props> = ({ kit: kitProp, onChange, priceUah, onApplyPrice, productName = '', productSku = '', productId = '', t }) => {
  const kit = kitProp ?? blankKit();
  const cost = useMemo(() => kitCost(kit), [kit]);
  const issues = useMemo(() => kitIssues(kit), [kit]);
  const [teams, setTeams] = useState<TeamOption[] | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsBusy, setTeamsBusy] = useState(false);

  const set = (partial: Partial<KitSpec>) => onChange({ ...kit, ...partial });
  const setLine = (group: 'parts' | 'packaging', id: string, partial: Partial<KitLine>) =>
    set({ [group]: kit[group].map((l) => (l.id === id ? { ...l, ...partial } : l)) } as Partial<KitSpec>);
  const removeLine = (group: 'parts' | 'packaging', id: string) => set({ [group]: kit[group].filter((l) => l.id !== id) } as Partial<KitSpec>);
  const addLine = (group: 'parts' | 'packaging') => {
    const limit = group === 'parts' ? MAX_KIT_PARTS : MAX_KIT_PACKAGING;
    if (kit[group].length >= limit) return;
    set({ [group]: [...kit[group], blankKitLine()] } as Partial<KitSpec>);
  };

  const num = (value: string): number => {
    const n = Number(value.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  const loadTeams = async () => {
    setTeamsBusy(true);
    setTeamsError(null);
    try {
      const res = await fetch('/api/admin/marketplace-bridge/teams?status=published', { credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Не вдалося прочитати команди.');
      setTeams((Array.isArray(data?.teams) ? data.teams : []).map((x: any) => ({ id: String(x.id), name: String(x.name) })));
    } catch (err: any) {
      setTeamsError(err?.message || 'Помилка завантаження.');
    } finally {
      setTeamsBusy(false);
    }
  };

  const renderLines = (group: 'parts' | 'packaging', title: string, empty: string) => (
    <div className="space-y-2" data-kit-lines={group}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-bold uppercase tracking-wider">{title}</h3>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${t.badge}`}>
          {kit[group].length} / {group === 'parts' ? MAX_KIT_PARTS : MAX_KIT_PACKAGING}
        </span>
      </div>
      {kit[group].length === 0 && <p className={`text-[11px] ${t.sub}`}>{empty}</p>}
      {kit[group].map((line) => (
        <div key={line.id} className={`grid grid-cols-12 gap-2 items-center pb-2 border-b ${t.divider}`} data-kit-line={line.id}>
          <input
            className={`col-span-12 md:col-span-3 px-2 py-1.5 rounded-lg text-[12px] ${t.input}`}
            placeholder="Назва"
            maxLength={KIT_NAME_MAX}
            value={line.name}
            onChange={(e) => setLine(group, line.id, { name: e.target.value })}
          />
          <input
            className={`col-span-3 md:col-span-1 px-2 py-1.5 rounded-lg text-[12px] ${t.input}`}
            inputMode="decimal"
            aria-label="Кількість"
            value={String(line.qty)}
            onChange={(e) => setLine(group, line.id, { qty: num(e.target.value) })}
          />
          <input
            className={`col-span-3 md:col-span-1 px-2 py-1.5 rounded-lg text-[12px] ${t.input}`}
            list="kit-units"
            aria-label="Одиниця"
            value={line.unit}
            onChange={(e) => setLine(group, line.id, { unit: e.target.value })}
          />
          <input
            className={`col-span-6 md:col-span-2 px-2 py-1.5 rounded-lg text-[12px] ${t.input}`}
            placeholder="Матеріал"
            maxLength={KIT_MATERIAL_MAX}
            value={line.material}
            onChange={(e) => setLine(group, line.id, { material: e.target.value })}
          />
          <input
            className={`col-span-6 md:col-span-2 px-2 py-1.5 rounded-lg text-[12px] ${t.input}`}
            placeholder="Постачальник"
            maxLength={KIT_SUPPLIER_MAX}
            value={line.supplier}
            onChange={(e) => setLine(group, line.id, { supplier: e.target.value })}
          />
          <input
            className={`col-span-4 md:col-span-1 px-2 py-1.5 rounded-lg text-[12px] ${t.input}`}
            inputMode="decimal"
            aria-label="Ціна за одиницю, грн"
            value={String(line.unitPriceUah)}
            onChange={(e) => setLine(group, line.id, { unitPriceUah: num(e.target.value) })}
          />
          <span className="col-span-6 md:col-span-1 text-[12px] font-mono text-right" data-kit-line-total>
            {money(cost.lineTotals[line.id] ?? 0)}
          </span>
          <button type="button" onClick={() => removeLine(group, line.id)} className={`col-span-2 md:col-span-1 p-1.5 rounded-lg ${t.dangerBtn}`} title="Прибрати рядок">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {group === 'parts' && (
            <label className={`col-span-12 flex items-center gap-2 text-[11px] ${t.sub}`}>
              Файл виготовлення
              <select
                className={`px-2 py-1 rounded-lg text-[12px] min-w-[12rem] ${t.select}`}
                value={line.fileId}
                disabled={!kit.files.length}
                onChange={(e) => setLine(group, line.id, { fileId: e.target.value })}
                data-kit-line-file
              >
                <option value="">{kit.files.length ? '— не вказано —' : 'Спершу додайте файли нижче'}</option>
                {kit.files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} (v{f.versions[f.versions.length - 1].version})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => addLine(group)}
        disabled={kit[group].length >= (group === 'parts' ? MAX_KIT_PARTS : MAX_KIT_PACKAGING)}
        className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${t.ghostBtn} disabled:opacity-40`}
        data-kit-add={group}
      >
        <Plus className="w-3.5 h-3.5" /> {group === 'parts' ? 'Ще деталь' : 'Ще предмет пакування'}
      </button>
    </div>
  );

  const apply = kitPricePatch(kit);
  const diff = apply ? apply.priceUah - priceUah : 0;

  return (
    <div className="space-y-5" data-kit-editor>
      <label className="flex items-center gap-2 text-[12px] font-semibold">
        <input type="checkbox" checked={kit.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-kit-enabled />
        Цей виріб — дитячий набір-конструктор (специфікація, собівартість, вік і безпека)
      </label>

      {kit.enabled && (
        <>
          <datalist id="kit-units">
            {KIT_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>

          {renderLines('parts', 'Деталі набору', 'Деталей ще немає. Кожна деталь — рядок із кількістю в одному наборі.')}
          {renderLines('packaging', 'Пакування', 'Коробка, вкладиш, етикетка — те, що йде в набір, але не є деталлю конструктора.')}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="block text-[11px] font-semibold uppercase tracking-wider">
              Робота, хв на набір
              <input className={`mt-1 w-full px-2 py-1.5 rounded-lg text-[12px] ${t.input}`} inputMode="decimal" value={String(kit.laborMinutes)} onChange={(e) => set({ laborMinutes: num(e.target.value) })} />
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-wider">
              Ставка, грн/год
              <input className={`mt-1 w-full px-2 py-1.5 rounded-lg text-[12px] ${t.input}`} inputMode="decimal" value={String(kit.laborRateUahPerHour)} onChange={(e) => set({ laborRateUahPerHour: num(e.target.value) })} />
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-wider">
              Націнка, %
              <input className={`mt-1 w-full px-2 py-1.5 rounded-lg text-[12px] ${t.input}`} inputMode="decimal" value={String(kit.marginPercent)} onChange={(e) => set({ marginPercent: num(e.target.value) })} />
            </label>
            <label className="block text-[11px] font-semibold uppercase tracking-wider">
              Округлення ціни до, грн
              <input className={`mt-1 w-full px-2 py-1.5 rounded-lg text-[12px] ${t.input}`} inputMode="numeric" value={String(kit.roundToUah)} onChange={(e) => set({ roundToUah: Math.max(1, Math.round(num(e.target.value))) })} />
            </label>
          </div>

          <div className={`rounded-xl border p-4 space-y-2 ${t.divider}`} data-kit-cost>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
              <div>
                <div className={t.sub}>Деталі</div>
                <div className="font-mono font-bold" data-kit-parts-cost>{money(cost.partsUah)} грн</div>
              </div>
              <div>
                <div className={t.sub}>Пакування</div>
                <div className="font-mono font-bold">{money(cost.packagingUah)} грн</div>
              </div>
              <div>
                <div className={t.sub}>Робота</div>
                <div className="font-mono font-bold">{money(cost.laborUah)} грн</div>
              </div>
              <div>
                <div className={t.sub}>Собівартість</div>
                <div className="font-mono font-bold" data-kit-total>{money(cost.totalUah)} грн</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <span className="text-[13px]">
                Рекомендована ціна: <b className="font-mono" data-kit-recommended>{money(cost.recommendedPriceUah)} грн</b>
                <span className={`ml-2 text-[11px] ${t.sub}`}>(націнка {money(cost.marginUah)} грн)</span>
              </span>
              <button
                type="button"
                disabled={!apply}
                onClick={() => apply && onApplyPrice(apply)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${t.primaryBtn} disabled:opacity-40`}
                data-kit-apply-price
              >
                <RefreshCw className="w-3.5 h-3.5" /> Застосувати до ціни виробу
              </button>
              {apply && diff !== 0 && (
                <span className={`text-[11px] ${t.sub}`}>
                  Зараз у картці {money(priceUah)} грн ({diff > 0 ? '+' : ''}
                  {money(diff)})
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2" data-kit-team>
            <h3 className="text-[12px] font-bold uppercase tracking-wider">STEAM-команда</h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px]">{kit.steamTeam ? kit.steamTeam.name || kit.steamTeam.id : 'Не обрано'}</span>
              <button type="button" onClick={loadTeams} disabled={teamsBusy} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold ${t.ghostBtn}`}>
                {teamsBusy ? 'Завантаження…' : 'Обрати зі схвалених'}
              </button>
              {kit.steamTeam && (
                <button type="button" onClick={() => set({ steamTeam: null })} className={`px-3 py-1.5 rounded-lg text-[11px] ${t.dangerBtn}`}>
                  Прибрати
                </button>
              )}
            </div>
            {teamsError && <p className="text-[11px] text-rose-400">{teamsError}</p>}
            {teams && (
              <select
                className={`px-2 py-1.5 rounded-lg text-[12px] ${t.select}`}
                value={kit.steamTeam?.id ?? ''}
                onChange={(e) => {
                  const found = teams.find((x) => x.id === e.target.value);
                  set({ steamTeam: found ? { id: found.id, name: found.name } : null });
                }}
              >
                <option value="">{teams.length ? '— оберіть команду —' : 'Схвалених команд немає'}</option>
                {teams.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <KitSafetyEditor kit={kit} onChange={(safety) => set({ safety })} t={t} />

          <KitFilesPanel kit={kit} productId={productId} onChange={onChange} t={t} />

          <KitInstructionPanel kit={kit} productName={productName} productSku={productSku} onChange={onChange} t={t} />

          {(issues.errors.length > 0 || issues.warnings.length > 0) && (
            <div className="space-y-1" data-kit-issues>
              {issues.errors.map((m, i) => (
                <p key={`e${i}`} className={`text-[11px] px-3 py-1.5 rounded-lg flex items-start gap-1.5 ${t.bannerErr}`}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {m}
                </p>
              ))}
              {issues.warnings.map((m, i) => (
                <p key={`w${i}`} className={`text-[11px] px-3 py-1.5 rounded-lg ${t.bannerInfo}`}>
                  {m}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
