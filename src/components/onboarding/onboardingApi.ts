/**
 * Запити опитувальника ролі (Т6.3 В3) і реєстр ролей для клієнта: відповідь
 * `/api/collaboration/roles` → мінімальне визначення онтології співпраці, яке
 * розуміє спільна перевірка `roleOnboarding.ts` (без дублювання ролей у
 * компонентах, №4).
 */
import type { CollabOntologyDefinition, RoleDefinition } from '../../utils/collabOntology';

export class OnbError extends Error {
  constructor(message: string, readonly status: number, readonly kind?: string, readonly issues?: any[]) {
    super(message);
  }
}

export async function onb<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new OnbError((data as any).error || `Помилка ${res.status}`, res.status, (data as any).kind, (data as any).issues);
  return data as T;
}

export interface RolesResponse {
  roles: Array<{
    id: string;
    label: { en: string; uk: string };
    description: { en: string; uk: string } | null;
    category: string;
    projectTypes: string[];
    workspace: string;
    aiProfile?: string;
    combinable?: boolean;
    legacyIds?: string[];
    suggestedCapabilities: string[];
    requiresSpecialization: boolean;
    specializations: string[];
    singleHolder: boolean;
    deprecated: boolean;
  }>;
  categories: Array<{ id: string; name: { en: string; uk: string } }>;
  projectTypes: Array<{ id: string; name: { en: string; uk: string } }>;
  entryIntents: Array<{ id: string; name: { en: string; uk: string } }>;
  scopeTypes: Array<{ id: string; name: { en: string; uk: string } }>;
  capabilities: Array<{ id: string; name: { en: string; uk: string } }>;
}

export interface ClientRegistry {
  def: CollabOntologyDefinition;
  raw: RolesResponse;
}

/** Відповідь API → визначення для перевірки (лише поля, які вона читає). */
export function toRegistry(raw: RolesResponse): ClientRegistry {
  const roles: RoleDefinition[] = raw.roles.map((r, i) => ({
    id: r.id,
    label: r.label,
    category: r.category,
    projectTypes: r.projectTypes,
    defaultWorkspace: r.workspace,
    suggestedCapabilities: r.suggestedCapabilities,
    aiProfile: r.aiProfile ?? `${r.workspace}_default`,
    status: r.deprecated ? 'deprecated' : 'active',
    requiresSpecialization: r.requiresSpecialization,
    specializations: r.specializations,
    singleHolder: r.singleHolder,
    combinable: r.combinable ?? true,
    invitable: false,
    legacyIds: r.legacyIds ?? [],
    order: i,
    description: r.description ?? undefined,
  }));
  const def = {
    roles,
    roleCategories: raw.categories,
    projectTypes: raw.projectTypes,
    entryIntents: raw.entryIntents,
    scopeTypes: raw.scopeTypes,
    capabilities: raw.capabilities,
    workspaces: [],
  } as unknown as CollabOntologyDefinition;
  return { def, raw };
}

export interface OnboardingSession {
  id: string;
  projectId: string | null;
  projectType: string | null;
  entryIntent: string | null;
  source: string;
  sourceOrderId: string | null;
  currentStep: number;
  status: 'draft' | 'completed' | 'cancelled';
  answers: Record<string, any>;
  revision: number;
}

export interface GateInfo {
  enabled: boolean;
  required: boolean;
  reason: 'first_login' | 'resume' | 'no_role' | 'pending_request' | null;
  session: OnboardingSession | null;
  request: { id: string; status: string; level: string; scope: string; createdAt: string } | null;
  roles: string[];
  /** Id чужих курсів, де людина — учасник із доступом. */
  sharedCourses?: string[];
}

export const fetchGate = (projectId?: string | null) => onb<GateInfo>('GET', `/api/core/onboarding/gate${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
