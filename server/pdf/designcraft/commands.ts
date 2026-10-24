/**
 * Команда DesignCraft як ДАНІ, а не як рядок скрипта.
 *
 * ЧОМУ ЦЕ ОКРЕМО. Той самий конвеєр тепер їде двома транспортами: старий
 * пише `.dcs`-файл і запускає `designcraft-cli script`, новий віддає команди
 * живій сесії через інструмент `batch` (`./session.ts`). Якби кожен транспорт
 * будував команди сам, порівняння швидкості нічого не вартувало б — ми
 * міряли б дві різні верстки. Тому команди будуються один раз у вигляді
 * `{command, params}`, а рядок скрипта — лише одна з двох їх серіалізацій.
 *
 * Формат рядка — `crates/engine/src/script.rs`: `command.id {json}`.
 */

export interface DesigncraftCommand {
  command: string;
  params: Record<string, unknown>;
}

export function cmd(command: string, params: Record<string, unknown> = {}): DesigncraftCommand {
  return { command, params };
}

/** Один крок у вигляді рядка `.dcs`-скрипта. */
export function serializeCommand(step: DesigncraftCommand): string {
  return `${step.command} ${JSON.stringify(step.params)}`;
}

export function serializeCommands(steps: readonly DesigncraftCommand[]): string[] {
  return steps.map(serializeCommand);
}

/** Готовий текст скрипта: по кроку на рядок, із кінцевим переходом. */
export function serializeScript(steps: readonly DesigncraftCommand[]): string {
  return `${serializeCommands(steps).join('\n')}\n`;
}
