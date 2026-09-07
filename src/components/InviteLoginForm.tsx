import React, { useState } from 'react';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface InviteLoginFormProps {
  firebaseEnabled: boolean;
  error: string | null;
  onClearError: () => void;
  onLogin: (email: string, password: string) => Promise<boolean>;
  onRegister: (email: string, password: string, name: string) => Promise<boolean>;
  onLoginWithGoogle: () => Promise<boolean>;
}

/**
 * Компактна форма входу/реєстрації у вікні cowork-запрошення:
 * запрошений входить або реєструється прямо у спливаючому вікні
 * (пошта+пароль чи Google), після чого екран сам переходить до книги.
 */
export const InviteLoginForm: React.FC<InviteLoginFormProps> = ({
  firebaseEnabled,
  error,
  onClearError,
  onLogin,
  onRegister,
  onLoginWithGoogle,
}) => {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const inputCls =
    'w-full px-2.5 py-2 rounded-xl bg-slate-950/70 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-amber-400';

  const submit = async () => {
    if (!email.trim() || !password.trim()) return;
    setBusy(true);
    onClearError();
    if (mode === 'login') {
      await onLogin(email.trim(), password);
    } else {
      await onRegister(email.trim(), password, name.trim());
    }
    setBusy(false);
  };

  return (
    <div className="space-y-2.5 text-left">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => {
            setMode('login');
            onClearError();
          }}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
            mode === 'login' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {t('inviteAccept.loginTab')}
        </button>
        <button
          onClick={() => {
            setMode('register');
            onClearError();
          }}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
            mode === 'register' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {t('inviteAccept.registerTab')}
        </button>
      </div>

      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t('inviteAccept.loginEmailPlaceholder')}
        className={inputCls}
      />
      {mode === 'register' && (
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('inviteAccept.loginNamePlaceholder')}
          className={inputCls}
        />
      )}
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t('inviteAccept.loginPasswordPlaceholder')}
        className={inputCls}
      />

      {error && (
        <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px] leading-relaxed">
          {error}
        </div>
      )}

      <button
        onClick={() => void submit()}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-bold text-xs transition-all"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'login' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
        <span>{mode === 'login' ? t('inviteAccept.loginSubmitBtn') : t('inviteAccept.registerSubmitBtn')}</span>
      </button>

      {firebaseEnabled && (
        <button
          onClick={() => {
            setBusy(true);
            onClearError();
            void onLoginWithGoogle().finally(() => setBusy(false));
          }}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 text-slate-200 font-bold text-xs transition-all"
        >
          <span className="w-4 h-4 rounded-full bg-white text-slate-900 text-[10px] font-black flex items-center justify-center">G</span>
          <span>{t('inviteAccept.googleBtn')}</span>
        </button>
      )}
    </div>
  );
};
