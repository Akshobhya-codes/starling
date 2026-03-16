"use client";

import { Hypothesis, EvidenceSource } from "@/lib/types";
import { AlertTriangle, Flame, Car, Shield, Construction, CloudRain, Ban, Activity, Radio, Camera, Rss, Phone } from "lucide-react";

interface HypothesisPanelProps {
  hypotheses: Hypothesis[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenCamera?: (cameraId: string) => void;
  onOpenDetail?: (hyp: Hypothesis) => void;
}

const TYPE_ICONS: Record<string, any> = {
  accident: Car,
  fire: Flame,
  congestion: Activity,
  construction: Construction,
  medical: Activity,
  hazard: AlertTriangle,
  police: Shield,
  road_closure: Ban,
  weather: CloudRain,
  other: Radio,
};

const SOURCE_ICONS: Record<string, any> = {
  "511": Rss,
  camera: Camera,
  scanner: Radio,
  dispatch: Phone,
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#06b6d4",
};

const SOURCE_COLORS: Record<string, string> = {
  camera: "#ef4444",    // red — AI vision
  scanner: "#facc15",   // yellow — legacy feed
  "511": "#3b82f6",     // blue — traffic feed
  dispatch: "#a855f7",  // purple — dispatch
  multi: "#22c55e",     // green — multi-source
};

function getPrimarySourceColor(hyp: Hypothesis): string {
  const sources = new Set(hyp.evidence.map((e) => e.source));
  if (sources.size >= 2) return SOURCE_COLORS.multi;
  const primary = hyp.evidence[hyp.evidence.length - 1]?.source || "511";
  return SOURCE_COLORS[primary] || SOURCE_COLORS["511"];
}

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  candidate: { label: "CANDIDATE", color: "text-white/20" },
  corroborated: { label: "CORROBORATED", color: "text-emerald-400/60" },
  active: { label: "ACTIVE", color: "text-emerald-400/70" },
  resolving: { label: "RESOLVING", color: "text-amber-400/60" },
  cleared: { label: "CLEARED", color: "text-white/20" },
};

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function HypothesisPanel({ hypotheses, selectedId, onSelect, onOpenCamera, onOpenDetail }: HypothesisPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Source color legend */}
      <div className="px-3 py-1.5 border-b border-white/[0.06] flex items-center gap-3 text-[7px] font-mono text-white/30 tracking-wider">
        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS.camera }} />CAM</div>
        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS["511"] }} />511</div>
        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS.dispatch }} />DISPATCH</div>
        <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS.multi }} />MULTI</div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {hypotheses.length === 0 ? (
          <div className="p-6 text-white/15 text-[10px] font-mono text-center tracking-widest">
            AWAITING SIGNALS
          </div>
        ) : (
          hypotheses.map((hyp) => {
            const Icon = TYPE_ICONS[hyp.type] || AlertTriangle;
            const isSelected = hyp.id === selectedId;
            const color = getPrimarySourceColor(hyp);
            const stateInfo = STATE_LABELS[hyp.state] || STATE_LABELS.candidate;
            const isNew = (Date.now() - new Date(hyp.detectedAt).getTime()) < 30000; // 30s

            return (
              <div
                key={hyp.id}
                onClick={() => onSelect(isSelected ? null : hyp.id)}
                className={`px-4 py-3.5 cursor-pointer transition-all border-b border-white/[0.04] ${
                  isSelected ? "bg-white/[0.04]" : isNew ? "bg-white/[0.03] animate-pulse-once" : "hover:bg-white/[0.02]"
                }`}
              >
                {/* Header row: icon + type + severity dot */}
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon size={12} style={{ color }} className="flex-shrink-0" />
                  <span className="text-[10px] font-mono text-white/70 tracking-wider uppercase flex-1">
                    {hyp.type.replace("_", " ")}
                  </span>
                  {isNew && (
                    <span className="text-[7px] font-mono tracking-wider px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400/70 border border-emerald-400/20">
                      NEW
                    </span>
                  )}
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${hyp.severity === "critical" ? "pulse-dot" : ""}`}
                    style={{ backgroundColor: color }}
                  />
                </div>

                {/* Location */}
                <p className="text-[11px] font-mono text-white/55 leading-relaxed mb-1">
                  {hyp.locationLabel}
                </p>

                {/* Description */}
                <p className="text-[9px] font-mono text-white/30 leading-relaxed mb-2.5 line-clamp-2">
                  {hyp.description}
                </p>

                {/* Confidence bar */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${hyp.confidence * 100}%`,
                        backgroundColor: color,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-white/40 tabular-nums w-7 text-right">
                    {(hyp.confidence * 100).toFixed(0)}%
                  </span>
                </div>

                {/* Metadata row: state, sources, time */}
                <div className="flex items-center gap-2 text-[8px] font-mono">
                  <span className={stateInfo.color}>{stateInfo.label}</span>
                  <span className="text-white/[0.06]">|</span>

                  {/* Source icons */}
                  <div className="flex items-center gap-1">
                    {Array.from(new Set(hyp.evidence.map((e) => e.source))).map((src) => {
                      const SrcIcon = SOURCE_ICONS[src] || Radio;
                      const srcColor = SOURCE_COLORS[src] || "#6b7280";
                      return (
                        <div key={src} className="flex items-center gap-0.5" title={src}>
                          <SrcIcon size={8} style={{ color: srcColor, opacity: 0.7 }} />
                        </div>
                      );
                    })}
                    <span className="text-white/20 tabular-nums ml-0.5">
                      {hyp.evidence.length}
                    </span>
                  </div>

                  <span className="text-white/[0.06]">|</span>
                  <span className="text-white/20">{timeAgo(hyp.lastUpdatedAt)}</span>
                </div>

                {/* Expanded evidence chain */}
                {isSelected && hyp.evidence.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <div className="text-[8px] font-mono text-white/25 tracking-wider uppercase mb-1">
                      Evidence Chain
                    </div>
                    {onOpenDetail && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOpenDetail(hyp); }}
                        className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 text-[9px] font-mono text-white/60 bg-white/[0.04] border border-white/[0.1] rounded hover:bg-white/[0.08] hover:text-white/80 transition-colors tracking-wider"
                      >
                        FULL ANALYSIS
                      </button>
                    )}
                    {(() => {
                      const camEvidence = hyp.evidence.find((e) => e.source === "camera" && e.sourceId);
                      return camEvidence && onOpenCamera ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onOpenCamera(camEvidence.sourceId); }}
                          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-mono text-cyan-400/70 bg-cyan-400/[0.06] border border-cyan-400/20 rounded hover:bg-cyan-400/[0.1] transition-colors"
                        >
                          <Camera size={9} />
                          VIEW CAMERA
                        </button>
                      ) : null;
                    })()}
                    {hyp.evidence.map((ev, i) => {
                      const EvIcon = SOURCE_ICONS[ev.source] || Radio;
                      return (
                        <div key={i} className="flex items-start gap-2 text-[9px] font-mono bg-white/[0.02] border border-white/[0.05] rounded px-2.5 py-1.5">
                          <EvIcon size={9} className="text-white/25 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-white/40 uppercase tracking-wider">{ev.source}</span>
                              <span className="text-white/15">{timeAgo(ev.timestamp)}</span>
                            </div>
                            {ev.summary && (
                              <p className="text-white/30 mt-0.5 leading-relaxed">{ev.summary}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
