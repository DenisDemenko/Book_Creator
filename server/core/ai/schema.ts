/**
 * Серверна перевірка відповіді моделі за JSON Schema (Т0.9).
 *
 * Інструкція моделі — лише прохання; гарантію дає тільки перевірка на
 * сервері. Відповідь, що не пройшла схему, не зберігається зовсім (не
 * «частково»): інакше половина висновків з обрізаної чи зіпсованої відповіді
 * виглядала б для автора так само достовірно, як і повна.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = new WeakMap<object, ValidateFunction>();

export interface SchemaCheck<T> {
  ok: boolean;
  value?: T;
  /** Людський перелік помилок — іде в `analysis_runs.error`. */
  errors: string[];
}

function describe(e: ErrorObject): string {
  const where = e.instancePath || '(корінь)';
  return `${where}: ${e.message ?? 'не відповідає схемі'}`;
}

export function validateAgainstSchema<T>(schema: object, data: unknown): SchemaCheck<T> {
  let validate = compiled.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    compiled.set(schema, validate);
  }
  if (validate(data)) return { ok: true, value: data as T, errors: [] };
  return { ok: false, errors: (validate.errors ?? []).slice(0, 10).map(describe) };
}

/**
 * Розбір тексту відповіді як JSON: як є, без markdown-огорожі, або перший
 * `{…}` у тексті (моделі без JSON-режиму люблять пояснення навколо).
 */
export function parseModelJson(raw: string): unknown {
  const text = String(raw ?? '').trim();
  try {
    return JSON.parse(text);
  } catch {
    /* далі */
  }
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    /* далі */
  }
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      /* нижче */
    }
  }
  throw new Error('Відповідь моделі — не JSON');
}
