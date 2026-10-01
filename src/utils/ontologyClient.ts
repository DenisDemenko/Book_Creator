/**
 * Активна версія онтології в браузері (Т5.1 В3, `PLAN_ONTOLOGY.md`;
 * критерій ТЗ Graph Studio §39 №5 — UI-метадані читаються з реєстру схем).
 *
 * Панелі, слеш-меню, теги в редакторі й чат читають реєстр синхронно з
 * `coreEntities.ts`. Тут цей реєстр замінюється активною версією з сервера:
 *   1. одразу — збережена копія останньої версії (офлайн теж працює);
 *   2. потім — `GET /api/core/ontology` з `If-None-Match`: нова версія
 *      застосовується й зберігається, та сама — 304;
 *   3. без мережі й без копії — вбудований реєстр (документ власника, v1.0).
 * Компоненти підписуються на зміну через `useRegistryRevision()`.
 *
 * Збережена копія — лише зручність (localStorage може бути недоступний):
 * будь-яка помилка тут тихо лишає те, що вже є.
 */
import { useSyncExternalStore } from 'react';
import { registryRevision, subscribeRegistry } from './coreEntities';
import { applyOntology, validateOntology, type OntologyDefinition } from './ontology';

const CACHE_KEY = 'nova.ontology.active.v1';

export interface ActiveOntologyPayload {
  ontologyId: string;
  version: number;
  label: string;
  hash: string;
  publishedAt: string | null;
  source: 'registry' | 'factory';
  definition: OntologyDefinition;
}

let currentHash: string | null = null;
let inflight: Promise<boolean> | null = null;

function applyPayload(p: ActiveOntologyPayload): boolean {
  if (!p || !p.definition || !p.hash) return false;
  if (p.hash === currentHash) return false;
  if (!validateOntology(p.definition).ok) return false;
  applyOntology(p.definition, p.source === 'factory' ? 'factory' : `${p.ontologyId}@${p.version}`);
  currentHash = p.hash;
  return true;
}

function readCache(): ActiveOntologyPayload | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as ActiveOntologyPayload) : null;
  } catch {
    return null;
  }
}

function writeCache(p: ActiveOntologyPayload): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(p));
  } catch {
    /* сховище недоступне — працюємо без копії */
  }
}

/** Застосувати збережену копію, потім звіритися з сервером. true — реєстр змінився. */
export function loadActiveOntology(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    let changed = false;
    if (!currentHash) {
      const cached = readCache();
      if (cached) changed = applyPayload(cached) || changed;
    }
    try {
      const res = await fetchImpl('/api/core/ontology', {
        credentials: 'same-origin',
        headers: currentHash ? { 'If-None-Match': `"${currentHash}"` } : {},
      });
      if (res.status === 200) {
        const payload = (await res.json()) as ActiveOntologyPayload;
        if (applyPayload(payload)) {
          changed = true;
          writeCache(payload);
        }
      }
    } catch {
      /* офлайн — лишається копія чи вбудований реєстр */
    }
    return changed;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Хеш застосованої версії (null — вбудований реєстр). */
export function activeOntologyHash(): string | null {
  return currentHash;
}

/** Номер зміни реєстру — компонент перемальовується, коли застосовано нову версію онтології. */
export function useRegistryRevision(): number {
  return useSyncExternalStore(subscribeRegistry, registryRevision, registryRevision);
}
