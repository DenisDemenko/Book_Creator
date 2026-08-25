import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Loader2, Pencil, Trash2, Save, X, AlertTriangle, CheckSquare, Square } from 'lucide-react';
import type { AuthUser, Book } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface StyleViewProps {
  book: Book;
  authUser: AuthUser | null;
  /** Відповіді автора з виконаних вправ майстерності — щоб файл стилю враховував не лише текст книги. */
  completedTaskAnswers: string[];
}

interface StyleData {
  contentMd: string;
  autoUseStyle: boolean;
  updatedAt: string;
  sourceChars: number;
}

/** Дуже маленький Markdown-рендер лише під формат файлу стилю (## заголовки, - списки, звичайні абзаци) — без нової залежності. */
function renderStyleMarkdown(md: string): React.ReactNode {
  const lines = md.split('\n');
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={key} className="list-disc list-inside space-y-1 text-sm text-slate-300 mb-3">
        {listBuffer.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList(`list-${idx}`);
      return;
    }
    if (trimmed.startsWith('## ')) {
      flushList(`list-${idx}`);
      blocks.push(
        <h4 key={idx} className="text-sm font-bold text-cyan-300 uppercase tracking-wide mt-4 mb-2 first:mt-0">
          {trimmed.replace(/^##\s+/, '').replace(/_/g, ' ')}
        </h4>
      );
    } else if (trimmed.startsWith('# ')) {
      flushList(`list-${idx}`);
      blocks.push(
        <h3 key={idx} className="text-base font-bold text-slate-100 mt-4 mb-2 first:mt-0">
          {trimmed.replace(/^#\s+/, '')}
        </h3>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      listBuffer.push(trimmed.replace(/^[-*]\s+/, ''));
    } else {
      flushList(`list-${idx}`);
      blocks.push(
        <p key={idx} className="text-sm text-slate-300 mb-2 leading-relaxed">
          {trimmed}
        </p>
      );
    }
  });
  flushList('list-end');
  return blocks;
}

export const StyleView: React.FC<StyleViewProps> = ({ book, authUser, completedTaskAnswers }) => {
  const { t } = useLanguage();
  const userId = authUser?.id || null;

  const [styleData, setStyleData] = useState<StyleData | null>(null);
  const [loading, setLoading] = useState(!!userId);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/style/${userId}`, { credentials: 'same-origin' })
      .then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setStyleData(data);
      })
      .catch(() => {
        if (!cancelled) setError(t('styleView.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const sourceText = useMemo(() => {
    const bookText = book.chapters
      .flatMap((ch) => ch.sections.map((sec) => sec.content))
      .filter(Boolean)
      .join('\n\n');
    const exercisesText = completedTaskAnswers.filter(Boolean).join('\n\n');
    return [bookText, exercisesText].filter(Boolean).join('\n\n');
  }, [book.chapters, completedTaskAnswers]);

  const handleGenerate = async () => {
    if (!userId) return;
    if (!sourceText.trim()) {
      setError(t('styleView.noSourceText'));
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/style/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sourceText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'failed');
      setStyleData(data);
    } catch {
      setError(t('styleView.generateError'));
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleAutoUse = async () => {
    if (!userId || !styleData) return;
    const next = !styleData.autoUseStyle;
    setStyleData({ ...styleData, autoUseStyle: next });
    try {
      const res = await fetch(`/api/style/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ autoUseStyle: next }),
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      setStyleData((prev) => (prev ? { ...prev, autoUseStyle: !next } : prev));
      setError(t('styleView.saveError'));
    }
  };

  const handleStartEdit = () => {
    if (!styleData) return;
    setEditDraft(styleData.contentMd);
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!userId) return;
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/style/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ contentMd: editDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'failed');
      setStyleData(data);
      setIsEditing(false);
    } catch {
      setError(t('styleView.saveError'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!userId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/style/${userId}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) throw new Error('failed');
      setStyleData(null);
      setShowDeleteConfirm(false);
    } catch {
      setError(t('styleView.deleteError'));
    } finally {
      setDeleting(false);
    }
  };

  if (!userId) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <Sparkles className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-400">{t('styleView.needsLogin')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            {t('styleView.heading')}
          </h3>
          <p className="text-xs text-slate-500 mt-1">{t('styleView.hint')}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t('styleView.loading')}</span>
        </div>
      ) : !styleData ? (
        <div className="text-center py-10 nova-glass-dark rounded-2xl border border-slate-800">
          <p className="text-sm text-slate-400 mb-5">{t('styleView.emptyState')}</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="mx-auto flex items-center gap-2 px-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>{generating ? t('styleView.generating') : t('styleView.generateBtn')}</span>
          </button>
          {generating && <p className="text-[11px] text-slate-500 mt-3">{t('styleView.generatingHint')}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>{t('styleView.updatedAt', { date: new Date(styleData.updatedAt).toLocaleString() })}</span>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 font-semibold disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>{t('styleView.regenerateBtn')}</span>
            </button>
          </div>

          <div className="nova-glass-dark rounded-2xl border border-slate-800 p-5">
            {isEditing ? (
              <>
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={16}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                  >
                    <X className="w-3.5 h-3.5" />
                    {t('styleView.cancelEdit')}
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={savingEdit}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50"
                  >
                    {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {t('styleView.saveEdit')}
                  </button>
                </div>
              </>
            ) : (
              <>
                {renderStyleMarkdown(styleData.contentMd)}
                <button
                  onClick={handleStartEdit}
                  className="mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-200"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {t('styleView.editBtn')}
                </button>
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <button
              onClick={handleToggleAutoUse}
              className="flex items-center gap-2 text-xs font-semibold text-slate-300"
            >
              {styleData.autoUseStyle ? (
                <CheckSquare className="w-4 h-4 text-cyan-400" />
              ) : (
                <Square className="w-4 h-4 text-slate-500" />
              )}
              <span>{t('styleView.autoUseCheckbox')}</span>
            </button>

            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('styleView.deleteBtn')}
            </button>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto mb-3" />
            <p className="text-sm text-slate-200 font-semibold mb-1">{t('styleView.deleteConfirmTitle')}</p>
            <p className="text-xs text-slate-500 mb-5">{t('styleView.deleteConfirmHint')}</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                {t('styleView.cancelEdit')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {t('styleView.deleteConfirmBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
