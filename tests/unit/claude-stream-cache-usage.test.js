import { test, expect } from "vitest";
import { extractUsage, mergeUsage, canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";
import { translateResponse } from "../../open-sse/translator/index.js";

// Claude stream translated to OpenAI: stored prompt_tokens counts cache once.
test("claude->openai stream usage is not double-counted", () => {
  const state = {};
  const chunks = [
    { type: "message_start", message: { id: "m", model: "claude", usage: { input_tokens: 2, cache_read_input_tokens: 100000, cache_creation_input_tokens: 500, output_tokens: 1 } } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 300 } },
  ];
  for (const c of chunks) {
    const e = extractUsage(c);
    if (e) state.usage = mergeUsage(state.usage, e);
    translateResponse("claude", "openai", c, state);
  }
  expect(canonicalizeUsage(state.usage)).toMatchObject({
    prompt_tokens: 100502, completion_tokens: 300, cached_tokens: 100000, cache_creation_input_tokens: 500,
  });
});

test("claudeCacheTtl sets the conversation breakpoint TTL; system/tools stay 1h", async () => {
  const { prepareClaudeRequest, setClaudeMessageCacheTtl } = await import("../../open-sse/translator/formats/claude.js");
  const body = () => ({
    model: "claude-opus-5-5",
    system: [{ type: "text", text: "sys" }],
    tools: [{ name: "t", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "yo" }] },
      { role: "user", content: [{ type: "text", text: "again" }] },
    ],
  });
  for (const [ttl, expected] of [["1h", { type: "ephemeral", ttl: "1h" }], ["5m", { type: "ephemeral" }], [undefined, { type: "ephemeral" }]]) {
    setClaudeMessageCacheTtl(ttl);
    const out = prepareClaudeRequest(body(), "openrouter");
    expect(out.messages[1].content[0].cache_control).toEqual(expected);
    expect(out.system[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(out.tools[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  }
});

test("1h cache writes are tracked and priced at 2x input", async () => {
  const { calculateCostFromTokens } = await import("../../open-sse/providers/pricing.js");
  const state = {};
  const start = { type: "message_start", message: { id: "m", usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 }, output_tokens: 1 } } };
  const delta = { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } };
  for (const c of [start, delta]) {
    const e = extractUsage(c);
    if (e) state.usage = mergeUsage(state.usage, e);
    translateResponse("claude", "openai", c, state);
  }
  const tokens = canonicalizeUsage(state.usage);
  expect(tokens).toMatchObject({ prompt_tokens: 1000, cache_creation_input_tokens: 1000, cache_creation_1h_input_tokens: 600 });
  const cost = calculateCostFromTokens(tokens, { input: 4, output: 20, cached: 0.2, cache_creation: 5 });
  expect(cost).toBeCloseTo((400 * 5 + 600 * 8) / 1e6, 10);
});
