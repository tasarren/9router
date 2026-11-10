import assert from "node:assert/strict";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";
import { formatNanCredits, formatNanTokenUsage } from "../../open-sse/services/usage/nan.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

assert.equal(new Set(REGISTRY.map((item) => item.id)).size, REGISTRY.length, "provider IDs must be unique");
for (const id of ["nan", "tinyfish", "v1m", "muse", "minimax-code", "minimax-code-global", "bedrock", "bedrock-xai", "sensenova", "deepseek-web", "gemini-web", "muse-web", "chatgpt-web", "veoaifree-web", "uc-web"]) {
  assert.equal(REGISTRY.filter((item) => item.id === id).length, 1, `${id} must be registered once`);
}
for (const id of ["trae", "devin-cli", "windsurf"]) {
  assert.equal(REGISTRY.some((item) => item.id === id), false, `${id} must remain disabled`);
}
const nan = REGISTRY.find((item) => item.id === "nan");
assert(nan);
assert.equal(nan.models.find((item) => item.id === "rerank").kind, "rerank");
assert.equal(nan.models.find((item) => item.id === "flux-2-klein").kind, "image");
assert.equal(nan.imageConfig.editUrl, "https://api.nan.builders/v1/images/edits");
assert.equal(getCapabilitiesForModel("nan", "mimo-v2.5").audioInput, true);
assert.equal(getCapabilitiesForModel("nan", "glm5.3-flash").vision, true);
assert.equal(getCapabilitiesForModel("nan", "glm5.3").vision, false);
const retry = await parseUpstreamError(new Response('{"error":{"message":"slow down"}}', {
  status: 429, headers: { "retry-after": "60" },
}));
assert(retry.resetsAtMs > Date.now() + 59000 && retry.resetsAtMs < Date.now() + 61000);
// Shape captured from cloud.nan.builders /api/usage/credits (2026-11-10), trimmed.
const creditsReport = {
  enabled: true, tier: "inference", periodStart: "2026-11-01T15:06:22Z", periodEnd: "2026-12-01T15:06:22Z",
  allowanceCredits: 7000, usedCredits: 20.9, remainingCredits: 6979.1, packCredits: 0,
  models: [
    { model: "deepseek-v4-flash", creditsThisMonth: 20.9, tokensThisMonth: 20572549 },
    { model: "kimi-k3.1-pro", creditsThisMonth: 0, tokensThisMonth: 24 },
    { model: "broken" },
  ],
};
const resetAt = "2026-12-01T15:06:22Z";
assert.deepEqual(formatNanCredits(creditsReport).quotas, {
  credits: { used: 20.9, total: 7000, resetAt, unit: "credits" },
  "deepseek-v4-flash": { used: 20.9, total: 7000, resetAt, unit: "credits" },
  "kimi-k3.1-pro": { used: 0, total: 7000, resetAt, unit: "credits" },
});
for (const bad of [null, {}, { ...creditsReport, enabled: false }, { ...creditsReport, allowanceCredits: 0 }, { ...creditsReport, usedCredits: "1" }]) {
  assert.match(formatNanCredits(bad).message, /unavailable/i);
}

// Shape of public /v1/usage (2026-11-10), trimmed.
const tokenReport = { totals: { by_model: [
  { model: "deepseek-v4-flash", total_tokens: 1114030742, api_requests: 6382 },
  { model: "kimi-k3.1-pro", total_tokens: 24, api_requests: 1 },
  { model: "", total_tokens: 1 },
] } };
assert.deepEqual({ ...formatNanTokenUsage(tokenReport, resetAt).quotas }, {
  "deepseek-v4-flash": { used: 1114030742, total: 0, resetAt, unit: "tokens", limitUnknown: true, apiRequests: 6382 },
  "kimi-k3.1-pro": { used: 24, total: 0, resetAt, unit: "tokens", limitUnknown: true, apiRequests: 1 },
});
assert.match(formatNanTokenUsage({}, resetAt).message, /unavailable/i);
assert.equal(nan.transport.usage.url, "https://api.nan.builders/v1/usage");
assert.equal(nan.transport.usage.creditsUrl, "https://cloud-api.nan.builders/api/usage/credits");

const nanExec = new DefaultExecutor("nan");
const msgs = [{ role: "user", content: "hi" }];
assert.deepEqual(nanExec.transformRequest("gemma4", { messages: msgs, stream: true }, true, {}).stream_options, { include_usage: true });
assert.equal(nanExec.transformRequest("gemma4", { messages: msgs }, false, {}).stream_options, undefined);
assert.deepEqual(nanExec.transformRequest("gemma4", { messages: msgs, stream_options: { include_usage: false } }, true, {}).stream_options, { include_usage: false });
console.log("NaN provider and usage OK");
