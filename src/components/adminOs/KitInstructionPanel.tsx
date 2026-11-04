import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, FilePlus2, RefreshCw } from 'lucide-react';
import { InstructionBuilderView } from '../InstructionBuilderView';
import { instructionCompleteness } from '../../utils/instructionDraft';
import { buildKitInstruction, kitInstructionDrift, syncInstructionWithKit } from '../../utils/kitInstruction';
import type { Instruction } from '../../types';
import type { KitSpec } from './kitSpec';
import type { KitThemeTokens } from './KitSpecEditor';

/**
 * Блок «Інструкція набору» (K3) у картці виробу. Інструкція лежить у `kit.instruction`:
 * «Комплектація» і «Безпека» в ній беруться зі специфікації (K1/K2), решту автор пише
 * в конструкторі інструкцій, відкритому поверх картки.
 */
interface Props {
  kit: KitSpec;
  productName: string;
  productSku: string;
  onChange: (kit: KitSpec) => void;
  t: KitThemeTokens;
}

// Друк із оверлея: ховаємо все, крім самої інструкції.
const PRINT_ONLY_OVERLAY = `@media print{body>*:not([data-kit-instruction-overlay]){display:none!important}[data-kit-instruction-overlay]{position:static!important;overflow:visible!important;background:#fff!important}}`;

export const KitInstructionPanel: React.FC<Props> = ({ kit, productName, productSku, onChange, t }) => {
  const [openDoc, setOpenDoc] = useState<Instruction | null>(null);
  const doc = kit.instruction;
  const drift = useMemo(() => kitInstructionDrift(doc, kit), [doc, kit]);
  const readiness = useMemo(() => (doc ? instructionCompleteness(doc) : 0), [doc]);
  const preview = useMemo(() => (doc ? syncInstructionWithKit(doc, kit) : null), [doc, kit]);

  const create = () => {
    const created = buildKitInstruction({ name: productName, sku: productSku }, kit);
    onChange({ ...kit, instruction: created });
    setOpenDoc(created);
  };
  const open = () => {
    if (!doc) return;
    const synced = syncInstructionWithKit(doc, kit).doc;
    if (synced !== doc) onChange({ ...kit, instruction: synced });
    setOpenDoc(synced);
  };
  const sync = () => {
    if (doc && preview?.changed) onChange({ ...kit, instruction: preview.doc });
  };
  const c = preview?.changes;

  return (
    <div className="space-y-2" data-kit-instruction>
      <h3 className="text-[12px] font-bold uppercase tracking-wider flex items-center gap-1.5">
        <BookOpen className="w-3.5 h-3.5" /> Інструкція набору
      </h3>
      {!doc ? (
        <>
          <p className={`text-[11px] ${t.sub}`}>
            Інструкцію ще не створено. Комплектація й розділ «Безпека» візьмуться зі специфікації та віку/попереджень вище; кроки складання пишете вручну.
          </p>
          <button type="button" onClick={create} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${t.primaryBtn}`} data-kit-instruction-create>
            <FilePlus2 className="w-3.5 h-3.5" /> Створити інструкцію зі специфікації
          </button>
        </>
      ) : (
        <>
          <p className="text-[12px]">
            Готовність: <b className="font-mono" data-kit-instruction-readiness>{readiness}%</b>
            <span className={`ml-2 text-[11px] ${t.sub}`}>
              {doc.materials.filter((m) => m.specLineId).length} деталей у комплектації · кроків: {doc.steps.filter((s) => s.title.trim() || s.description.trim()).length}
            </span>
          </p>
          {drift && c && (
            <p className={`text-[11px] px-3 py-1.5 rounded-lg ${t.bannerInfo}`} data-kit-instruction-drift>
              Специфікація змінилась після останнього оновлення інструкції (додано {c.materialsAdded}, оновлено {c.materialsUpdated}, прибрано {c.materialsRemoved} деталей; рядків безпеки +{c.warningsAdded}/−{c.warningsRemoved}). Оновиться при відкритті або за кнопкою.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={open} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${t.primaryBtn}`} data-kit-instruction-open>
              <BookOpen className="w-3.5 h-3.5" /> Відкрити інструкцію
            </button>
            {drift && (
              <button type="button" onClick={sync} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 ${t.ghostBtn}`} data-kit-instruction-sync>
                <RefreshCw className="w-3.5 h-3.5" /> Оновити зі специфікації
              </button>
            )}
          </div>
        </>
      )}
      {openDoc &&
        typeof document !== 'undefined' &&
        createPortal(
          <div data-kit-instruction-overlay className="fixed inset-0 z-[100] overflow-auto bg-slate-950">
            <style>{PRINT_ONLY_OVERLAY}</style>
            <InstructionBuilderView
              initialInstruction={openDoc}
              kitBinding={{
                onChange: (next) => onChange({ ...kit, instruction: next }),
                onClose: () => setOpenDoc(null),
              }}
            />
          </div>,
          document.body
        )}
    </div>
  );
};
