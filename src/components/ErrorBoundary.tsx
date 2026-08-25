import React from 'react';
import { AlertTriangle, RefreshCw, FileDown, ChevronDown, ChevronUp } from 'lucide-react';
import { loadBook } from '../utils/storage';
import type { Book } from '../types';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Викликається при спробі повторного рендеру — щоб застосунок міг скинути свій стан. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string;
  rescue: 'idle' | 'working' | 'done' | 'failed';
  rescueNote: string;
  showDetails: boolean;
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(name: string): string {
  return (name || 'rukopys').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60);
}

/** Збирає читабельний Markdown із глав і секцій книги. */
function bookToMarkdown(book: Book): string {
  const lines: string[] = [];
  lines.push(`# ${book.title || 'Без назви'}`);
  // Підзаголовок навмисно не робимо заголовком рівня 2 — цей рівень
  // зарезервовано за главами, інакше зміст у редакторах Markdown попливе.
  if (book.subtitle) lines.push('', `*${book.subtitle}*`);
  lines.push('');
  if (book.author) lines.push(`**Автор:** ${book.author}`);
  if (book.genre) lines.push(`**Жанр:** ${book.genre}`);
  lines.push(`**Версія:** ${book.version || 'v1.0.0'}`);
  lines.push(`**Аварійна копія створена:** ${new Date().toLocaleString('uk-UA')}`);
  lines.push('', '---', '');

  for (const chapter of book.chapters || []) {
    lines.push(`## ${chapter.title || 'Глава без назви'}`, '');
    for (const section of chapter.sections || []) {
      lines.push(`### ${section.title || 'Секція без назви'}`, '');
      lines.push(section.content || '', '');
    }
  }
  return lines.join('\n');
}

/**
 * Межа помилок навколо робочої області.
 *
 * Головна вимога: якщо застосунок упав, автор мусить мати можливість
 * витягнути свій текст. Тому екран відновлення читає книгу напряму
 * з IndexedDB, не покладаючись на React-стан, який уже може бути зіпсований.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    componentStack: '',
    rescue: 'idle',
    rescueNote: '',
    showDetails: false,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Помилка рендеру:', error, info);
    this.setState({ componentStack: info?.componentStack || '' });
  }

  handleRescue = async (): Promise<void> => {
    this.setState({ rescue: 'working', rescueNote: '' });
    try {
      const book = await loadBook();
      if (!book) {
        this.setState({
          rescue: 'failed',
          rescueNote: 'У сховищі не знайдено збереженої книги.',
        });
        return;
      }

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const base = safeFilename(book.title);

      // JSON першим: це повна копія проекту, найцінніше для відновлення.
      download(`${base}_proekt_${stamp}.json`, JSON.stringify(book, null, 2), 'application/json');
      // Markdown — щоб текст одразу можна було читати й правити.
      download(`${base}_avariyna-kopiya_${stamp}.md`, bookToMarkdown(book), 'text/markdown');

      // Файли вже збережені — з цієї миті операція вважається успішною.
      // Підрахунок слів лише прикрашає повідомлення й не може її провалити.
      let note = 'Завантажено два файли: рукопис і повну копію проекту.';
      try {
        const words = (book.chapters || []).reduce(
          (acc, c) =>
            acc +
            (c.sections || []).reduce(
              (s, x) => s + (x.content || '').trim().split(/\s+/).filter(Boolean).length,
              0
            ),
          0
        );
        note = `Завантажено два файли: рукопис (${words} слів) та повну копію проекту.`;
      } catch {
        /* залишаємо загальне формулювання */
      }

      this.setState({ rescue: 'done', rescueNote: note });
    } catch (err) {
      console.error('[ErrorBoundary] Не вдалося прочитати книгу зі сховища', err);
      this.setState({
        rescue: 'failed',
        rescueNote: 'Не вдалося прочитати книгу зі сховища браузера.',
      });
    }
  };

  handleReset = (): void => {
    this.setState({ error: null, componentStack: '', rescue: 'idle', rescueNote: '' });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    const { error, componentStack, rescue, rescueNote, showDetails } = this.state;

    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-2xl glass-panel-elevated p-7 space-y-5">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-rose-500/15 text-rose-300 border border-rose-500/30 shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold font-heading text-slate-100">
                Модуль аварійно зупинився
              </h1>
              <p className="text-sm text-slate-300 mt-1.5 leading-relaxed">
                Сталася помилка, і цей екран не вдалося показати. Ваш текст залишився у сховищі
                браузера — збережіть його у файл, перш ніж робити щось інше.
              </p>
            </div>
          </div>

          {/* Головна дія — врятувати рукопис */}
          <div className="rounded-xl bg-slate-950/50 border border-white/[0.08] p-4 space-y-3">
            <button
              onClick={this.handleRescue}
              disabled={rescue === 'working'}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-sm shadow-[0_0_28px_-8px_rgba(245,158,11,0.65)] transition-all disabled:opacity-60"
            >
              <FileDown className="w-4 h-4 stroke-[2.5]" />
              <span>
                {rescue === 'working' ? 'Читаємо сховище…' : 'Зберегти рукопис у файл'}
              </span>
            </button>

            {rescueNote && (
              <p
                className={`text-xs leading-relaxed ${
                  rescue === 'done' ? 'text-emerald-300' : 'text-rose-300'
                }`}
                role="status"
              >
                {rescueNote}
              </p>
            )}

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Буде завантажено два файли: <strong className="text-slate-300">.md</strong> —
              читабельний рукопис по главах, і <strong className="text-slate-300">.json</strong> —
              повна копія проекту для відновлення.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 px-4 py-2 rounded-xl badge-glass hover:border-slate-400/40 text-slate-200 font-semibold text-xs transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Спробувати показати ще раз
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl badge-glass hover:border-slate-400/40 text-slate-200 font-semibold text-xs transition-all"
            >
              Перезавантажити сторінку
            </button>
          </div>

          {/* Технічні деталі — згорнуті, щоб не лякати автора */}
          <div className="pt-2 border-t border-white/[0.06]">
            <button
              onClick={() => this.setState({ showDetails: !showDetails })}
              className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1.5 transition-colors"
              aria-expanded={showDetails}
            >
              {showDetails ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              Технічні деталі для розробника
            </button>

            {showDetails && (
              <pre className="mt-3 p-3 rounded-lg bg-slate-950/80 border border-white/[0.06] text-[10px] text-slate-400 font-mono overflow-auto max-h-56 whitespace-pre-wrap">
                {error.name}: {error.message}
                {error.stack ? `\n\n${error.stack}` : ''}
                {componentStack ? `\n\nComponent stack:${componentStack}` : ''}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }
}
