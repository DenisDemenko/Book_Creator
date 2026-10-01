/**
 * Звіт якості «живих персонажів» у Markdown (Т2.8 В1, `PLAN_QUALITY.md`):
 * числа для кожного виміру, ворота, порівняння з Jev / без Jev, час і вартість.
 * JSON-звіт — це сам `QualityReport`.
 */

import type { QualityModeResult, QualityReport } from './livingCharacters';

const MODE_TITLE: Record<string, string> = { with_jev: 'з Jev', without_jev: 'без Jev (запасний LLM)' };
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 1000) / 10}%`);
const num = (x: number | null) => (x == null ? '—' : String(x));
const usd = (x: number) => `$${x.toFixed(x < 0.01 ? 6 : 4)}`;

function row(title: string, pick: (m: QualityModeResult) => string, modes: QualityModeResult[]): string {
  return `| ${title} | ${modes.map(pick).join(' | ')} |`;
}

export function renderQualityReport(r: QualityReport): string {
  const modes = r.modes;
  const head = `| Вимір | ${modes.map((m) => MODE_TITLE[m.mode] ?? m.mode).join(' | ')} |\n|---|${modes.map(() => '---').join('|')}|`;
  const lines: string[] = [
    `# Якість живих персонажів — набір «${r.setId}» v${r.setVersion}`,
    '',
    `${r.label ? `Прогін: ${r.label}. ` : ''}Почато ${r.startedAt}, завершено ${r.finishedAt}. Підсумок: **${r.passed ? 'ворота пройдено' : 'ворота НЕ пройдено'}**.`,
    '',
    head,
    row('кейсів / з відповіддю', (m) => `${m.metrics.turns} / ${m.metrics.answered}`, modes),
    row('ізоляція знань: витоків (ходів із перевіркою)', (m) => `${m.metrics.isolation.leaks} (${m.metrics.isolation.checked})`, modes),
    row('спойлери: витоків (ходів із перевіркою)', (m) => `${m.metrics.spoilers.leaks} (${m.metrics.spoilers.checked})`, modes),
    row('точність пам\'яті', (m) => `${pct(m.metrics.memory.accuracy)} (${m.metrics.memory.hits}/${m.metrics.memory.cases})`, modes),
    row('різних дій Jev', (m) => `${m.metrics.diversity.distinctActions} — ${Object.entries(m.metrics.diversity.actions).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`, modes),
    row('унікальних біграм у відповідях', (m) => pct(m.metrics.diversity.distinctBigramRatio), modes),
    row('повторів відповіді', (m) => pct(m.metrics.diversity.repetitionRate), modes),
    row('сталість на перефразуваннях', (m) => `${pct(m.metrics.consistency.rate)} (${m.metrics.consistency.consistent}/${m.metrics.consistency.pairs})`, modes),
    row('частка запасного шляху', (m) => pct(m.metrics.performance.fallbackShare), modes),
    row('затримка ходу, середня / p95', (m) => `${m.metrics.performance.latencyAvgMs} / ${m.metrics.performance.latencyP95Ms} мс`, modes),
    row('голос: токени вхід / вихід', (m) => `${m.metrics.performance.voiceInputTokens} / ${m.metrics.performance.voiceOutputTokens}`, modes),
    row('рішення: викликів, токени вхід / вихід', (m) => `${m.metrics.performance.decisionCalls}, ${m.metrics.performance.decisionInputTokens} / ${m.metrics.performance.decisionOutputTokens}`, modes),
    row('вартість: голос + рішення = разом', (m) => `${usd(m.metrics.performance.voiceCostUsd)} + ${usd(m.metrics.performance.decisionCostUsd)} = ${usd(m.metrics.performance.totalCostUsd)}`, modes),
    row('вартість на хід', (m) => usd(m.metrics.performance.costPerTurnUsd), modes),
    row('тривалість прогону', (m) => `${Math.round(m.durationMs / 100) / 10} с`, modes),
    '',
    '## Ворота',
    '',
  ];
  for (const m of modes) {
    lines.push(`**${MODE_TITLE[m.mode] ?? m.mode}** — ${m.passed ? 'пройдено' : 'НЕ пройдено'}`, '');
    for (const g of m.gates) lines.push(`- ${g.passed ? '✓' : '✗'} ${g.title}: ${num(g.value)} (${g.limit})${g.kind === 'hard' ? '' : ' — якісні'}`);
    const ex = [...m.metrics.isolation.examples, ...m.metrics.spoilers.examples];
    if (ex.length) lines.push('', 'Витоки:', ...ex.map((e) => `- ${e}`));
    if (m.metrics.memory.misses.length) lines.push('', `Пам'ять не прозвучала: ${m.metrics.memory.misses.join(', ')}.`);
    lines.push('');
  }
  lines.push('## Ходи', '');
  for (const m of modes) {
    lines.push(`### ${MODE_TITLE[m.mode] ?? m.mode}`, '', '| Кейс | Вимір | Дія | Джерело | Відповідь |', '|---|---|---|---|---|');
    for (const t of m.turns) {
      const text = t.status === 'answered' ? t.reply : `[${t.status}] ${t.error ?? ''}`;
      lines.push(`| ${t.caseId} | ${t.dimension} | ${t.action ?? '—'} | ${t.source ?? '—'} | ${text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 160)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
