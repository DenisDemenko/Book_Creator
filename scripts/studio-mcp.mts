/**
 * MCP-сервер Студії на stdio. Логіка — `server/external/studioMcp.ts`.
 *
 * Запуск у клієнта MCP:
 *
 *   NOVA_STUDIO_TOKEN=nst_… node dist/studio-mcp.mjs
 *
 * або, у Claude Code:
 *
 *   claude mcp add nova-studio --env NOVA_STUDIO_TOKEN=nst_… -- node /шлях/dist/studio-mcp.mjs
 *
 * Змінні:
 *   NOVA_STUDIO_TOKEN — особистий токен автора (`nst_…`), створюється в
 *     Студії: Медіатека → Скани з телефону → Підключення застосунку.
 *     ОБОВ'ЯЗКОВА.
 *   NOVA_STUDIO_URL — корінь Студії; типово https://fusionlab.in.ua/studio.
 *
 * Протокол іде в stdout, діагностика — ЛИШЕ в stderr: усе, що потрапить у
 * stdout поза протоколом, клієнт прочитає як зламаний JSON-RPC.
 */
import { createInterface } from 'node:readline';

const { StudioMcpServer } = await import('../server/external/studioMcp');

const token = String(process.env.NOVA_STUDIO_TOKEN || '').trim();
if (!token) {
  console.error(
    'studio-mcp: потрібна змінна NOVA_STUDIO_TOKEN (особистий токен `nst_…`).\n' +
      'Створюється у Студії: Медіатека → Скани з телефону → Підключення застосунку.'
  );
  process.exit(2);
}

const baseUrl = String(process.env.NOVA_STUDIO_URL || 'https://fusionlab.in.ua/studio').trim();
const server = new StudioMcpServer({ baseUrl, token });

// Токен не друкуємо — ні цілком, ні частинами.
console.error(`studio-mcp: MCP-сервер Студії на stdio; база ${baseUrl}`);

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const reply = await server.handleLine(line);
  if (reply) process.stdout.write(`${reply}\n`);
}
