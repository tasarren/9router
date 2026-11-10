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
