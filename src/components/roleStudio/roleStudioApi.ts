/**
 * Запити «Мого простору» й «Моєї ролі у проєкті» (Т6.4 В3) і маршрут ШІ для
 * підказок у модулях. Сервер — `/api/core/projects/:id/my-role`, `…/ai-route`.
 */
import { onb } from '../onboarding/onboardingApi';
import type { AiRoute, AiTask } from '../../utils/aiWorkflows';

export interface MyRoleEntry {
  assignmentId: string;
  roleId: string;
  specialization: string | null;
  workspace: string | null;
  label: { en: string; uk: string } | null;
  combinable: boolean;
  requiresSpecialization: boolean;
  specializations: string[];
  singleHolder: boolean;
}

export interface PendingRequest {
  id: string;
  kind: 'access' | 'role';
  roles: { roleId: string; specialization: string | null }[];
  level: string | null;
  scope: string;
  replaces: string[];
  createdAt: string;
}

export interface MyRoleView {
  projectId: string;
  projectType: string;
  isOwner: boolean;
  isAdmin: boolean;
  selfAssign: boolean;
  participant: { id: string; status: string } | null;
  roles: MyRoleEntry[];
  workspaces: string[];
  activeWorkspace: string | null;
  aiAssistance: string[];
  roleDetails: Record<string, string[]>;
  pending: { role: PendingRequest | null; access: PendingRequest | null };
}

export interface RoleChangeResult {
  kind: 'assigned' | 'requested';
  request: PendingRequest | null;
  view: MyRoleView;
}

const base = (projectId: string) => `/api/core/projects/${encodeURIComponent(projectId)}/my-role`;

export const fetchMyRole = (projectId: string) => onb<MyRoleView>('GET', base(projectId));
export const addMyRole = (projectId: string, body: { roleId: string; specialization?: string | null; scope?: string | null; capabilities?: string[]; message?: string }) =>
  onb<RoleChangeResult>('POST', `${base(projectId)}/roles`, body);
export const changeMySpecialization = (projectId: string, assignmentId: string, specialization: string, message?: string) =>
  onb<RoleChangeResult>('PUT', `${base(projectId)}/roles/${encodeURIComponent(assignmentId)}/specialization`, { specialization, message });
export const removeMyRole = (projectId: string, assignmentId: string) => onb<MyRoleView>('DELETE', `${base(projectId)}/roles/${encodeURIComponent(assignmentId)}`);
export const leaveMyProject = (projectId: string) => onb<{ left: true; revokedRoles: number; revokedGrants: number }>('POST', `${base(projectId)}/leave`);
export const setMyWorkspace = (projectId: string, workspace: string) => onb<MyRoleView>('PUT', `${base(projectId)}/workspace`, { workspace });
export const cancelRequest = (projectId: string, requestId: string) =>
  onb('POST', `/api/core/projects/${encodeURIComponent(projectId)}/access-requests/${encodeURIComponent(requestId)}/cancel`);

/** Маршрут ШІ для підказки в модулі; короткий кеш на сторінці, щоб модулі не питали сервер щоразу. */
const routeCache = new Map<string, { at: number; value: Promise<AiRoute | null> }>();
export function fetchAiRoute(projectId: string, task: AiTask): Promise<AiRoute | null> {
  const key = `${projectId}\u0000${task}`;
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < 20_000) return hit.value;
  const value = onb<{ route: AiRoute | null }>('GET', `/api/core/projects/${encodeURIComponent(projectId)}/ai-route?task=${task}`)
    .then((r) => r.route)
    .catch(() => null);
  routeCache.set(key, { at: Date.now(), value });
  return value;
}
export function forgetAiRoutes(): void {
  routeCache.clear();
}

/** Подія Студії: ролі чи простір у проєкті змінились — перечитати «Мій простір», меню й підказки. */
export const ROLE_SPACE_EVENT = 'nova:role-space-changed';
export function announceRoleSpaceChanged(projectId: string): void {
  forgetAiRoutes();
  window.dispatchEvent(new CustomEvent(ROLE_SPACE_EVENT, { detail: { projectId } }));
}
