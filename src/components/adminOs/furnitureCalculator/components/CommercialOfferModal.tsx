import React, { useState } from 'react';
import { X, Printer, Check, Copy, FileText, Download, FileSpreadsheet, Calendar } from 'lucide-react';
import { CalculationInput, CalculationResult, Currency } from '../types';
import { formatMoney } from '../utils/calculator';
import { WOOD_SPECIES_LIST } from '../data/woodPresets';
import { exportCalculationToExcel } from '../utils/excelExport';
import { calculateProductionSchedule } from '../utils/timelineCalculator';

interface CommercialOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  input: CalculationInput;
  result: CalculationResult;
  currency: Currency;
}

export const CommercialOfferModal: React.FC<CommercialOfferModalProps> = ({
  isOpen,
  onClose,
  input,
  result,
  currency,
}) => {
  const [offerType, setOfferType] = useState<'client' | 'detailed'>('client');
  const [clientName, setClientName] = useState('Шановний Клієнте');
  const [projectName, setProjectName] = useState('Ексклюзивний стіл-річка з натурального дерева та епоксидної смоли');

  if (!isOpen) return null;

  const selectedSpecies = WOOD_SPECIES_LIST.find((w) => w.id === input.woodSpeciesId)?.name || 'Натуральний масив';

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#0f172a] text-slate-100 rounded-3xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.9)] overflow-hidden">
        {/* Modal Top Control Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/80">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold text-white">Комерційна пропозиція (КП)</h3>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex rounded-xl p-1 neo-inset text-xs">
              <button
                type="button"
                onClick={() => setOfferType('client')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  offerType === 'client' ? 'neo-pill-active' : 'text-slate-400'
                }`}
              >
                Для клієнта
              </button>
              <button
                type="button"
                onClick={() => setOfferType('detailed')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  offerType === 'detailed' ? 'neo-pill-active' : 'text-slate-400'
                }`}
              >
                Детальний кошторис
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                exportCalculationToExcel(input, result, currency, {
                  productName: projectName,
                  dimensions: `${input.woodLengthMm} × ${input.woodWidthMm} × ${input.woodThicknessMm} мм`,
                });
              }}
              className="px-3.5 py-1.5 rounded-xl neo-pill-default text-xs flex items-center gap-1.5 cursor-pointer text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/30"
              title="Експорт кошторису в Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Експорт в Excel</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-1.5 rounded-xl neo-pill-default text-xs flex items-center gap-1.5 cursor-pointer hover:text-white"
            >
              <Printer className="w-4 h-4 text-cyan-400" />
              <span>Друк / PDF</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl neo-icon-btn flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Content Body */}
        <div className="p-6 md:p-8 overflow-y-auto space-y-6 text-sm">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-white/10 gap-4">
            <div>
              <div className="text-xl font-bold text-white tracking-wide">WOOD & EPOXY ARTISAN STUDIO</div>
              <p className="text-xs text-slate-400 mt-0.5">Студія авторських меблів з масиву дерева та епоксидної смоли</p>
            </div>
            <div className="text-right text-xs text-slate-400 font-mono">
              <div>Дата: {new Date().toLocaleDateString('uk-UA')}</div>
              <div>КП №: WE-{Math.floor(1000 + Math.random() * 9000)}</div>
            </div>
          </div>

          {/* Editable recipient fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-2xl neo-inset border border-white/5">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Замовник:</label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full bg-transparent text-white font-medium border-b border-white/20 pb-1 focus:outline-none focus:border-cyan-400 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Найменування виробу:</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-transparent text-white font-medium border-b border-white/20 pb-1 focus:outline-none focus:border-cyan-400 text-sm"
              />
            </div>
          </div>

          {/* Technical Specs */}
          <div>
            <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-2">
              Технічна специфікація виробу
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl bg-slate-900/60 border border-white/5 text-xs">
              <div>
                <span className="text-slate-400 block">Порода деревини:</span>
                <strong className="text-white mt-0.5 block">{selectedSpecies}</strong>
              </div>
              <div>
                <span className="text-slate-400 block">Розміри стільниці:</span>
                <strong className="text-white mt-0.5 block">
                  {input.woodLengthMm} × {input.woodWidthMm} × {input.woodThicknessMm} мм
                </strong>
              </div>
              <div>
                <span className="text-slate-400 block">Епоксидна смола:</span>
                <strong className="text-white mt-0.5 block">
                  ~{result.calculatedEpoxyLiters.toFixed(1)} л (прозора)
                </strong>
              </div>
              <div>
                <span className="text-slate-400 block">Фінішне покриття:</span>
                <strong className="text-white mt-0.5 block">
                  {input.finishType === 'oil_wax'
                    ? 'Масло-віск преміум'
                    : input.finishType === 'polyurethane_varnish'
                    ? 'Поліуретановий лак'
                    : 'Нанокераміка'}
                </strong>
              </div>
            </div>
          </div>

          {/* Pricing table based on offerType */}
          {offerType === 'client' ? (
            <div className="border border-white/10 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-800/80 text-slate-300 font-semibold border-b border-white/10">
                  <tr>
                    <th className="p-3">Найменування етапу / послуги</th>
                    <th className="p-3 text-right">Сума</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-200">
                  <tr>
                    <td className="p-3">
                      <strong>Слеби та підготовка масиву ({selectedSpecies})</strong>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Камерна сушка до 8% вологості, калібрування та фугування
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono font-medium">
                      {formatMoney(result.totalWoodCost * (1 + input.profitMarginPercent / 100), currency)}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3">
                      <strong>Епоксидна заливка, пігменти та витримка</strong>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Оптично прозора смола, стабілізація від UV-вигорання, опалубка
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono font-medium">
                      {formatMoney(result.totalEpoxyGroupCost * (1 + input.profitMarginPercent / 100), currency)}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3">
                      <strong>ЧПУ фрезерування, шліфування та фінішне покриття</strong>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Вирівнювання площини на ЧПУ, полірування до шовкового блиску
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono font-medium">
                      {formatMoney((result.totalCncCost + result.totalFinishingGroupCost + result.carpenterLaborCost) * (1 + input.profitMarginPercent / 100), currency)}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3">
                      <strong>Підстілля, фурнітура, упаковка та доставка</strong>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Металокаркас з порошковим фарбуванням, муфти Rampa, дерев'яна обрешітка
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono font-medium">
                      {formatMoney((result.metalBaseGroupCost + result.packagingCost + result.finalDeliveryCost + result.assemblerLaborCost) * (1 + input.profitMarginPercent / 100), currency)}
                    </td>
                  </tr>
                  {input.includeAiMediaCost !== false && (
                    <tr>
                      <td className="p-3">
                        <strong>Цифровий медіа-пакет (AI фотосесія та промо-відео)</strong>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {input.gptPhotosPerProduct ?? 20} інтер'єрних фотографій товару (GPT) та динамічне 4K відео (Runway)
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono font-medium text-purple-300">
                        {formatMoney(result.totalAiMediaCostUah * (1 + input.profitMarginPercent / 100), currency)}
                      </td>
                    </tr>
                  )}
                  {input.includeElectronics && (
                    <tr>
                      <td className="p-3">
                        <strong>Інтелектуальна LED підсвітка та мікропроцесорне керування</strong>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {input.powerSupplyType || 'Блок живлення'} + {input.ledStripType || 'LED стрічка'} ({input.ledStripLengthMeters ?? 2.5} м), профіль з розсіювачем, контролер {input.microcontrollerType || 'ESP32'} та професійний електромонтаж
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono font-medium text-amber-300">
                        {formatMoney(result.totalElectronicsCost * (1 + input.profitMarginPercent / 100), currency)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Detailed internal audit table */
            <div className="border border-white/10 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-800/80 text-slate-300 font-semibold border-b border-white/10">
                  <tr>
                    <th className="p-3">Стаття витрат</th>
                    <th className="p-3 text-right">Собівартість</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-200 font-mono">
                  <tr>
                    <td className="p-2.5 font-sans">Деревина (чиста + сушка + доставка сировини)</td>
                    <td className="p-2.5 text-right">{formatMoney(result.totalWoodCost, currency)}</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-sans">Епоксидна смола, барвники та опалубка</td>
                    <td className="p-2.5 text-right">{formatMoney(result.totalEpoxyGroupCost, currency)}</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-sans">Фініш (масло-віск/лак) та абразиви</td>
                    <td className="p-2.5 text-right">{formatMoney(result.totalFinishingGroupCost, currency)}</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-sans">
                      ЧПУ фрезерування ({input.cncHours} год верстат + оператор
                      {input.includeRouterBitCost !== false
                        ? `, амортизація фрези: ${formatMoney(result.routerBitDepreciationPerProduct, currency)}`
                        : ''}
                      )
                    </td>
                    <td className="p-2.5 text-right">{formatMoney(result.totalCncCost, currency)}</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-sans">Оплата праці (столяр, збірник, дизайнер, менеджер, директор)</td>
                    <td className="p-2.5 text-right">{formatMoney(result.totalLaborCost, currency)}</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-sans">Металокаркас, порошкове фарбування, фурнітура</td>
                    <td className="p-2.5 text-right">{formatMoney(result.metalBaseGroupCost, currency)}</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-sans">Упаковка та фінішна доставка</td>
                    <td className="p-2.5 text-right">{formatMoney(result.packagingCost + result.finalDeliveryCost, currency)}</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-sans">Амортизація обладнання та комунальні платежі</td>
                    <td className="p-2.5 text-right">{formatMoney(result.totalOverheadCost, currency)}</td>
                  </tr>
                  {input.includeAiMediaCost !== false && (
                    <tr>
                      <td className="p-2.5 font-sans text-purple-300">
                        AI-контент: GPT ({input.gptPhotosPerProduct ?? 20} фото) + Runway ({input.runwayVideosPerProduct ?? 1} відео)
                      </td>
                      <td className="p-2.5 text-right text-purple-300">
                        {formatMoney(result.totalAiMediaCostUah, currency)} (${result.totalAiMediaCostUsd.toFixed(2)})
                      </td>
                    </tr>
                  )}
                  {input.includeElectronics && (
                    <>
                      <tr>
                        <td className="p-2.5 font-sans text-amber-300">
                          Матеріали електроніки: БЖ ({input.powerSupplyWatts ?? 100}W) + LED ({input.ledStripLengthMeters ?? 2.5}м) + профіль + контролер
                        </td>
                        <td className="p-2.5 text-right text-amber-300">
                          {formatMoney(result.totalElectronicsMaterialsCost, currency)}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-sans text-emerald-300">
                          Робота пайщика (пайка, гідроізоляція, збірка схеми)
                        </td>
                        <td className="p-2.5 text-right text-emerald-300">
                          {formatMoney(result.soldererLaborCost, currency)}
                        </td>
                      </tr>
                    </>
                  )}
                  <tr className="bg-slate-800/40 font-bold">
                    <td className="p-2.5 font-sans text-cyan-300">Повна собівартість (Cost Price)</td>
                    <td className="p-2.5 text-right text-cyan-300">{formatMoney(result.fullCostPrice, currency)}</td>
                  </tr>
                  <tr className="bg-emerald-900/20 font-bold">
                    <td className="p-2.5 font-sans text-emerald-400">Чистий прибуток майстерні ({input.profitMarginPercent}%)</td>
                    <td className="p-2.5 text-right text-emerald-400">{formatMoney(result.netProfit, currency)}</td>
                  </tr>
                  <tr className="bg-amber-900/20">
                    <td className="p-2.5 font-sans text-amber-300">Податок ({input.taxRatePercent}%)</td>
                    <td className="p-2.5 text-right text-amber-300">{formatMoney(result.taxAmount, currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Grand Total */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-900/80 to-indigo-900/80 border border-blue-400/40 flex items-center justify-between shadow-[0_0_20px_rgba(59,130,246,0.3)]">
            <div>
              <span className="text-xs uppercase tracking-wider text-blue-200">Загальна вартість замовлення:</span>
              <div className="text-xs text-blue-300/80 mt-0.5">Включає упаковку в жорсткий короб та доставку</div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white font-mono">
              {formatMoney(result.totalSellingPrice, currency)}
            </div>
          </div>

          {/* Production Timeline & Deadline */}
          {(() => {
            const schedule = calculateProductionSchedule(input);
            return (
              <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-emerald-500/20 text-xs space-y-1.5">
                <div className="flex items-center justify-between font-semibold text-emerald-400">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-emerald-400" />
                    <span>Графік робіт та дата готовності:</span>
                  </span>
                  <span className="font-mono text-white bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30">
                    до {schedule.completionDate}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300">
                  Загальний технологічний термін: <strong className="text-white">{schedule.totalDays} {schedule.isWorkingDaysMode ? 'робочих днів' : 'календарних днів'}</strong> (старт: {schedule.startDateFormatted}).
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-slate-400 pt-1">
                  {schedule.stages.map((s) => (
                    <span key={s.id} className="px-2 py-0.5 rounded bg-slate-800 border border-white/5">
                      {s.shortName}: {s.days}д ({s.startDate}–{s.endDate})
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Guarantee and terms */}
          <div className="text-[11px] text-slate-400 pt-2 border-t border-white/10 space-y-1">
            <p>• Гарантія на виріб: 24 місяці за умови дотримання правил експлуатації в приміщенні з вологістю 45–60%.</p>
            <p>• Умови оплати: 50% передплата для закупівлі сировини та смоли, 50% після фотозвіту та прийомки ВТК перед відправкою.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
