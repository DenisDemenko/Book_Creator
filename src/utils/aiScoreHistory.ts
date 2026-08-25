/**
 * Фаза 3, 3.3: Портфоліо потребує «середній бал AI-оцінок» — але
 * система жодного разу не накопичувала історію оцінок, лише останню
 * (nova_last_ai_analysis, Фаза 1). Цей файл додає легкий localStorage-
 * журнал, куди AIStudioView (перевірка граматики) та TrainerView
 * (пілотні тренажери) дописують кожен свій бал, а PortfolioView читає
 * агрегат. Той самий підхід, що і в інших localStorage-містках проєкту
 * (nova_writer_mastery_state, nova_last_ai_analysis) — компоненти не
 * мають спільного React-стану, лише один змонтований NavigationTab.
 */

export interface AiScoreEntry {
  /** Джерело оцінки, напр. 'grammar', 'trainer:character', 'trainer:dialogue'. */
  source: string;
  score: number;
  at: string;
}

const STORAGE_KEY = 'nova_ai_score_history';
const MAX_ENTRIES = 300;

export function recordAiScore(source: string, score: number): void {
  if (typeof score !== 'number' || Number.isNaN(score)) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: AiScoreEntry[] = raw ? JSON.parse(raw) : [];
    list.push({ source, score, at: new Date().toISOString() });
    const trimmed = list.slice(-MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* приватний режим / заблоковане сховище — не критично, просто без історії */
  }
}

export function getAiScoreHistory(): AiScoreEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function getAverageAiScore(): { average: number | null; count: number } {
  const history = getAiScoreHistory();
  if (history.length === 0) return { average: null, count: 0 };
  const sum = history.reduce((acc, e) => acc + (e.score || 0), 0);
  return { average: Math.round(sum / history.length), count: history.length };
}
