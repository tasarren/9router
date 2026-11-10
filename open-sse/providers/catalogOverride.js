// Read side of the model catalog synced from models.dev.
//
// The file is the source of truth; the only thing held in memory is a parsed
// copy dropped as soon as the file's mtime changes. getCapabilitiesForModel is
// synchronous and runs per request, so the hot path is one stat (~1us) and the
// parse (~0.1ms on a ~18KB file) only reruns after a sync.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";

export const CATALOG_FILE = path.join(DATA_DIR, "model-catalog.json");
// Trimmed upstream catalog, read by the add-models skill (not by the router).
export const CATALOG_RAW_FILE = path.join(DATA_DIR, "model-catalog-raw.json");

// Schema of the file this module reads. The writer stamps it; a file carrying an
// older value predates provider-scoped modality keys, and its flat keys are not
// looked up here, so the sync rebuilds it instead of asking upstream for a 304.
export const CATALOG_VERSION = 2;

const EMPTY = { models: {}, providers: {} };
let cache = EMPTY;
let cachedMtime = -1;

// "zai-org/GLM-4.6V:free" -> "glm-4.6v"
function baseId(model) {
  if (!model) return "";
  const withoutVendor = model.includes("/") ? model.split("/").pop() : model;
  return withoutVendor.toLowerCase().split(":")[0];
}

function load() {
  let mtime;
  try {
    mtime = fs.statSync(CATALOG_FILE).mtimeMs;
  } catch {
    cache = EMPTY;
    cachedMtime = -1;
    return cache;
  }
  if (mtime === cachedMtime) return cache;

  cachedMtime = mtime;
  try {
    const parsed = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    cache = { models: parsed?.models || {}, providers: parsed?.providers || {} };
  } catch {
    cache = EMPTY;
  }
  return cache;
}

// Modalities are recorded per gateway upstream, and gateways disagree about the
// same weights — some do not proxy images at all — so the key is provider +
// model, in the local provider id space, exactly like the limits below. Keying
// by model id alone made short ids collide across vendors: "auto", "free" and
// "efficient" are router modes in one catalog and model names in another, and a
// request to the router mode inherited a stranger's vision.
export function getCatalogModalities(provider, model) {
  if (!provider) return null;
  return load().models[`${provider}:${baseId(model)}`] || null;
}

// Context and output limits are a property of the gateway too: each one
// truncates differently, so these stay keyed by provider + model.
export function getCatalogLimits(provider, model) {
  const byProvider = provider && load().providers[provider];
  if (!byProvider) return null;
  return byProvider[model] || byProvider[baseId(model)] || null;
}

// Force a re-read on the next lookup (called right after a sync writes the file).
export function invalidateCatalog() {
  cachedMtime = -1;
}

// Model lists fetched from each provider's own API (Codex /models, Anthropic
// /v1/models), persisted so /v1/models and the limits survive restarts. Their
// limits beat every other source, the hardcoded table included. Same mtime
// cache as above: the writer and the request path may hold separate copies.
export const LIVE_MODELS_FILE = path.join(DATA_DIR, "live-models.json");
let live = {};
let liveMtime = -1;

function loadLive() {
  let mtime;
  try {
    mtime = fs.statSync(LIVE_MODELS_FILE).mtimeMs;
  } catch {
    live = {};
    liveMtime = -1;
    return live;
  }
  if (mtime === liveMtime) return live;
  liveMtime = mtime;
  try {
    live = JSON.parse(fs.readFileSync(LIVE_MODELS_FILE, "utf8")) || {};
  } catch {
    live = {};
  }
  return live;
}

const ALIAS_TO_PROVIDER = Object.fromEntries(Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id]));

// [{ id, name, upstreamModelId?, kind?, contextWindow?, maxOutput? }] or null.
export function getLiveModels(provider) {
  const all = provider && loadLive();
  return (all && (all[provider] || all[ALIAS_TO_PROVIDER[provider]])?.models) || null;
}

export function getLiveLimits(provider, model) {
  if (!model) return null;
  const bare = model.split("/").pop();
  const found = getLiveModels(provider)?.find((m) => m.id === model || m.id === bare);
  if (!found || !(found.contextWindow > 0 || found.maxOutput > 0)) return null;
  return { contextWindow: found.contextWindow, maxOutput: found.maxOutput };
}

// Replace a provider's stored list. An empty list (failed fetch) keeps the old one.
export function saveLiveModels(provider, models) {
  const kept = (models || []).filter((m) => m?.id).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    ...(m.upstreamModelId && { upstreamModelId: m.upstreamModelId }),
    ...(m.kind && { kind: m.kind }),
    ...(m.contextWindow > 0 && { contextWindow: m.contextWindow }),
    ...(m.maxOutput > 0 && { maxOutput: m.maxOutput }),
  }));
  if (!kept.length) return;
  try {
    const next = { ...loadLive(), [provider]: { fetchedAt: new Date().toISOString(), models: kept } };
    fs.mkdirSync(path.dirname(LIVE_MODELS_FILE), { recursive: true });
    fs.writeFileSync(`${LIVE_MODELS_FILE}.tmp`, JSON.stringify(next), "utf8");
    fs.renameSync(`${LIVE_MODELS_FILE}.tmp`, LIVE_MODELS_FILE);
    liveMtime = -1;
  } catch (error) {
    console.log("Failed to store live models:", error.message);
  }
}

// Hand the reader to capabilities.js. That module is bundled into the browser
// too, so it cannot import this file directly — the server pushes it in.
export async function installCatalogSource() {
  const { setCatalogSource } = await import("./capabilities.js");
  setCatalogSource({ getModalities: getCatalogModalities, getLimits: getCatalogLimits, getLiveLimits });
}
