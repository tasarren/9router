import { describe, it, expect, afterEach } from "vitest";
import { getCapabilitiesForModel, setCatalogSource } from "../../open-sse/providers/capabilities.js";
import { applyCliVersions, detectClis, getCliVersion, setCliFallback } from "../../open-sse/utils/cliVersion.js";

afterEach(() => setCatalogSource(null));

describe("live model limits", () => {
  it("override the hardcoded table for provider id and alias", () => {
    const live = { codex: { "gpt-6-sol[1m]": { contextWindow: 999000 } } };
    setCatalogSource({
      getModalities: () => null,
      getLimits: () => null,
      getLiveLimits: (p, m) => live[p === "cx" ? "codex" : p]?.[m] || null,
    });
    expect(getCapabilitiesForModel("codex", "gpt-6-sol[1m]").contextWindow).toBe(999000);
    expect(getCapabilitiesForModel("cx", "gpt-6-sol[1m]").contextWindow).toBe(999000);
    expect(getCapabilitiesForModel("codex", "gpt-6-sol").contextWindow).not.toBe(999000);
  });
});

describe("cli version rewrite", () => {
  it("rewrites fingerprints and the bare version header", () => {
    setCliFallback("codex", "9.9.9");
    const headers = { "user-agent": "codex_cli_rs/0.1.0 (Linux)", version: "0.1.0", other: "0.1.0" };
    expect(detectClis(headers)).toEqual(["codex"]);
    const out = applyCliVersions(headers);
    expect(getCliVersion("codex")).toBe("9.9.9");
    expect(out["user-agent"]).toBe("codex_cli_rs/9.9.9 (Linux)");
    expect(out.version).toBe("9.9.9");
    expect(out.other).toBe("0.1.0");
  });
});

describe("live endpoint formats", () => {
  it("beat the registry for opencode-go and ignore the thinking suffix", async () => {
    const { getModelSupportedFormats, getModelTargetFormat } = await import("../../open-sse/config/providerModels.js");
    const live = { "kimi-k3": { supportedFormats: ["claude"], targetFormat: "claude" } };
    setCatalogSource({ getModalities: () => null, getLimits: () => null, getLiveFormats: (p, m) => (p === "opencode-go" && live[m.replace(/\(.*\)$/, "")]) || null });
    expect(getModelSupportedFormats("opencode-go", "kimi-k3(high)")).toEqual(["claude"]);
    expect(getModelTargetFormat("opencode-go", "kimi-k3")).toBe("claude");
    expect(getModelSupportedFormats("opencode-go", "glm-5.3")).toEqual(["openai"]);
  });

  it("parse OpenCode Go and NaN catalogs", async () => {
    const { parseOpenCodeGoModels, parseNanModels } = await import("../../src/lib/liveModels.js");
    const go = parseOpenCodeGoModels({ data: [
      { id: "a", name: "A", api: { "chat-completions": {} }, limit: { context: 1000, output: 10 } },
      { id: "b", api: { responses: {} } },
      { id: "c", api: { "generate-content": {} } },
    ] });
    expect(go).toEqual([
      { id: "a", name: "A", supportedFormats: ["openai"], contextWindow: 1000, maxOutput: 10 },
      { id: "b", name: "b", supportedFormats: ["openai-responses"], targetFormat: "openai-responses", contextWindow: undefined, maxOutput: undefined },
    ]);
    const nan = parseNanModels({ data: [{ id: "qwen3-embedding" }, { id: "brand-new" }] });
    expect(nan[0].kind).toBe("embedding");
    expect(nan[1]).toEqual({ id: "brand-new", name: "brand-new" });
  });
});
