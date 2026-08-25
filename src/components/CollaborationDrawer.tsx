import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Users,
  Wifi,
  WifiOff,
  Send,
  Copy,
  Check,
  Radio,
  ShieldCheck,
  MessageSquare,
  Sparkles,
  RefreshCw,
  Crown,
  Feather,
  Palette,
  Globe,
  Building2,
  BookOpen,
  Eye,
  Hash,
  Share2,
  Mail,
  UserPlus,
  Loader2,
  Ban,
  ClipboardCopy
} from 'lucide-react';
import {
  CollaboratorPresence,
  CollabChatMessage,
  RealtimeSyncStatus,
  UserRole,
  NavigationTab,
  Book,
  AuthUser
} from '../types';
import { getRoleInfo } from '../utils/rbac';
import { useLanguage } from '../i18n/LanguageContext';

type CoworkInviteRole = 'designer' | 'publisher' | 'translator';

interface CoworkInvite {
  id: string;
  bookId: string;
  bookTitle: string;
  inviteeEmail: string;
  role: CoworkInviteRole;
  status: 'pending' | 'accepted' | 'revoked';
  emailSent: boolean;
  createdAt: string;
  acceptedAt?: string;
}

interface CollaborationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  currentRole: UserRole;
  currentTab: NavigationTab;
  syncStatus: RealtimeSyncStatus;
  collaborators: CollaboratorPresence[];
  chatMessages: CollabChatMessage[];
  myClientId: string;
  onSendMessage: (text: string, tabContext?: NavigationTab) => void;
  onReconnect: () => void;
  onJumpToTab?: (tab: NavigationTab) => void;
  authUser?: AuthUser | null;
}

export const CollaborationDrawer: React.FC<CollaborationDrawerProps> = ({
  isOpen,
  onClose,
  book,
  currentRole,
  currentTab,
  syncStatus,
  collaborators,
  chatMessages,
  myClientId,
  onSendMessage,
  onReconnect,
  onJumpToTab,
  authUser
}) => {
  const [activeView, setActiveView] = useState<'chat' | 'collaborators' | 'invite'>('chat');
  const [inputMessage, setInputMessage] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { t, lang } = useLanguage();
  const locale = lang === 'en' ? 'en-US' : 'uk-UA';
  const roleName = (info: ReturnType<typeof getRoleInfo>) => (lang === 'en' ? info.nameEn : info.nameUk);

  const isRegistered = !!authUser && !authUser.isGuest;
  // Cowork-режим (запрошення дизайнера/видавця/перекладача до цієї книги) може
  // вмикати лише письменник — та адміністратор сайту, що входить у cowork з
  // тими самими правами (server/collaborationRoutes.ts: assertCanManageInvites).
  const canManageInvites = isRegistered && (currentRole === 'writer' || currentRole === 'admin');

  const [invites, setInvites] = useState<CoworkInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CoworkInviteRole>('designer');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<{ kind: 'success' | 'error'; text: string; link?: string } | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const roleLabels: Record<CoworkInviteRole, string> = {
    designer: t('collaborationDrawer.coworkRoleDesigner'),
    publisher: t('collaborationDrawer.coworkRolePublisher'),
    translator: t('collaborationDrawer.coworkRoleTranslator'),
  };

  const loadInvites = useCallback(async () => {
    if (!book.id || !canManageInvites) return;
    setInvitesLoading(true);
    try {
      const res = await fetch(`/api/collaboration/invites?bookId=${encodeURIComponent(book.id)}`, {
        credentials: 'same-origin',
      });
      if (res.ok) {
        const data = await res.json();
        setInvites(data.invites || []);
      }
    } catch {
      /* тихо — список просто лишиться попереднім */
    } finally {
      setInvitesLoading(false);
    }
  }, [book.id, canManageInvites]);

  useEffect(() => {
    if (activeView === 'invite' && isOpen) {
      loadInvites();
    }
  }, [activeView, isOpen, loadInvites]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    setInviteNotice(null);
    try {
      const res = await fetch('/api/collaboration/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ bookId: book.id, bookTitle: book.title, email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteNotice({ kind: 'error', text: data?.error || t('collaborationDrawer.coworkSendError') });
        return;
      }
      setInviteNotice({
        kind: 'success',
        text: data.emailSent ? t('collaborationDrawer.coworkEmailSentNotice') : t('collaborationDrawer.coworkEmailNotSentNotice'),
        link: data.inviteLink,
      });
      setInviteEmail('');
      loadInvites();
    } catch {
      setInviteNotice({ kind: 'error', text: t('collaborationDrawer.coworkSendError') });
    } finally {
      setInviteSending(false);
    }
  };

  const handleRevokeInvite = async (id: string) => {
    try {
      const res = await fetch(`/api/collaboration/invite/${encodeURIComponent(id)}/revoke`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (res.ok) loadInvites();
    } catch {
      /* тихо */
    }
  };

  const handleCopyInviteResultLink = (link: string, id: string) => {
    navigator.clipboard.writeText(link);
    setCopiedInviteId(id);
    setTimeout(() => setCopiedInviteId(null), 2500);
  };

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeView === 'chat' && isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, activeView, isOpen]);

  // Якщо роль змінилась (перемикач ролей) і доступ до вкладки cowork зник —
  // не лишаємо користувача на вкладці, якої більше немає серед кнопок.
  useEffect(() => {
    if (activeView === 'invite' && !canManageInvites) {
      setActiveView('chat');
    }
  }, [activeView, canManageInvites]);

  if (!isOpen) return null;

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim()) return;
    onSendMessage(inputMessage, currentTab);
    setInputMessage('');
  };

  const handleCopyInviteLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'admin': return Crown;
      case 'writer': return Feather;
      case 'designer': return Palette;
      case 'translator': return Globe;
      case 'publisher': return Building2;
      case 'reader': return BookOpen;
      default: return Feather;
    }
  };

  const formatTabName = (tab?: NavigationTab | string) => {
    switch (tab) {
      case 'start': return t('header.nav.start');
      case 'editor': return t('header.nav.editor');
      case 'mastery': return t('header.nav.mastery');
      case 'scenario': return t('header.nav.scenario');
      case 'characters': return t('header.nav.characters');
      case 'toc': return t('header.nav.toc');
      case 'qr-footnotes': return t('header.nav.qr-footnotes');
      case 'ai-studio': return t('header.nav.ai-studio');
      case 'illustrations': return t('header.nav.illustrations');
      case 'layout': return t('header.nav.layout');
      case 'preview': return t('header.nav.preview');
      case 'cover': return t('header.nav.cover');
      case 'changelog': return t('header.nav.changelog');
      case 'export': return t('header.nav.export');
      case 'media': return t('header.nav.media');
      default: return tab || t('collaborationDrawer.defaultTabName');
    }
  };

  const quickTags = [
    { label: t('collaborationDrawer.tagEdit'), tag: '#правка ' },
    { label: t('collaborationDrawer.tagPlot'), tag: '#сюжет ' },
    { label: t('collaborationDrawer.tagCharacter'), tag: '#персонаж ' },
    { label: t('collaborationDrawer.tagLayout'), tag: '#верстка ' },
    { label: t('collaborationDrawer.tagUrgent'), tag: '#терміново ' },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/70 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col h-full text-slate-100 animate-in slide-in-from-right duration-300"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Users className="w-5 h-5" />
              </div>
              <span className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-slate-900 ${
                syncStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
              }`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">{t('collaborationDrawer.drawerTitle')}</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  syncStatus === 'connected'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}>
                  {syncStatus === 'connected' ? 'WebSockets Live' : t('collaborationDrawer.connectingLabel')}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {t('collaborationDrawer.roomLabelPrefix')} <span className="font-mono text-amber-300">{book.id || 'BK-2084-CYBER'}</span> • {t('header.online', { n: String(collaborators.length) })}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Room Quick Actions & Invite */}
        <div className="p-3 bg-slate-950/50 border-b border-slate-800/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-300 min-w-0">
            <Radio className="w-3.5 h-3.5 text-cyan-400 shrink-0 animate-pulse" />
            <span className="truncate">{t('collaborationDrawer.collabRolesLabel')}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleCopyInviteLink}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 border border-slate-700 transition-all"
              title={t('collaborationDrawer.copyInviteTooltip')}
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5 text-amber-400" />}
              <span>{copiedLink ? t('collaborationDrawer.copiedLabel') : t('collaborationDrawer.inviteBtn')}</span>
            </button>

            {syncStatus !== 'connected' && (
              <button
                onClick={onReconnect}
                className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 text-xs transition-colors"
                title={t('collaborationDrawer.reconnectTooltip')}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation Sub-Tabs */}
        <div className="p-2 border-b border-slate-800 bg-slate-900/60 flex gap-1">
          <button
            onClick={() => setActiveView('chat')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeView === 'chat'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>{t('collaborationDrawer.chatTabBtn', { n: String(chatMessages.length) })}</span>
          </button>

          <button
            onClick={() => setActiveView('collaborators')}
            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeView === 'collaborators'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>{t('collaborationDrawer.participantsTabBtn', { n: String(collaborators.length) })}</span>
          </button>

          {canManageInvites && (
            <button
              onClick={() => setActiveView('invite')}
              className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                activeView === 'invite'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{t('collaborationDrawer.coworkTabBtn')}</span>
            </button>
          )}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeView === 'chat' ? (
            <>
              {chatMessages.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40 text-amber-400" />
                  <p className="text-xs">{t('collaborationDrawer.emptyChatTitle')}</p>
                  <p className="text-[11px] text-slate-600 mt-1">{t('collaborationDrawer.emptyChatDesc')}</p>
                </div>
              ) : (
                chatMessages.map((msg) => {
                  const isMe = msg.clientId === myClientId;
                  const roleDetails = getRoleInfo(msg.role as UserRole);
                  const Icon = getRoleIcon(msg.role as UserRole);

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 px-1">
                        <span className="font-bold text-slate-300">{msg.senderName}</span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-800 text-amber-300 border border-slate-700">
                          {roleName(roleDetails)}
                        </span>
                        {msg.tabContext && (
                          <span className="text-slate-500">
                            • {formatTabName(msg.tabContext)}
                          </span>
                        )}
                        <span className="text-slate-600">
                          {new Date(msg.timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div
                        className={`p-3 rounded-2xl max-w-[88%] text-xs leading-relaxed break-words shadow-md ${
                          isMe
                            ? 'bg-amber-500 text-slate-950 font-medium rounded-tr-xs'
                            : 'bg-slate-800/90 text-slate-100 border border-slate-700 rounded-tl-xs'
                        }`}
                      >
                        {msg.message}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </>
          ) : activeView === 'invite' ? (
            <div className="space-y-4">
              <div className="text-xs text-slate-400">
                {t('collaborationDrawer.coworkDesc')}
              </div>

              {/* Invite form */}
              <form onSubmit={handleSendInvite} className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                  <Mail className="w-3.5 h-3.5 text-amber-400" />
                  {t('collaborationDrawer.coworkHeading')}
                </div>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t('collaborationDrawer.coworkEmailPlaceholder')}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                />
                <div className="flex items-center gap-1.5">
                  {(['designer', 'publisher', 'translator'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setInviteRole(r)}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                        inviteRole === r
                          ? 'bg-amber-500 border-amber-400 text-slate-950'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {roleLabels[r]}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={inviteSending || !inviteEmail.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-xs transition-all"
                >
                  {inviteSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>{inviteSending ? t('collaborationDrawer.coworkSending') : t('collaborationDrawer.coworkSendBtn')}</span>
                </button>

                {inviteNotice && (
                  <div
                    className={`p-2.5 rounded-lg border text-[11px] flex flex-col gap-1.5 ${
                      inviteNotice.kind === 'success'
                        ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                        : 'bg-rose-500/10 border-rose-500/40 text-rose-200'
                    }`}
                  >
                    <span>{inviteNotice.text}</span>
                    {inviteNotice.link && (
                      <button
                        type="button"
                        onClick={() => handleCopyInviteResultLink(inviteNotice.link!, 'notice')}
                        className="self-start flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
                      >
                        {copiedInviteId === 'notice' ? <Check className="w-3 h-3 text-emerald-400" /> : <ClipboardCopy className="w-3 h-3" />}
                        <span>{copiedInviteId === 'notice' ? t('collaborationDrawer.coworkLinkCopied') : t('collaborationDrawer.coworkCopyLinkBtn')}</span>
                      </button>
                    )}
                  </div>
                )}
              </form>

              {/* Invite list */}
              <div className="space-y-2">
                <div className="text-xs text-slate-400">{t('collaborationDrawer.coworkListLabel')}</div>

                {invitesLoading ? (
                  <div className="flex items-center justify-center py-6 text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : invites.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <UserPlus className="w-7 h-7 mx-auto mb-2 opacity-40 text-amber-400" />
                    <p className="text-xs">{t('collaborationDrawer.coworkListEmpty')}</p>
                  </div>
                ) : (
                  invites.map((inv) => (
                    <div
                      key={inv.id}
                      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-200 truncate">{inv.inviteeEmail}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-800 text-amber-300 border border-slate-700">
                            {roleLabels[inv.role]}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                              inv.status === 'accepted'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : inv.status === 'revoked'
                                ? 'bg-slate-800 text-slate-500 border-slate-700'
                                : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                            }`}
                          >
                            {inv.status === 'accepted'
                              ? t('collaborationDrawer.coworkStatusAccepted')
                              : inv.status === 'revoked'
                              ? t('collaborationDrawer.coworkStatusRevoked')
                              : t('collaborationDrawer.coworkStatusPending')}
                          </span>
                          {!inv.emailSent && inv.status === 'pending' && (
                            <span className="text-[10px] text-amber-400">{t('collaborationDrawer.coworkEmailNotSentBadge')}</span>
                          )}
                        </div>
                      </div>
                      {inv.status === 'pending' && (
                        <button
                          onClick={() => handleRevokeInvite(inv.id)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700 transition-colors shrink-0"
                          title={t('collaborationDrawer.coworkRevokeBtn')}
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="text-xs text-slate-400 mb-2">
                {t('collaborationDrawer.collaboratorsListLabel')}
              </div>

              {collaborators.map((user) => {
                const isMe = user.clientId === myClientId;
                const roleDetails = getRoleInfo(user.role as UserRole);
                const Icon = getRoleIcon(user.role as UserRole);

                return (
                  <div
                    key={user.clientId}
                    className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                      isMe 
                        ? 'bg-amber-500/10 border-amber-500/40 text-white' 
                        : 'bg-slate-950/70 border-slate-800 text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative shrink-0">
                        <div 
                          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-md"
                          style={{ backgroundColor: user.color || '#3b82f6', color: '#ffffff' }}
                        >
                          {user.userName ? user.userName.substring(0, 2).toUpperCase() : t('collaborationDrawer.defaultAvatarInitials')}
                        </div>
                        <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-slate-900" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs truncate">
                            {user.userName} {isMe && t('collaborationDrawer.youMarker')}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-800 text-amber-300 border border-slate-700">
                            {roleName(roleDetails)}
                          </span>
                          <span className="text-[10px] text-slate-400 truncate">
                            {formatTabName(user.currentTab)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {user.currentTab && onJumpToTab && (
                      <button
                        onClick={() => onJumpToTab(user.currentTab)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 transition-colors shrink-0"
                        title={t('collaborationDrawer.jumpToTabTooltip', { tab: formatTabName(user.currentTab) })}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Chat Input Bar */}
        {activeView === 'chat' && (
          <div className="p-3 border-t border-slate-800 bg-slate-950">
            {/* Fast Tags */}
            <div className="flex items-center gap-1 mb-2 overflow-x-auto pb-1 no-scrollbar">
              <span className="text-[10px] text-slate-500 mr-1 flex items-center gap-0.5">
                <Hash className="w-3 h-3" /> {t('collaborationDrawer.tagsLabel')}
              </span>
              {quickTags.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => setInputMessage((prev) => prev + item.tag)}
                  className="px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-[10px] text-slate-300 border border-slate-700 transition-colors whitespace-nowrap"
                >
                  {item.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSend} className="flex items-center gap-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={t('collaborationDrawer.chatPlaceholder', { tab: formatTabName(currentTab) })}
                className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
              />
              <button
                type="submit"
                disabled={!inputMessage.trim()}
                className="p-2 rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-40 disabled:hover:bg-amber-500 transition-all active:scale-95 shadow-md shrink-0"
              >
                <Send className="w-4 h-4 stroke-[2.2]" />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
