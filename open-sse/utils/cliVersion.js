// Live CLI versions for spoofed client fingerprints (claude-cli/x.y.z,
// codex_cli_rs/x.y.z). Upstreams gate new models on a minimum client version
// (Anthropic "claude_code_version_too_old", Codex minimal_client_version), so a
// hardcoded version goes stale with every launch. We resolve the latest
// published npm package, cache it, and never go below the bundled fallback.
//
// Override: <CLI>_CLI_VERSION env (CLAUDE_CLI_VERSION, CODEX_CLI_VERSION) pins a
// version and disables the lookup.

const TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 3000;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

const env = (name) => {
  const value = typeof process !== "undefined" ? process.env?.[name] : null;
  return VERSION_RE.test(value || "") ? value : null;
};

// `prefix` marks the header value carrying the version; `versionHeader` is a
// header that holds the bare version and is rewritten alongside it.
const CLIS = {
  claude: { pkg: "@anthropic-ai/claude-code", prefix: "claude-cli/", pinned: env("CLAUDE_CLI_VERSION") },
  codex: { pkg: "@openai/codex", prefix: "codex_cli_rs/", versionHeader: "version", pinned: env("CODEX_CLI_VERSION") },
};
for (const cli of Object.values(CLIS)) {
  Object.assign(cli, { fallback: "0.0.0", current: null, nextCheckAt: 0, inflight: null });
  cli.re = new RegExp(`${cli.prefix.replace("/", "\\/")}\\d+\\.\\d+\\.\\d+`, "g");
}

function cmp(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export function setCliFallback(id, version) {
  const cli = CLIS[id];
  if (VERSION_RE.test(version) && cmp(version, cli.fallback) > 0) cli.fallback = version;
}

export function getCliVersion(id) {
  const cli = CLIS[id];
  if (cli.pinned) return cli.pinned;
  return cli.current && cmp(cli.current, cli.fallback) > 0 ? cli.current : cli.fallback;
}

async function lookup(cli, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${cli.pkg}/latest`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`npm ${res.status}`);
    const version = (await res.json())?.version;
    if (!VERSION_RE.test(version || "")) throw new Error("bad version");
    cli.current = version;
    cli.nextCheckAt = Date.now() + TTL_MS;
  } catch {
    cli.nextCheckAt = Date.now() + RETRY_MS;
  } finally {
    clearTimeout(timer);
    cli.inflight = null;
  }
}

// Refresh if stale. Awaits at most TIMEOUT_MS; failures keep the last known value.
export async function ensureCliVersion(id, fetchImpl = fetch) {
  const cli = CLIS[id];
  if (cli.pinned || Date.now() < cli.nextCheckAt) return getCliVersion(id);
  if (!cli.inflight) cli.inflight = lookup(cli, fetchImpl);
  await cli.inflight;
  return getCliVersion(id);
}

const entriesOf = (headers) => {
  if (!headers) return [];
  if (typeof Headers !== "undefined" && headers instanceof Headers) return [...headers.entries()];
  return Array.isArray(headers) ? headers : Object.entries(headers);
};

// CLI ids whose fingerprint appears in the header values.
export function detectClis(headers) {
  const values = entriesOf(headers).map(([, v]) => v).filter((v) => typeof v === "string");
  return Object.keys(CLIS).filter((id) => values.some((v) => v.includes(CLIS[id].prefix)));
}

// Rewrite fingerprints in header values to the live versions (object, array or Headers).
export function applyCliVersions(headers, ids = detectClis(headers)) {
  if (!headers || ids.length === 0) return headers;
  const fix = (key, val) => {
    if (typeof val !== "string") return val;
    for (const id of ids) {
      const cli = CLIS[id];
      const v = getCliVersion(id);
      if (cli.versionHeader && key.toLowerCase() === cli.versionHeader && VERSION_RE.test(val)) return v;
      val = val.replace(cli.re, `${cli.prefix}${v}`);
    }
    return val;
  };
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const out = new Headers();
    for (const [k, val] of headers.entries()) out.set(k, fix(k, val));
    return out;
  }
  if (Array.isArray(headers)) return headers.map(([k, val]) => [k, fix(k, val)]);
  return Object.fromEntries(Object.entries(headers).map(([k, val]) => [k, fix(k, val)]));
}
