import { describe, expect, it } from "vitest";
import { routesModel } from "../../src/sse/services/auth.js";
import { parseAntigravityModels } from "../../src/lib/liveModels.js";

const conn = (psd) => ({ providerSpecificData: psd });

describe("routesModel", () => {
  it("routes everything without rules", () => {
    expect(routesModel(conn(undefined), "claude-fable-5-2")).toBe(true);
    expect(routesModel(conn({ blockedModels: [] }), "claude-fable-5-2")).toBe(true);
  });

  it("quota-only accounts serve nothing", () => {
    expect(routesModel(conn({ routingDisabled: true }), "claude-sonnet-5")).toBe(false);
  });

  it("blocks exact ids and * patterns, case-insensitive, ignoring [1m]", () => {
    const c = conn({ blockedModels: ["claude-fable-*", "GPT-6-astra"] });
    expect(routesModel(c, "claude-fable-5-2")).toBe(false);
    expect(routesModel(c, "claude-fable-5-2", "claude-fable-5-2[1m]")).toBe(false);
    expect(routesModel(c, "gpt-6-astra")).toBe(false);
    expect(routesModel(c, "claude-sonnet-5")).toBe(true);
    expect(routesModel(c, "gpt-6-astra-x")).toBe(true);
  });

  it("treats regex characters in patterns literally", () => {
    expect(routesModel(conn({ blockedModels: ["gemini-3.8-flash"] }), "gemini-3x8-flash")).toBe(true);
  });
});

describe("parseAntigravityModels", () => {
  it("drops internal entries and keeps limits plus registry upstream ids", () => {
    const models = parseAntigravityModels({
      models: {
        "gemini-3.8-flash-high": { displayName: "Gemini 3.8 Flash (High)", maxTokens: 1048576, maxOutputTokens: 65536 },
        "internal-x": { isInternal: true },
        "tab_flash": {},
        "new-model": {},
      },
    });
    expect(models).toEqual([
      { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)", upstreamModelId: "gemini-3.8-flash-high(high)", contextWindow: 1048576, maxOutput: 65536 },
      { id: "new-model", name: "new-model" },
    ]);
  });
});
