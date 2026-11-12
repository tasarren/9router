"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Card from "@/shared/components/Card";
import { fmtTokens } from "./UsageTable";

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;
const fmtRequests = (n) => String(n || 0);

const VIEW_MODES = [
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
  { value: "cost", label: "Cost" },
];

const VIEW_CONFIG = {
  tokens:   { dataKey: "tokens",   color: "#6366f1", gradId: "gradTokens",   formatter: fmtTokens,   label: "Tokens" },
  requests: { dataKey: "requests", color: "#14b8a6", gradId: "gradRequests", formatter: fmtRequests, label: "Requests" },
  cost:     { dataKey: "cost",     color: "#f59e0b", gradId: "gradCost",     formatter: fmtCost,     label: "Cost" },
};

const MAX_SERIES = 8;
const OTHER = "__other";
const SERIES_COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#ec4899", "#22c55e", "#3b82f6", "#ef4444", "#a855f7"];
const OTHER_COLOR = "#9ca3af";

// Top MAX_SERIES models by the active metric get their own band; the rest share "Other".
// Series use index keys (s0..) because model names contain dots, which Recharts reads as paths.
function buildSeries(data, metric, showProvider) {
  const totals = {};
  for (const b of data) {
    for (const [key, m] of Object.entries(b.models || {})) totals[key] = (totals[key] || 0) + (m[metric] || 0);
  }
  const ranked = Object.keys(totals).filter((k) => totals[k] > 0).sort((a, b) => totals[b] - totals[a]);
  const top = ranked.slice(0, MAX_SERIES);
  const series = top.map((key, i) => {
    const [model, prov] = key.split("|");
    return { id: key, dataKey: `s${i}`, color: SERIES_COLORS[i], label: showProvider && prov ? `${model} (${prov})` : model, title: key, total: totals[key] };
  });
  const rest = ranked.slice(MAX_SERIES);
  if (rest.length) {
    series.push({ id: OTHER, dataKey: OTHER, color: OTHER_COLOR, label: `Other (${rest.length})`, title: rest.join("\n"), total: rest.reduce((s, k) => s + totals[k], 0) });
  }
  const topIndex = new Map(top.map((k, i) => [k, `s${i}`]));
  const rows = data.map((b) => {
    const row = { label: b.label };
    for (const s of series) row[s.dataKey] = 0;
    for (const [key, m] of Object.entries(b.models || {})) {
      const dk = topIndex.get(key) || (rest.length ? OTHER : null);
      if (dk) row[dk] += m[metric] || 0;
    }
    return row;
  });
  return { series, rows };
}

const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  fontSize: "12px",
};

function SeriesTooltip({ active, payload, label, series, formatter }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const items = series.filter((s) => row[s.dataKey] > 0).sort((a, b) => row[b.dataKey] - row[a.dataKey]);
  const total = series.reduce((sum, s) => sum + (row[s.dataKey] || 0), 0);
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2">
      <div className="mb-1 font-medium">{label}</div>
      {items.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 truncate">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
          <span className="font-mono">{formatter(row[s.dataKey])}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t border-border pt-1 font-medium">
        <span>Total</span>
        <span className="font-mono">{formatter(total)}</span>
      </div>
    </div>
  );
}

export default function UsageChart({ period = "7d", provider = "", account = "" }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("tokens");
  const [hidden, setHidden] = useState(() => new Set());

  const toggleSeries = (id) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setHidden(new Set());
    try {
      const qs = new URLSearchParams({ period });
      if (provider) qs.set("provider", provider);
      if (account) qs.set("account", account);
      const res = await fetch(`/api/usage/chart?${qs}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period, provider, account]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const cfg = VIEW_CONFIG[viewMode];
  const hasData = data.some((d) => (d[cfg.dataKey] || 0) > 0);
  const { series, rows } = useMemo(() => buildSeries(data, cfg.dataKey, !provider), [data, cfg.dataKey, provider]);
  const visible = series.filter((s) => !hidden.has(s.id));

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div
        className="grid w-full items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:w-auto sm:self-start"
        style={{ gridTemplateColumns: `repeat(${VIEW_MODES.length}, minmax(0, 1fr))` }}
      >
        {VIEW_MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setViewMode(m.value)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === m.value ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">Loading...</div>
      ) : !hasData ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">No data for this period</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={series.length ? rows : data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradRequests" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={cfg.formatter}
              width={50}
            />
            {series.length ? (
              <>
                <Tooltip content={<SeriesTooltip series={visible} formatter={cfg.formatter} />} />
                {visible.map((s) => (
                  <Area
                    key={s.id}
                    type="monotone"
                    dataKey={s.dataKey}
                    name={s.label}
                    stackId="models"
                    stroke={s.color}
                    strokeWidth={1.5}
                    fill={s.color}
                    fillOpacity={0.3}
                    dot={false}
                    activeDot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                ))}
              </>
            ) : (
              <>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value) => [cfg.formatter(value), cfg.label]}
                />
                <Area
                  type="monotone"
                  dataKey={cfg.dataKey}
                  stroke={cfg.color}
                  strokeWidth={2}
                  fill={`url(#${cfg.gradId})`}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </>
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}

      {!loading && series.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Models shown in chart">
          {series.map((s) => {
            const shown = !hidden.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={shown}
                title={`${s.title}\n${cfg.formatter(s.total)}`}
                onClick={() => toggleSeries(s.id)}
                className={`flex max-w-[220px] items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs transition-opacity ${shown ? "text-text" : "text-text-muted line-through opacity-50"}`}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="truncate font-mono">{s.label}</span>
              </button>
            );
          })}
          {hidden.size > 0 && (
            <button type="button" onClick={() => setHidden(new Set())} className="px-1 text-xs text-primary hover:underline">
              Reset
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
  provider: PropTypes.string,
  account: PropTypes.string,
};
