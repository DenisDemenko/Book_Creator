/**
 * «Створити за допомогою GrabFusion» (третій спосіб у вікні «Створення нової книги» на дашборді).
 *
 * GrabFusion — застосунок для телефона: курс, інструкція чи глава з фото. З комп'ютера його не «створюють», а
 * відкривають на телефоні, тому вікно показує QR-код: наведіть камеру — GrabFusion відкриється й підключиться
 * сам (той самий одноразовий код, що й у «Медіатека → Скани з телефону»: новий щоразу, 5 хвилин, привʼязаний до
 * автора). Поруч — посилання «відкрити на цьому пристрої» (для телефона, з якого відкрито Студію) і ручний код.
 */
import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, ExternalLink, Loader2, RefreshCw, Smartphone, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface PairInfo {
  code: string;
  expiresAt: string;
  appUrl: string | null;
}

interface Props {
  onClose: () => void;
}

export const GrabfusionConnectModal: React.FC<Props> = ({ onClose }) => {
  const { t } = useLanguage();
  const [pair, setPair] = useState<PairInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [copied, setCopied] = useState(false);

  const request = useCallback(async () => {
    setBusy(true);
    setError(null);
    setPair(null);
    setExpired(false);
    try {
      const res = await fetch('/api/external-tokens/pairing-code', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'GrabFusion', scope: 'photo-drafts' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.code) {
        setError(String(data?.error || t('dashboard.grabfusionFailed')));
        return;
      }
      setPair({ code: String(data.code), expiresAt: String(data.expiresAt), appUrl: typeof data.appUrl === 'string' && data.appUrl ? data.appUrl : null });
    } catch {
      setError(t('dashboard.grabfusionFailed'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  // Код створюється одразу, як вікно відкрилось: користувач прийшов саме по нього.
  useEffect(() => {
    void request();
  }, [request]);

  useEffect(() => {
    let alive = true;
    setQr(null);
    if (!pair?.appUrl) return undefined;
    QRCode.toDataURL(pair.appUrl, { errorCorrectionLevel: 'M', margin: 2, width: 240 })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [pair]);

  // Після строку дії QR не показуємо: сервер код однаково вже не прийме.
  useEffect(() => {
    if (!pair) return undefined;
    const left = new Date(pair.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(left)) return undefined;
    if (left <= 0) {
      setExpired(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setExpired(true), left);
    return () => window.clearTimeout(timer);
  }, [pair]);

  const copyLink = async () => {
    if (!pair?.appUrl) return;
    try {
      await navigator.clipboard.writeText(pair.appUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* буфер недоступний — посилання все одно є на кнопці «Відкрити» */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} data-grabfusion-modal>
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-300">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">{t('dashboard.grabfusionTitle')}</h3>
              <p className="text-xs text-slate-400">{t('dashboard.grabfusionDesc')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors" aria-label={t('dashboard.cancel')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {busy && (
            <div className="flex items-center gap-2 text-sm text-slate-400" data-grabfusion-loading>
              <Loader2 className="w-4 h-4 animate-spin" /> {t('dashboard.grabfusionLoading')}
            </div>
          )}
          {error && <p className="text-sm text-rose-300" data-grabfusion-error>{error}</p>}

          {pair && !expired && (
            <div className="flex flex-wrap items-start gap-4" data-grabfusion-pair>
              {pair.appUrl && qr ? (
                <img src={qr} alt={t('dashboard.grabfusionQrAlt')} width={192} height={192} className="shrink-0 rounded-lg bg-white p-1" data-grabfusion-qr />
              ) : (
                !pair.appUrl && <p className="text-xs text-slate-400" data-grabfusion-no-qr>{t('dashboard.grabfusionNoQr')}</p>
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs text-slate-300 leading-snug">{t('dashboard.grabfusionScan')}</p>
                {pair.appUrl && (
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={pair.appUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-grabfusion-open-here
                      className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/40 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/10"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> {t('dashboard.grabfusionOpenHere')}
                    </a>
                    <button
                      type="button"
                      onClick={copyLink}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? t('dashboard.grabfusionCopied') : t('dashboard.grabfusionCopy')}
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-slate-500">
                  {t('dashboard.grabfusionManualCode')}{' '}
                  <code className="px-2 py-0.5 rounded bg-slate-950 border border-violet-500/40 text-violet-100 tracking-[0.2em]" data-grabfusion-code>{pair.code}</code>
                </p>
              </div>
            </div>
          )}

          {pair && expired && <p className="text-xs text-amber-300" data-grabfusion-expired>{t('dashboard.grabfusionExpired')}</p>}

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => void request()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              data-grabfusion-refresh
            >
              <RefreshCw className="w-3.5 h-3.5" /> {t('dashboard.grabfusionNew')}
            </button>
            <p className="text-[10px] text-slate-500 max-w-[55%] text-right leading-snug">{t('dashboard.grabfusionSafety')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
