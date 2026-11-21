import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cache = new Map<string, string>();

export function bookWritingInstructions(language: unknown): string {
  const filename = language === 'en' ? 'SKILL.en.md' : 'SKILL.md';
  const cached = cache.get(filename);
  if (cached) return cached;
  const base = dirname(fileURLToPath(import.meta.url));
  const source = join(base, 'fusion-book-writing', filename);
  const bundled = join(base, 'ai-skills', 'fusion-book-writing', filename);
  const instructions = readFileSync(existsSync(source) ? source : bundled, 'utf8');
  cache.set(filename, instructions);
  return instructions;
}
