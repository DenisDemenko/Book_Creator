import React, { useMemo, useState } from 'react';
import { Plus, ShieldAlert, Trash2 } from 'lucide-react';
import {
  KIT_AGE_MAX,
  KIT_AGE_PRESETS,
  MAX_SAFETY_DOCS,
  MAX_SAFETY_WARNINGS,
  SAFETY_DOC_ISSUER_MAX,
  SAFETY_DOC_NUMBER_MAX,
  SAFETY_DOC_TITLE_MAX,
  SAFETY_MATERIALS_NOTE_MAX,
  SAFETY_WARNING_MAX,
  SAFETY_WARNING_PRESETS,
  SMALL_PARTS_MIN_AGE,
  SMALL_PARTS_WARNING,
  ageLabel,
  blankSafety,
  blankSafetyDoc,
  kitMaterials,
  type KitSafety,
  type SafetyDoc,
} from './kitSafety';
import type { KitSpec } from './kitSpec';
import type { KitThemeTokens } from './KitSpecEditor';

/**
 * Підсекція «Вік і безпека» набору (K2). Те, що покупець побачить на вітрині:
 * вік, попередження, матеріали. Документи відповідності — приватні позначки.
 * Помилки/застереження показує загальний блок `KitSpecEditor` (одне місце).
 */
interface Props {
  kit: KitSpec;
  onChange: (safety: KitSafety) => void;
  t: KitThemeTokens;
}

export const KitSafetyEditor: React.FC<Props> = ({ kit, onChange, t }) => {
  const safety = kit.safety ?? blankSafety();
  const materials = useMemo(() => kitMaterials(kit), [kit]);
  const [draftWarning, setDraftWarning] = useState('');
  const set = (partial: Partial<KitSafety>) => onChange({ ...safety, ...partial });

  const addWarning = (text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || safety.warnings.length >= MAX_SAFETY_WARNINGS) return;
    if (safety.warnings.some((w) => w.toLowerCase() === clean.toLowerCase())) return;
    set({ warnings: [...safety.warnings, clean], noWarningsConfirmed: false });
    setDraftWarning('');
  };
  const setDoc = (id: string, partial: Partial<SafetyDoc>) => set({ documents: safety.documents.map((d) => (d.id === id ? { ...d, ...partial } : d)) });
  const smallPartsConflict = safety.smallParts === true && safety.ageMinYears !== null && safety.ageMinYears < SMALL_PARTS_MIN_AGE;

  return (
    <div className="space-y-4" data-kit-safety>
      <h3 className="text-[12px] font-bold uppercase tracking-wider flex items-center gap-1.5">
        <ShieldAlert className="w-3.5 h-3.5" /> Вік і безпека
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider">Вікова група (від, років)</div>
          <div className="flex flex-wrap items-center gap-1.5" data-kit-age>
            {KIT_AGE_PRESETS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => set({ ageMinYears: a })}
                aria-pressed={safety.ageMinYears === a}
                className={`px-2.5 py-1 rounded-lg text-[12px] font-mono ${safety.ageMinYears === a ? t.primaryBtn : t.ghostBtn}`}
              >
                {ageLabel(a)}
              </button>
            ))}
            <input
              className={`w-16 px-2 py-1 rounded-lg text-[12px] ${t.input}`}
              inputMode="numeric"
              aria-label="Свій вік"
              placeholder="інше"
              value={safety.ageMinYears !== null && !(KIT_AGE_PRESETS as readonly number[]).includes(safety.ageMinYears) ? String(safety.ageMinYears) : ''}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === '') return set({ ageMinYears: null });
                const n = Math.floor(Number(raw));
                if (Number.isFinite(n)) set({ ageMinYears: Math.min(KIT_AGE_MAX, Math.max(0, n)) });
              }}
            />
          </div>
          {safety.ageMinYears === null && <p className={`text-[11px] ${t.sub}`}>Поки не вибрано — публікація заблокована.</p>}
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider">Чи є в наборі дрібні деталі?</div>
          <div className="flex gap-2" data-kit-small-parts>
            <button type="button" aria-pressed={safety.smallParts === true} onClick={() => set({ smallParts: true, noWarningsConfirmed: false })} className={`px-3 py-1 rounded-lg text-[12px] font-semibold ${safety.smallParts === true ? t.primaryBtn : t.ghostBtn}`}>
              Так
            </button>
            <button type="button" aria-pressed={safety.smallParts === false} onClick={() => set({ smallParts: false })} className={`px-3 py-1 rounded-lg text-[12px] font-semibold ${safety.smallParts === false ? t.primaryBtn : t.ghostBtn}`}>
              Ні
            </button>
          </div>
          {safety.smallParts === true && (
            <p className={`text-[11px] px-3 py-1.5 rounded-lg ${smallPartsConflict ? t.bannerErr : t.bannerInfo}`}>
              {smallPartsConflict ? `Для дрібних деталей вік має бути ${SMALL_PARTS_MIN_AGE}+. ` : ''}
              Автоматично додається попередження: «{SMALL_PARTS_WARNING}»
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2" data-kit-warnings>
        <div className="text-[11px] font-semibold uppercase tracking-wider">Попередження для покупця</div>
        {safety.warnings.map((w, i) => (
          <div key={`${i}-${w}`} className={`flex items-start gap-2 pb-1.5 border-b ${t.divider}`}>
            <span className="flex-1 text-[12px]">{w}</span>
            <button type="button" onClick={() => set({ warnings: safety.warnings.filter((_, j) => j !== i) })} className={`p-1 rounded-lg ${t.dangerBtn}`} title="Прибрати попередження">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5">
          {SAFETY_WARNING_PRESETS.filter((p) => !safety.warnings.includes(p)).map((p) => (
            <button key={p} type="button" onClick={() => addWarning(p)} className={`px-2 py-1 rounded-lg text-[11px] text-left ${t.ghostBtn}`} title="Додати це попередження">
              + {p}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className={`flex-1 px-2 py-1.5 rounded-lg text-[12px] ${t.input}`}
            placeholder="Власне попередження"
            maxLength={SAFETY_WARNING_MAX}
            value={draftWarning}
            onChange={(e) => setDraftWarning(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addWarning(draftWarning);
              }
            }}
          />
          <button type="button" onClick={() => addWarning(draftWarning)} disabled={!draftWarning.trim()} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 ${t.ghostBtn} disabled:opacity-40`}>
            <Plus className="w-3.5 h-3.5" /> Додати
          </button>
        </div>
        {safety.warnings.length === 0 && safety.smallParts !== true && (
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={safety.noWarningsConfirmed} onChange={(e) => set({ noWarningsConfirmed: e.target.checked })} data-kit-no-warnings />
            Попереджень немає (підтверджую)
          </label>
        )}
      </div>

      <div className="space-y-1.5" data-kit-materials>
        <div className="text-[11px] font-semibold uppercase tracking-wider">Матеріали</div>
        <p className="text-[12px]">
          {materials.length ? materials.join(', ') : <span className={t.sub}>Беруться з поля «Матеріал» деталей — поки жодного.</span>}
        </p>
        <input
          className={`w-full px-2 py-1.5 rounded-lg text-[12px] ${t.input}`}
          placeholder="Додатково: «лак на водній основі», «без латексу»…"
          maxLength={SAFETY_MATERIALS_NOTE_MAX}
          value={safety.materialsNote}
          onChange={(e) => set({ materialsNote: e.target.value })}
        />
      </div>

      <div className="space-y-2" data-kit-docs>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider">Документи відповідності (позначки, приватні)</div>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${t.badge}`}>
            {safety.documents.length} / {MAX_SAFETY_DOCS}
          </span>
        </div>
        <p className={`text-[11px] ${t.sub}`}>Тут лише відомості про документ. Самі файли додамо з приватним сховищем (K4); на вітрину вони не йдуть.</p>
        {safety.documents.map((d) => (
          <div key={d.id} className={`grid grid-cols-12 gap-2 items-center pb-2 border-b ${t.divider}`} data-kit-doc={d.id}>
            <input className={`col-span-12 md:col-span-4 px-2 py-1.5 rounded-lg text-[12px] ${t.input}`} placeholder="Назва (декларація, протокол…)" maxLength={SAFETY_DOC_TITLE_MAX} value={d.title} onChange={(e) => setDoc(d.id, { title: e.target.value })} />
            <input className={`col-span-6 md:col-span-2 px-2 py-1.5 rounded-lg text-[12px] ${t.input}`} placeholder="№" maxLength={SAFETY_DOC_NUMBER_MAX} value={d.number} onChange={(e) => setDoc(d.id, { number: e.target.value })} />
            <input className={`col-span-6 md:col-span-3 px-2 py-1.5 rounded-lg text-[12px] ${t.input}`} placeholder="Хто видав" maxLength={SAFETY_DOC_ISSUER_MAX} value={d.issuedBy} onChange={(e) => setDoc(d.id, { issuedBy: e.target.value })} />
            <input className={`col-span-8 md:col-span-2 px-2 py-1.5 rounded-lg text-[12px] ${t.input}`} type="date" aria-label="Діє до" value={d.validUntil} onChange={(e) => setDoc(d.id, { validUntil: e.target.value })} />
            <button type="button" onClick={() => set({ documents: safety.documents.filter((x) => x.id !== d.id) })} className={`col-span-4 md:col-span-1 p-1.5 rounded-lg ${t.dangerBtn}`} title="Прибрати документ">
              <Trash2 className="w-3.5 h-3.5 mx-auto" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => safety.documents.length < MAX_SAFETY_DOCS && set({ documents: [...safety.documents, blankSafetyDoc()] })} disabled={safety.documents.length >= MAX_SAFETY_DOCS} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${t.ghostBtn} disabled:opacity-40`} data-kit-add-doc>
          <Plus className="w-3.5 h-3.5" /> Додати документ
        </button>
      </div>
    </div>
  );
};
