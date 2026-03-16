"use client";

import { Hypothesis, Evidence } from "@/lib/types";
import {
  X, AlertTriangle, Flame, Car, Shield, Construction, CloudRain,
  Ban, Activity, Radio, Camera, Rss, Phone, Clock, MapPin,
  TrendingUp, Zap, ChevronRight, ExternalLink
} from "lucide-react";
import { useState, useEffect } from "react";

interface IncidentDetailProps {
  hypothesis: Hypothesis;
  onClose: () => void;
  onOpenCamera: (cameraId: string) => void;
  onFlyTo: (lat: number, lng: number) => void;
}

const TYPE_ICONS: Record<string, any> = {
  accident: Car, fire: Flame, congestion: Activity, construction: Construction,
  medical: Activity, hazard: AlertTriangle, police: Shield,
  road_closure: Ban, weather: CloudRain, other: Radio,
};

const SOURCE_ICONS: Record<string, any> = {
  "511": Rss, camera: Camera, scanner: Radio, dispatch: Phone,
};

const SOURCE_LABELS: Record<string, string> = {
  "511": "511 Traffic API", camera: "Vision Analysis (Camera)", scanner: "Legacy Feed", dispatch: "DataSF Dispatch",
};

const SOURCE_COLORS: Record<string, string> = {
  camera: "#ef4444", scanner: "#facc15", "511": "#3b82f6", dispatch: "#a855f7",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#06b6d4",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW",
};

const STATE_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  candidate: { label: "CANDIDATE", color: "#6b7280", desc: "Single-source detection, awaiting corroboration" },
  corroborated: { label: "CORROBORATED", color: "#22c55e", desc: "Confirmed by multiple independent sources" },
  active: { label: "ACTIVE", color: "#3b82f6", desc: "High-confidence active incident" },
  resolving: { label: "RESOLVING", color: "#f59e0b", desc: "Confidence decaying, incident may be clearing" },
  cleared: { label: "CLEARED", color: "#374151", desc: "Incident resolved or expired" },
};

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function estimateImpact(hyp: Hypothesis): {
  delayMin: number;
  affectedMiles: number;
  rippleRings: Array<{ radiusMi: number; label: string; color: string }>;
} {
  const severityMultiplier = { critical: 4, high: 3, medium: 2, low: 1 }[hyp.severity] || 1;
  const typeMultiplier = {
    accident: 3, fire: 3.5, road_closure: 2.5, congestion: 2,
    construction: 1.5, medical: 1, police: 1.5, hazard: 1.5, weather: 2, other: 1,
  }[hyp.type] || 1;

  const delayMin = Math.round(severityMultiplier * typeMultiplier * hyp.confidence * 5);
  const affectedMiles = +(severityMultiplier * typeMultiplier * 0.3 * hyp.confidence).toFixed(1);

  const rippleRings = [
    { radiusMi: affectedMiles * 0.3, label: "Direct Impact", color: SEVERITY_COLORS[hyp.severity] },
    { radiusMi: affectedMiles * 0.6, label: "Delay Zone", color: SEVERITY_COLORS[hyp.severity] + "80" },
    { radiusMi: affectedMiles, label: "Ripple Effect", color: SEVERITY_COLORS[hyp.severity] + "40" },
  ];

  return { delayMin, affectedMiles, rippleRings };
}

export default function IncidentDetail({ hypothesis: hyp, onClose, onOpenCamera, onFlyTo }: IncidentDetailProps) {
  const Icon = TYPE_ICONS[hyp.type] || AlertTriangle;
  const sevColor = SEVERITY_COLORS[hyp.severity];
  const stateInfo = STATE_LABELS[hyp.state] || STATE_LABELS.candidate;
  const impact = estimateImpact(hyp);
  const [imageError, setImageError] = useState(false);

  const uniqueSources = [...new Set(hyp.evidence.map((e) => e.source))];
  const cameraEvidence = hyp.evidence.find((e) => e.source === "camera" && e.sourceId);
  const sortedEvidence = [...hyp.evidence].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Distance from YC office
  const ycLat = 37.7604, ycLng = -122.3886;
  const dLat = (hyp.lat - ycLat) * 69; // rough miles
  const dLng = (hyp.lng - ycLng) * 54.6;
  const distFromYC = Math.sqrt(dLat * dLat + dLng * dLng);
  const dirFromYC = dLat > 0 ? (dLng > 0 ? "NE" : "NW") : (dLng > 0 ? "SE" : "SW");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-4xl max-h-[85vh] bg-[#0a0a12]/95 border border-white/[0.1] rounded-t-2xl shadow-2xl shadow-black/80 backdrop-blur-xl pointer-events-auto overflow-hidden flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-white/[0.08]">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: sevColor + "15", border: `1px solid ${sevColor}30` }}
          >
            <Icon size={20} style={{ color: sevColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-[15px] font-mono text-white/90 tracking-wide uppercase">
                {hyp.type.replace("_", " ")}
              </h2>
              <span
                className="text-[9px] font-mono tracking-[0.2em] px-2 py-0.5 rounded-full"
                style={{ color: sevColor, backgroundColor: sevColor + "15", border: `1px solid ${sevColor}30` }}
              >
                {SEVERITY_LABELS[hyp.severity]}
              </span>
              <span
                className="text-[9px] font-mono tracking-[0.2em] px-2 py-0.5 rounded-full"
                style={{ color: stateInfo.color, backgroundColor: stateInfo.color + "15", border: `1px solid ${stateInfo.color}30` }}
              >
                {stateInfo.label}
              </span>
            </div>
            <p className="text-[12px] font-mono text-white/50 mt-0.5">{hyp.locationLabel}</p>
          </div>
          <div className="text-right">
            <div className="text-[22px] font-mono tabular-nums" style={{ color: sevColor }}>
              {(hyp.confidence * 100).toFixed(0)}%
            </div>
            <div className="text-[8px] font-mono text-white/25 tracking-wider">CONFIDENCE</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white/40 hover:text-white/70 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-3 gap-0 divide-x divide-white/[0.06]">
            {/* Left column: Details + Impact */}
            <div className="col-span-2 p-6 space-y-5">
              {/* Description */}
              <div>
                <p className="text-[13px] font-mono text-white/70 leading-relaxed">
                  {hyp.description}
                </p>
                <div className="flex items-center gap-4 mt-3 text-[10px] font-mono text-white/30">
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    Detected {timeAgo(hyp.detectedAt)} at {formatTime(hyp.detectedAt)}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin size={10} />
                    {distFromYC.toFixed(1)} mi {dirFromYC} of YC
                  </span>
                </div>
              </div>

              {/* Impact Analysis */}
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <Zap size={11} className="text-white/30" />
                  <span className="text-[9px] font-mono text-white/30 tracking-[0.2em] uppercase">
                    Predicted Impact
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-[20px] font-mono tabular-nums" style={{ color: sevColor }}>
                      {impact.delayMin}<span className="text-[11px] text-white/30 ml-1">min</span>
                    </div>
                    <div className="text-[8px] font-mono text-white/20 tracking-wider mt-0.5">EST. DELAY</div>
                  </div>
                  <div>
                    <div className="text-[20px] font-mono tabular-nums" style={{ color: sevColor }}>
                      {impact.affectedMiles}<span className="text-[11px] text-white/30 ml-1">mi</span>
                    </div>
                    <div className="text-[8px] font-mono text-white/20 tracking-wider mt-0.5">IMPACT RADIUS</div>
                  </div>
                  <div>
                    <div className="text-[20px] font-mono tabular-nums text-white/60">
                      {uniqueSources.length}<span className="text-[11px] text-white/30 ml-1">src</span>
                    </div>
                    <div className="text-[8px] font-mono text-white/20 tracking-wider mt-0.5">DATA SOURCES</div>
                  </div>
                </div>

                {/* Ripple visualization */}
                <div className="flex items-center gap-3 mt-4 pt-3 border-t border-white/[0.05]">
                  <div className="flex items-center gap-1">
                    {impact.rippleRings.map((ring, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <div
                          className="w-3 h-3 rounded-full border-2"
                          style={{ borderColor: ring.color, backgroundColor: i === 0 ? ring.color : "transparent" }}
                        />
                        <span className="text-[8px] font-mono text-white/25">{ring.label} ({ring.radiusMi.toFixed(1)}mi)</span>
                        {i < impact.rippleRings.length - 1 && <ChevronRight size={8} className="text-white/10 mx-1" />}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* State explanation */}
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp size={11} className="text-white/30" />
                  <span className="text-[9px] font-mono text-white/30 tracking-[0.2em] uppercase">
                    Hypothesis State
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {/* State pipeline */}
                  {(["candidate", "corroborated", "active", "resolving", "cleared"] as const).map((state, i) => {
                    const info = STATE_LABELS[state];
                    const isCurrent = state === hyp.state;
                    const isPast = ["candidate", "corroborated", "active", "resolving", "cleared"].indexOf(hyp.state) > i;
                    return (
                      <div key={state} className="flex items-center gap-2">
                        {i > 0 && <div className="w-4 h-px" style={{ backgroundColor: isPast || isCurrent ? info.color + "60" : "rgba(255,255,255,0.06)" }} />}
                        <div
                          className="text-[7px] font-mono tracking-wider px-1.5 py-0.5 rounded"
                          style={{
                            color: isCurrent ? info.color : isPast ? info.color + "60" : "rgba(255,255,255,0.15)",
                            backgroundColor: isCurrent ? info.color + "15" : "transparent",
                            border: isCurrent ? `1px solid ${info.color}30` : "1px solid transparent",
                          }}
                        >
                          {info.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] font-mono text-white/25 mt-2">{stateInfo.desc}</p>
              </div>

              {/* View Camera button */}
              {cameraEvidence && (
                <button
                  onClick={() => onOpenCamera(cameraEvidence.sourceId.replace("overshoot-", ""))}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-mono text-cyan-400/80 bg-cyan-400/[0.06] border border-cyan-400/20 rounded-xl hover:bg-cyan-400/[0.1] transition-colors tracking-wider"
                >
                  <Camera size={14} />
                  OPEN LIVE CAMERA FEED
                  <ExternalLink size={10} />
                </button>
              )}
            </div>

            {/* Right column: Evidence Timeline */}
            <div className="p-5">
              <div className="flex items-center gap-1.5 mb-4">
                <Clock size={11} className="text-white/30" />
                <span className="text-[9px] font-mono text-white/30 tracking-[0.2em] uppercase">
                  Evidence Timeline
                </span>
              </div>

              <div className="space-y-0">
                {sortedEvidence.map((ev, i) => {
                  const EvIcon = SOURCE_ICONS[ev.source] || Radio;
                  const srcColor = SOURCE_COLORS[ev.source] || "#6b7280";
                  const isLast = i === sortedEvidence.length - 1;

                  return (
                    <div key={i} className="flex gap-3">
                      {/* Timeline line */}
                      <div className="flex flex-col items-center">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: srcColor + "15", border: `1.5px solid ${srcColor}40` }}
                        >
                          <EvIcon size={11} style={{ color: srcColor }} />
                        </div>
                        {!isLast && (
                          <div className="w-px flex-1 min-h-[20px] bg-white/[0.06]" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="pb-4 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono tracking-wider uppercase" style={{ color: srcColor }}>
                            {SOURCE_LABELS[ev.source] || ev.source}
                          </span>
                        </div>
                        <div className="text-[9px] font-mono text-white/20 mt-0.5">
                          {formatTime(ev.timestamp)} ({timeAgo(ev.timestamp)})
                        </div>
                        {ev.summary && (
                          <p className="text-[10px] font-mono text-white/40 mt-1 leading-relaxed">
                            {ev.summary}
                          </p>
                        )}
                        <div className="text-[8px] font-mono text-white/15 mt-1">
                          Weight: {(ev.weight * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Source summary */}
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <div className="text-[8px] font-mono text-white/20 tracking-wider uppercase mb-2">
                  Sources Contributing
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {uniqueSources.map((src) => {
                    const count = hyp.evidence.filter((e) => e.source === src).length;
                    const srcColor = SOURCE_COLORS[src] || "#6b7280";
                    return (
                      <div
                        key={src}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-mono"
                        style={{ backgroundColor: srcColor + "10", border: `1px solid ${srcColor}20`, color: srcColor }}
                      >
                        {src.toUpperCase()}
                        <span className="text-white/20">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Coordinates */}
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <button
                  onClick={() => onFlyTo(hyp.lat, hyp.lng)}
                  className="flex items-center gap-2 text-[9px] font-mono text-white/25 hover:text-white/50 transition-colors"
                >
                  <MapPin size={10} />
                  {hyp.lat.toFixed(6)}, {hyp.lng.toFixed(6)}
                  <ExternalLink size={8} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up {
          animation: slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </div>
  );
}
