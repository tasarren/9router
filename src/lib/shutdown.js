// One shutdown sequence for the whole process. custom-server.js sets
// globalThis.__9rDrain: it stops taking requests, waits for the open ones, then
// calls runShutdownHooks() and exits. Without it (next dev / next start) the first
// SIGINT/SIGTERM runs the hooks and exits at once.
// `late` hooks (database close) run after the rest, which may still write.
const hooks = (globalThis.__9rShutdownHooks ??= []);

export function onShutdown(fn, { late = false } = {}) {
  hooks.push({ fn, late });
  if (globalThis.__9rDrain || globalThis.__9rShutdownSignals) return;
  globalThis.__9rShutdownSignals = true;
  const exit = async () => { await runShutdownHooks(); process.exit(0); };
  process.once("SIGINT", exit);
  process.once("SIGTERM", exit);
}

// custom-server.js (CommonJS, outside the Next bundle) reaches the runner through this.
globalThis.__9rRunShutdownHooks = runShutdownHooks;

export async function runShutdownHooks() {
  const ordered = [...hooks.filter((h) => !h.late), ...hooks.filter((h) => h.late)];
  hooks.length = 0;
  for (const { fn } of ordered) {
    try { await fn(); } catch (error) { console.error("[shutdown] hook failed:", error?.message || error); }
  }
}
