/**
 * Вкладка «Аудит лістинга» — перевірка назви, тегів, опису й ціни за
 * правилами Etsy.
 *
 * Уся логіка — в `listingAudit.ts` і покрита тестами
 * (`npm run test:listing-audit`). Тут лише введення й показ: аудит
 * перераховується на кожній зміні поля, тому кнопки «перевірити» немає —
 * нічого не витрачається, чекати нема на що.
 *
 * ЧОГО НА ЦЬОМУ ЕКРАНІ СВІДОМО НЕМАЄ: частоти запиту, рівня конкуренції,
 * прогнозу конверсії. Etsy цих величин не публікує. Набір, з якого
 * перенесено вкладку, показував їх — і брав із `Math.random()`. Замість
 * цього внизу стоїть чесний блок «чого ми не знаємо»: порожнє місце з
 * поясненням корисніше за впевнене вигадане число.
 */
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  HelpCircle,
  Info,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { GlassCard } from './GlassCard';
import { GlassButton } from './GlassButton';
import { GlassInput } from './GlassInput';
import {
  auditListing,
  ETSY_TAG_MAX,
  ETSY_TITLE_MAX,
  type AuditStatus,
} from './listingAudit';

const STATUS_ICON: Record<AuditStatus, React.ReactNode> = {
  pass: <CheckCircle2 className="w-4 h-4 text-emerald-300" />,
  warn: <AlertTriangle className="w-4 h-4 text-amber-300" />,
  fail: <XCircle className="w-4 h-4 text-rose-300" />,
  info: <Info className="w-4 h-4 text-sky-300" />,
};

const STATUS_LABEL: Record<AuditStatus, string> = {
  pass: 'Гаразд',
  warn: 'Можна краще',
  fail: 'Проблема',
  info: 'Довідково',
};

/** Колір бала. Межі ті самі, що й у підказці під ним. */
function scoreTone(score: number): string {
  if (score >= 80) return 'text-emerald-300';
  if (score >= 55) return 'text-amber-300';
  return 'text-rose-300';
}

export const ListingAuditView: React.FC = () => {
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');

  const [advice, setAdvice] = useState<string | null>(null);
  const [adviceModel, setAdviceModel] = useState<string | null>(null);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const priceNumber = price.trim() === '' ? null : Number(price.replace(',', '.'));

  const report = useMemo(
    () => auditListing({ title, tags, description, priceUsd: priceNumber }),
    [title, tags, description, priceNumber]
  );

  const hasInput = title.trim().length > 0 || report.tags.length > 0;

  const handleCopyTags = () => {
    if (report.tags.length === 0) return;
    navigator.clipboard.writeText(report.tags.join(', '));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /**
   * Порада моделі. Іде тим самим маршрутом, що й решта модуля
   * (`/api/market/advisor` → ядро → `usage_log`), тож витрата обліковується,
   * а модель обирає адміністратор. Це ЄДИНЕ на цьому екрані, що звертається
   * до мережі; усе інше рахується тут-таки з тексту.
   */
  const handleAdvice = async () => {
    setBusy(true);
    setAdviceError(null);
    try {
      const problems = report.checks
        .filter((check) => check.status === 'warn' || check.status === 'fail')
        .map((check) => `- ${check.label}: ${check.detail}`)
        .join('\n');

      const res = await fetch('/api/market/advisor', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'listing',
          question: [
            `Назва лістинга: ${title || '(порожня)'}`,
            `Теги (${report.tags.length}/${ETSY_TAG_MAX}): ${report.tags.join(', ') || '(немає)'}`,
            priceNumber ? `Ціна: $${priceNumber}` : 'Ціну не вказано.',
            description ? `Початок опису: ${description.slice(0, 400)}` : 'Опис порожній.',
            '',
            'Формальна перевірка вже знайшла ось це:',
            problems || '- нічого',
            '',
            `Запропонуй перероблену назву (до ${ETSY_TITLE_MAX} символів) і рівно ${ETSY_TAG_MAX} тегів по 20 символів кожен. Поясни коротко, що саме змінив і чому.`,
          ].join('\n'),
        }),
      });

      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        setAdviceError(data?.error || `Помилка ${res.status}`);
        return;
      }
      if (!data?.answer) {
        setAdviceError('Модель повернула порожню відповідь.');
        return;
      }
      setAdvice(data.answer);
      setAdviceModel(typeof data.modelId === 'string' ? data.modelId : null);
    } catch (err) {
      setAdviceError(err instanceof Error ? err.message : 'Не вдалося звернутися до консультанта.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <GlassCard
        title="Аудит лістинга Etsy"
        subtitle={`Перевірка за лімітами майданчика: назва до ${ETSY_TITLE_MAX} символів, ${ETSY_TAG_MAX} тегів по 20 символів. Рахується тут-таки, нічого не витрачаючи.`}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-white/80 px-1">
              Назва лістинга
            </label>
            <textarea
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              rows={2}
              placeholder="Handmade Ceramic Coffee Mug with Botanical Glaze, Cozy Cottagecore Kitchen Decor"
              className="glass-input resize-y"
            />
            <span className={`text-xs px-1 ${report.titleLength > ETSY_TITLE_MAX ? 'text-rose-300' : 'text-white/50'}`}>
              {report.titleLength} / {ETSY_TITLE_MAX}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-white/80 px-1">
              Теги через кому
            </label>
            <textarea
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              rows={2}
              placeholder="ceramic coffee mug, handmade pottery, cozy kitchen decor…"
              className="glass-input resize-y"
            />
            <span className="text-xs text-white/50 px-1">
              {report.tags.length} / {ETSY_TAG_MAX}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <GlassInput
              label="Ціна, USD"
              inputMode="decimal"
              value={price}
              placeholder="34.00"
              onChange={(event) => setPrice(event.target.value)}
            />
            <div className="flex items-end">
              <GlassButton
                variant="secondary"
                size="sm"
                onClick={handleCopyTags}
                disabled={report.tags.length === 0}
                icon={copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              >
                {copied ? 'Скопійовано' : 'Скопіювати теги'}
              </GlassButton>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-white/80 px-1">
              Опис (перші рядки)
            </label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="Перші 160 символів опису — саме те, що Google показує під посиланням на лістинг."
              className="glass-input resize-y"
            />
          </div>
        </div>
      </GlassCard>

      {hasInput && (
        <GlassCard
          title="Результат"
          badge={
            <span className="glass-badge bg-white/10 text-xs">
              {report.breakdown.earned} з {report.breakdown.possible} балів ваги
            </span>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline gap-3">
              <span className={`text-4xl font-bold ${scoreTone(report.score)}`}>{report.score}</span>
              <span className="text-sm text-white/70">/ 100</span>
              <span className="text-xs text-white/60">
                Бал — це частка ваги пройдених перевірок зі списку нижче, і нічого більше:
                пройдена дає всю вагу, попередження — половину, довідкова не рахується.
              </span>
            </div>

            <ul className="flex flex-col gap-2">
              {report.checks.map((check) => (
                <li
                  key={check.id}
                  className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                >
                  <span className="mt-0.5 shrink-0">{STATUS_ICON[check.status]}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white/90">
                      {check.label}
                      <span className="ml-2 text-[11px] font-normal text-white/50">
                        {STATUS_LABEL[check.status]}
                        {check.weight > 0 ? ` · вага ${check.weight}` : ''}
                      </span>
                    </p>
                    <p className="text-xs text-white/70 leading-relaxed">{check.detail}</p>
                  </div>
                </li>
              ))}
            </ul>

            {/*
              Блок «чого ми не знаємо». Стоїть на екрані завжди, а не
              зʼявляється за помилкою: автор, який шукає тут частоту запитів,
              має прочитати, ЧОМУ її немає, а не вирішити, що забув
              натиснути кнопку.
            */}
            <div className="rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2.5">
              <p className="text-xs text-sky-100 leading-relaxed flex gap-2">
                <HelpCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Тут немає частоти запитів, рівня конкуренції й прогнозу конверсії — Etsy цих
                  величин не публікує, а порахувати їх із самого лістинга неможливо. Оцінку
                  попиту в ніші дає вкладка «Скринінг ніші», і там кожне число несе позначку
                  походження.
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <GlassButton
                onClick={handleAdvice}
                isLoading={busy}
                icon={<Sparkles className="w-4 h-4" />}
                size="sm"
              >
                Попросити модель переписати назву й теги
              </GlassButton>
              <span className="text-xs text-white/50">
                Єдина дія на цьому екрані, що звертається до моделі й витрачає ліміт.
              </span>
            </div>

            {adviceError && (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2">
                <p className="text-xs text-rose-100">{adviceError}</p>
              </div>
            )}

            {advice && (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-[11px] uppercase tracking-wider text-white/50 mb-1.5">
                  {adviceModel || 'Консультант ядра'}
                </p>
                <div className="text-xs text-white/90 leading-relaxed whitespace-pre-line">{advice}</div>
              </div>
            )}
          </div>
        </GlassCard>
      )}
    </div>
  );
};
