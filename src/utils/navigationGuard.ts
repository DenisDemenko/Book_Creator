/** App tab changes wait for mounted editors that have pending writes. */
const guards = new Set<() => Promise<unknown>>();
export function registerNavigationGuard(guard: () => Promise<unknown>): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}
export function guardedNavigation(action: () => void): void {
  if (!guards.size) { action(); return; }
  void Promise.all([...guards].map((guard) => guard())).then(action).catch(() => {
    // The editor displays the failed save and stays mounted.
  });
}
