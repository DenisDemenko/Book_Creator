import React, { useState } from 'react';
import { Feather, Mail, Lock, User as UserIcon, ArrowRight, Eye, Sparkles, AlertTriangle, Sun, Moon } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface AuthScreenProps {
  onLogin: (email: string, password: string) => Promise<boolean>;
  onRegister: (email: string, password: string, name: string) => Promise<boolean>;
  onContinueAsGuest: () => void;
  onClearError: () => void;
  error: string | null;
  googleEnabled: boolean;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

/**
 * Екран входу. Показується один раз при першому відкритті; далі
 * користувач або залогінений, або свідомо обрав гостьовий режим.
 */
export const AuthScreen: React.FC<AuthScreenProps> = ({
  onLogin,
  onRegister,
  onContinueAsGuest,
  onClearError,
  error,
  googleEnabled,
  theme = 'dark',
  onToggleTheme,
}) => {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    onClearError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    if (mode === 'login') await onLogin(email.trim(), password);
    else await onRegister(email.trim(), password, name.trim());
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Фонові плями в стилі решти інтерфейсу */}
      <div className="orb-field">
        <div className="orb orb-cyan orb-float w-[420px] h-[420px] -top-32 -left-24" />
        <div className="orb orb-violet orb-float-slow w-[380px] h-[380px] bottom-0 -right-24" />
      </div>
      <div className="absolute inset-0 bg-grid-faint" />

      {onToggleTheme && (
        <button
          id="auth-theme-toggle-btn"
          onClick={onToggleTheme}
          className="absolute top-5 right-5 z-20 flex items-center justify-center w-9 h-9 rounded-xl badge-glass hover:border-amber-400/40 text-slate-300 hover:text-amber-300 transition-all"
          title={theme === 'light' ? t('auth.themeToDark') : t('auth.themeToLight')}
          aria-label={t('auth.toggleTheme')}
        >
          {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>
      )}

      <div className="relative z-10 w-full max-w-md">
        {/* Шапка */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-[0_0_28px_-6px_rgba(245,158,11,0.7)] mb-4">
            <Feather className="w-7 h-7 stroke-[2.2]" />
          </div>
          <div className="text-[11px] font-bold tracking-widest text-aurora uppercase font-mono">
            NOVA STUDIO
          </div>
          <h1 className="text-2xl font-bold font-heading mt-1">{t('auth.brandTitle')}</h1>
          <p className="text-sm text-slate-400 mt-2">
            {mode === 'login' ? t('auth.subtitleLogin') : t('auth.subtitleRegister')}
          </p>
        </div>

        <div className="rounded-2xl glass-panel-elevated p-6 space-y-5">
          {/* Перемикач вкладок */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-950/60 border border-white/[0.06]">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`py-2 rounded-lg text-xs font-bold transition-all ${
                  mode === m
                    ? 'bg-amber-500 text-slate-950 shadow-[0_0_16px_-6px_rgba(245,158,11,0.8)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'login' ? t('auth.tabLogin') : t('auth.tabRegister')}
              </button>
            ))}
          </div>

          {error && (
            <div
              className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'register' && (
              <div>
                <label className="text-xs text-slate-400 block mb-1.5" htmlFor="auth-name">
                  {t('auth.nameLabel')}
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('auth.namePlaceholder')}
                    autoComplete="name"
                    className="field-glow w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-sm text-slate-100"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-xs text-slate-400 block mb-1.5" htmlFor="auth-email">
                {t('auth.emailLabel')}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="field-glow w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-sm text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1.5" htmlFor="auth-password">
                {t('auth.passwordLabel')}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? t('auth.passwordPlaceholderRegister') : '••••••••'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  className="field-glow w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-950/60 border border-white/[0.08] text-sm text-slate-100"
                />
              </div>
            </div>

            <button
              id="auth-submit-btn"
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-sm shadow-[0_0_24px_-8px_rgba(245,158,11,0.7)] transition-all disabled:opacity-60"
            >
              <span>{busy ? t('auth.submitWait') : mode === 'login' ? t('auth.submitLogin') : t('auth.submitRegister')}</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </form>

          {googleEnabled && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/[0.08]" />
                <span className="text-[10px] uppercase tracking-wider text-slate-500">{t('auth.or')}</span>
                <div className="flex-1 h-px bg-white/[0.08]" />
              </div>
              <a
                id="auth-google-btn"
                href="/api/auth/google"
                className="w-full flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 font-semibold text-sm transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.2 5.4-4.6 7l7.6 5.9c4.4-4.1 6.7-10.1 6.7-17.4z" />
                  <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.3 0 20 0 24s1 7.7 2.6 10.8l7.8-6.1z" />
                  <path fill="#34A853" d="M24 48c6.2 0 11.5-2.1 15.3-5.6l-7.6-5.9c-2.1 1.4-4.8 2.3-7.7 2.3-6.4 0-11.7-3.7-13.6-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
                </svg>
                <span>{t('auth.continueWithGoogle')}</span>
              </a>
            </>
          )}

          <div className="pt-1 border-t border-white/[0.06]">
            <button
              id="auth-guest-btn"
              type="button"
              onClick={onContinueAsGuest}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl badge-glass hover:border-slate-400/40 text-slate-300 font-semibold text-xs transition-all"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{t('auth.continueAsGuest')}</span>
            </button>
            <p className="text-[11px] text-slate-500 mt-2.5 leading-relaxed text-center">
              {t('auth.guestNote1')}
              <br />
              {t('auth.guestNote2')}
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-slate-500">
          <Sparkles className="w-3 h-3 text-amber-400/70" />
          <span>{t('auth.footerNote')}</span>
        </div>
      </div>
    </div>
  );
};
