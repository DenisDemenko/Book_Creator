import React, { useState } from 'react';
import { X, BookOpen, Check, ArrowRight } from 'lucide-react';
import { UserRole } from '../types';
import { ALL_ROLES, getRoleInfo } from '../utils/rbac';
import { useLanguage } from '../i18n/LanguageContext';

interface InviteRoleChoiceModalProps {
  bookTitle: string;
  invitedRole: UserRole;
  onConfirm: (role: UserRole) => void;
  onCancel: () => void;
}

/**
 * Вікно вибору ролі входу після cowork-запрошення.
 *
 * Користувач обирає роль, у якій входить у книгу письменника; вона має
 * збігатися з роллю, вказаною в листі-запрошенні. Якщо обрано іншу роль —
 * показуємо помилку й не пускаємо в студію.
 */
export const InviteRoleChoiceModal: React.FC<InviteRoleChoiceModalProps> = ({
  bookTitle,
  invitedRole,
  onConfirm,
  onCancel,
}) => {
  const { t, lang } = useLanguage();
  const [selected, setSelected] = useState<UserRole>(invitedRole);
  const [error, setError] = useState<string | null>(null);

  const roleName = (role: UserRole) => {
    const info = getRoleInfo(role);
    return lang === 'en' ? info.nameEn : info.nameUk;
  };

  // Усі ролі спільної роботи, крім гостя (гість — не роль книги).
  const collabRoles = ALL_ROLES.filter((r) => r.id !== 'guest');

  const handleConfirm = () => {
    if (selected !== invitedRole) {
      setError(t('inviteAccept.roleChoiceMismatch', { role: roleName(invitedRole) }));
      return;
    }
    setError(null);
    onConfirm(invitedRole);
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white">{t('inviteAccept.roleChoiceHeading')}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                {t('inviteAccept.roleChoiceSubheading', { title: bookTitle })}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            title={t('inviteAccept.roleChoiceCancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Книга, в яку входить користувач */}
        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-xs text-slate-200 font-semibold truncate">{bookTitle}</span>
        </div>

        {/* Вибір ролі */}
        <div className="space-y-2">
          {collabRoles.map((r) => {
            const isInvited = r.id === invitedRole;
            const isSelected = r.id === selected;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r.id)}
                className={`w-full p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                  isSelected
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-slate-700 bg-slate-950/50 hover:border-slate-500'
                }`}
              >
                <span className="text-base shrink-0">{r.badgeEmoji}</span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-xs font-bold truncate ${isSelected ? 'text-amber-200' : 'text-slate-200'}`}>
                    {roleName(r.id)}
                  </span>
                  <span className={`block text-[10px] truncate ${isSelected ? 'text-amber-300/70' : 'text-slate-500'}`}>
                    {lang === 'en' ? r.descriptionEn : r.descriptionUk}
                  </span>
                </span>
                {isInvited && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 border border-amber-500/40 text-amber-300 whitespace-nowrap shrink-0">
                    {t('inviteAccept.roleChoiceInvitedBadge')}
                  </span>
                )}
                {isSelected && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs leading-relaxed">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-all border border-slate-700"
          >
            {t('inviteAccept.roleChoiceCancel')}
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-all"
          >
            <ArrowRight className="w-4 h-4" />
            <span>{t('inviteAccept.roleChoiceConfirm')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
