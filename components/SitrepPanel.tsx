"use client";

import { Hypothesis } from "@/lib/types";
import { AlertTriangle, TrendingUp, Clock, MapPin } from "lucide-react";

interface SitrepPanelProps {
  hypotheses: Hypothesis[];
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export default function SitrepPanel({ hypotheses }: SitrepPanelProps) {
  const critical = hypotheses.filter((h) => h.severity === "critical").length;
  const high = hypotheses.filter((h) => h.severity === "high").length;
  const active = hypotheses.filter((h) => h.state === "active" || h.state === "corroborated").length;
  const total = hypotheses.length;

  // Find worst impact
  const worst = [...hypotheses].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 3;
    const sb = SEVERITY_ORDER[b.severity] ?? 3;
    if (sa !== sb) return sa - sb;
    return b.confidence - a.confidence;
  })[0];

  // Confidence stats
  const avgConfidence = total > 0
    ? hypotheses.reduce((sum, h) => sum + h.confidence, 0) / total
    : 0;

  // Source breakdown
  const sourceCount: Record<string, number> = {};
  for (const h of hypotheses) {
    for (const ev of h.evidence) {
      sourceCount[ev.source] = (sourceCount[ev.source] || 0) + 1;
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="text-[10px] font-mono text-white/40 tracking-[0.15em] uppercase">
          Situation Report
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {/* Severity summary */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white/[0.03] rounded px-3 py-2.5">
            <div className="text-[8px] font-mono text-white/30 tracking-wider uppercase mb-1">Critical</div>
            <div className="text-lg font-mono tabular-nums" style={{ color: critical > 0 ? "#ef4444" : "rgba(255,255,255,0.15)" }}>
              {critical}
            </div>
          </div>
          <div className="bg-white/[0.03] rounded px-3 py-2.5">
            <div className="text-[8px] font-mono text-white/30 tracking-wider uppercase mb-1">High</div>
            <div className="text-lg font-mono tabular-nums" style={{ color: high > 0 ? "#f97316" : "rgba(255,255,255,0.15)" }}>
              {high}
            </div>
          </div>
          <div className="bg-white/[0.03] rounded px-3 py-2.5">
            <div className="text-[8px] font-mono text-white/30 tracking-wider uppercase mb-1">Active</div>
            <div className="text-lg font-mono text-white/60 tabular-nums">{active}</div>
          </div>
          <div className="bg-white/[0.03] rounded px-3 py-2.5">
            <div className="text-[8px] font-mono text-white/30 tracking-wider uppercase mb-1">Total</div>
            <div className="text-lg font-mono text-white/40 tabular-nums">{total}</div>
          </div>
        </div>

        {/* Worst impact */}
        {worst && (
          <div className="bg-white/[0.02] border border-white/[0.06] rounded p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle size={10} className="text-white/30" />
              <span className="text-[8px] font-mono text-white/30 tracking-wider uppercase">Highest Impact</span>
            </div>
            <p className="text-[11px] font-mono text-white/70 leading-relaxed">
              {worst.type.replace("_", " ").toUpperCase()} — {worst.locationLabel}
            </p>
            <p className="text-[9px] font-mono text-white/35 mt-1">{worst.description}</p>
          </div>
        )}

        {/* Confidence overview */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp size={10} className="text-white/30" />
            <span className="text-[8px] font-mono text-white/30 tracking-wider uppercase">Avg Confidence</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${avgConfidence * 100}%`,
                  backgroundColor: avgConfidence > 0.7 ? "#22c55e" : avgConfidence > 0.4 ? "#eab308" : "#ef4444",
                }}
              />
            </div>
            <span className="text-[10px] font-mono text-white/50 tabular-nums w-8 text-right">
              {(avgConfidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Source breakdown */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <MapPin size={10} className="text-white/30" />
            <span className="text-[8px] font-mono text-white/30 tracking-wider uppercase">Sources</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(sourceCount).map(([source, count]) => (
              <div key={source} className="flex items-center gap-1.5 bg-white/[0.04] rounded px-2 py-1">
                <span className="text-[9px] font-mono text-white/50 uppercase">{source}</span>
                <span className="text-[9px] font-mono text-white/25 tabular-nums">{count}</span>
              </div>
            ))}
            {Object.keys(sourceCount).length === 0 && (
              <span className="text-[9px] font-mono text-white/15">No sources yet</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
