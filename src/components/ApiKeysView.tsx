import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Check, Trash2, Loader2, ShieldAlert, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { AuthUser } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface ApiKeyRow {
  engine: string;
  label: string;
  serverKeyConfigured: boolean;
  configured: boolean;
  fingerprint?: string;
  updatedAt?: string;
  /**
   * Текстовий рушій чи генератор зображень. Поле опційне, бо старіший
   * сервер його не віддає — тоді рядок вважається текстовим, як раніше.
   */
  kind?: 'text' | 'image';
}

interface ApiKeysViewProps {
  authUser?: AuthUser | null;
}

/**
 * Розділ «Ключі API» — власний ключ провайдера ШІ автора, замість спільного
 * серверного (server/apiKeysRoutes.ts, розділ 4 ARCHITECTURE_TOKEN_MODULE_INTEGRATION.md).
 * Дизайн — неоморфна тема, портована з Modul_token (src/styles/tokenModuleTheme.css).
 */
export const ApiKeysView: React.FC<ApiKeysViewProps> = ({ authUser }) => {
  const { t, lang } = useLanguage();
  const isRegistered = !!authUser?.id && !authUser.isGuest;

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [cryptoConfigured, setCryptoConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyEngine, setBusyEngine] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ engine: string; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!isRegistered) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/account/api-keys', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(t('apiKeysView.loadError'));
      const data = await res.json();
      setKeys(data.keys || []);
      setCryptoConfigured(data.cryptoConfigured !== false);
    } catch (e: any) {
      setError(e?.message || t('apiKeysView.loadError'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRegistered]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (engine: string) => {
    const apiKey = (drafts[engine] || '').trim();
    if (!apiKey) {
      setNotice({ engine, text: t('apiKeysView.emptyKeyError') });
      return;
    }
    setBusyEngine(engine);
    setNotice(null);
    try {
      const res = await fetch(`/api/account/api-keys/${engine}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t('apiKeysView.loadError'));
      setDrafts((prev) => ({ ...prev, [engine]: '' }));
      setNotice({ engine, text: t('apiKeysView.savedNotice') });
      await load();
    } catch (e: any) {
      setNotice({ engine, text: e?.message || t('apiKeysView.loadError') });
    } finally {
      setBusyEngine(null);
    }
  };

  const handleRemove = async (engine: string) => {
    setBusyEngine(engine);
    setNotice(null);
    try {
      await fetch(`/api/account/api-keys/${engine}`, { method: 'DELETE', credentials: 'same-origin' });
      setNotice({ engine, text: t('apiKeysView.removedNotice') });
      await load();
    } catch {
      /* мережа впала — список просто не оновиться, спробує ще раз при наступному save/remove */
    } finally {
      setBusyEngine(null);
    }
  };

  // Рядок ключа однаковий для обох секцій: різниця лише в тому, за що
  // провайдер бере гроші, і це пояснює підпис секції, а не сама картка.
  const renderRow = (row: ApiKeyRow) => {
    const draft = drafts[row.engine] || '';
    const busy = busyEngine === row.engine;
    const rowNotice = notice?.engine === row.engine ? notice.text : null;
    return (
      <div key={row.engine} className="nm-outset rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-bold text-[var(--on-surface)]">{row.label}</span>
          {row.configured ? (
            <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" /> {t('apiKeysView.ownKeyActive')}
            </span>
          ) : row.serverKeyConfigured ? (
            <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--outline)]">
              <ShieldCheck className="w-3.5 h-3.5" /> {t('apiKeysView.serverKeyAvailable')}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400">
              <ShieldAlert className="w-3.5 h-3.5" /> {t('apiKeysView.serverKeyMissing')}
            </span>
          )}
        </div>

        {row.configured && (
          <div className="nm-inset rounded-lg px-3 py-2 text-[11px] font-mono text-[var(--on-surface-variant)] flex flex-wrap gap-x-4 gap-y-0.5">
            <span>{t('apiKeysView.fingerprintLabel')}: {row.fingerprint}</span>
            {row.updatedAt && (
              <span>
                {t('apiKeysView.updatedAtLabel')}: {new Date(row.updatedAt).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-US')}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            type="password"
            value={draft}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [row.engine]: e.target.value }))}
            placeholder={t('apiKeysView.inputPlaceholder')}
            className="flex-1 nm-inset rounded-xl px-3 py-2 text-[12px] font-mono text-[var(--on-surface)] placeholder:text-[var(--outline)] outline-none bg-transparent"
          />
          <button
            onClick={() => handleSave(row.engine)}
            disabled={busy}
            className="nm-btn-primary px-3 py-2 rounded-xl text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {t('apiKeysView.save')}
          </button>
          {row.configured && (
            <button
              onClick={() => handleRemove(row.engine)}
              disabled={busy}
              title={t('apiKeysView.remove')}
              className="nm-btn p-2 rounded-xl text-rose-400 disabled:opacity-50 shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {rowNotice && <p className="text-[11px] text-[var(--primary)]">{rowNotice}</p>}
      </div>
    );
  };

  const textKeys = keys.filter((k) => k.kind !== 'image');
  const imageKeys = keys.filter((k) => k.kind === 'image');

  if (!isRegistered) {
    return (
      <div className="token-module-scope min-h-[50vh] rounded-2xl flex flex-col items-center justify-center gap-3 p-12 text-center">
        <div className="w-14 h-14 rounded-2xl nm-outset flex items-center justify-center text-[var(--primary)]">
          <KeyRound className="w-7 h-7" />
        </div>
        <p className="text-[13px] text-[var(--on-surface-variant)]">{t('apiKeysView.guestNotice')}</p>
      </div>
    );
  }

  return (
    <div className="token-module-scope min-h-[70vh] rounded-2xl p-6 md:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl nm-outset flex items-center justify-center text-[var(--primary)] shrink-0">
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-[var(--on-surface)]">{t('apiKeysView.title')}</h1>
          <p className="text-[13px] text-[var(--on-surface-variant)] mt-0.5">{t('apiKeysView.subtitle')}</p>
        </div>
      </div>

      {!cryptoConfigured && (
        <div className="nm-inset rounded-xl p-4 flex items-start gap-2.5 text-[12px] text-[var(--on-surface-variant)]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <span>{t('apiKeysView.cryptoNotConfigured')}</span>
        </div>
      )}

      {error && (
        <div className="nm-inset rounded-xl p-4 text-[12px] text-rose-400">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-[var(--on-surface-variant)] py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-[13px] font-bold text-[var(--on-surface)]">{t('apiKeysView.sectionText')}</h2>
              <p className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">{t('apiKeysView.sectionTextHint')}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {textKeys.map(renderRow)}
            </div>
          </section>

          {imageKeys.length > 0 && (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-[13px] font-bold text-[var(--on-surface)]">{t('apiKeysView.sectionImage')}</h2>
                <p className="text-[11px] text-[var(--on-surface-variant)] mt-0.5">{t('apiKeysView.sectionImageHint')}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {imageKeys.map(renderRow)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
