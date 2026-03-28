"use client";

import { useState } from "react";
import { Crosshair, MapPin, Trash2, Eye, Radio, Camera, Image, Pause, Play } from "lucide-react";
import { Bolo } from "@/lib/types";

interface BoloPanelProps {
  bolos: Bolo[];
  onFlyTo?: (lat: number, lng: number) => void;
  onClear?: (id: string) => void;
  onOpenCamera?: (cameraId: string) => void;
}

const STATUS_STYLES: Record<Bolo["status"], { bg: string; text: string; dot: string; label: string }> = {
  candidate: { bg: "bg-amber-500/10", text: "text-amber-400", dot: "bg-amber-400", label: "CANDIDATE" },
  active: { bg: "bg-amber-500/10", text: "text-amber-400", dot: "bg-amber-400", label: "ACTIVE" },
  confirmed: { bg: "bg-red-500/10", text: "text-red-400", dot: "bg-red-400", label: "CONFIRMED" },
  sighted: { bg: "bg-red-500/10", text: "text-red-400", dot: "bg-red-400", label: "SIGHTED" },
  cleared: { bg: "bg-white/5", text: "text-white/30", dot: "bg-white/20", label: "CLEARED" },
  paused: { bg: "bg-blue-500/10", text: "text-blue-400", dot: "bg-blue-400", label: "PAUSED" },
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  return Math.floor(min / 60) + "h ago";
}

export default function BoloPanel({ bolos, onFlyTo, onClear, onOpenCamera }: BoloPanelProps) {
  const [proofImage, setProofImage] = useState<{ url: string; location: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const active = bolos.filter((b) => b.status !== "cleared");
  const cleared = bolos.filter((b) => b.status === "cleared");
  // Sort: paused BOLOs go to bottom
  active.sort((a, b) => (a.status === "paused" ? 1 : 0) - (b.status === "paused" ? 1 : 0));

  if (bolos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/20 px-6 py-12">
        <Crosshair size={28} className="mb-3 text-white/10" />
        <p className="text-[11px] font-mono text-center leading-relaxed">
          No active BOLOs are being tracked right now.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin">
      {/* Active BOLOs */}
      {active.map((bolo) => {
        const style = STATUS_STYLES[bolo.status];
        const expanded = expandedId === bolo.id;
        const vehicleLabel = [bolo.color, bolo.make, bolo.model].filter(Boolean).join(" ") || bolo.description;

        return (
          <div
            key={bolo.id}
            className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
          >
            {/* Header */}
            <button
              onClick={() => setExpandedId(expanded ? null : bolo.id)}
              className="w-full px-3 py-2.5 text-left"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={"w-1.5 h-1.5 rounded-full " + style.dot + ((bolo.status === "sighted" || bolo.status === "confirmed") ? " pulse-dot" : "")} />
                <span className={"text-[8px] font-mono tracking-[0.15em] uppercase " + style.text}>
                  {style.label}
                </span>
                <div className="flex-1" />
                <span className="text-[7px] font-mono text-white/15">{timeAgo(bolo.createdAt)}</span>
              </div>

              <div className="flex items-start gap-2">
                <Crosshair size={12} className={"shrink-0 mt-0.5 " + style.text} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-mono text-white/80 font-medium truncate capitalize">
                    {vehicleLabel}
                  </p>
                  {bolo.plate && (
                    <span className="text-[9px] font-mono text-amber-400/60 bg-amber-400/10 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                      {bolo.plate}
                    </span>
                  )}
                </div>
                <span className="text-[9px] font-mono text-white/25 shrink-0">
                  {bolo.sightings.length} sighting{bolo.sightings.length !== 1 ? "s" : ""}
                </span>
              </div>

              {bolo.direction && (
                <p className="text-[9px] font-mono text-white/30 mt-1 pl-5">
                  Heading: {bolo.direction}
                </p>
              )}
              {bolo.lastKnownLocation && (
                <p className="text-[9px] font-mono text-white/30 mt-0.5 pl-5">
                  Last seen: {bolo.lastKnownLocation}
                </p>
              )}
            </button>

            {/* Expanded sightings */}
            {expanded && (
              <div className="px-3 pb-3">
                {bolo.sightings.length > 0 ? (
                  <div className="space-y-1.5 mb-2">
                    {bolo.sightings.slice().reverse().map((s) => (
                      <div key={s.id} className="bg-white/[0.03] border border-white/[0.05] rounded overflow-hidden">
                        {/* Proof image thumbnail — shown inline when available */}
                        {s.proofImageUrl && (
                          <button
                            onClick={() => setProofImage({ url: s.proofImageUrl!, location: s.location })}
                            className="w-full relative group cursor-pointer"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={s.proofImageUrl}
                              alt={`Suspect vehicle at ${s.location}`}
                              className="w-full h-auto object-cover"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                              <span className="opacity-0 group-hover:opacity-100 text-[10px] font-mono text-white bg-black/60 px-2 py-1 rounded transition-opacity">
                                EXPAND PROOF
                              </span>
                            </div>
                          </button>
                        )}
                        <button
                          onClick={() => onFlyTo?.(s.lat, s.lng)}
                          className="w-full flex items-start gap-2 px-2 py-1.5 text-left hover:bg-white/[0.05] transition-colors"
                        >
                          {s.source === "camera" ? (
                            <Eye size={9} className="text-red-400/60 mt-0.5 shrink-0" />
                          ) : (
                            <Radio size={9} className="text-yellow-400/60 mt-0.5 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <MapPin size={8} className="text-yellow-400/50 shrink-0" />
                              <span className="text-[9px] font-mono text-white/60 truncate">{s.location}</span>
                            </div>
                            <p className="text-[8px] font-mono text-white/35 mt-0.5 line-clamp-2">{s.details}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[8px] font-mono text-white/20">{timeAgo(s.timestamp)}</div>
                            <div className="text-[7px] font-mono text-yellow-400/60 font-bold">{Math.round(s.confidence * 100)}%</div>
                          </div>
                        </button>
                        {/* Actions row */}
                        <div className="flex items-center gap-1 px-2 py-1 border-t border-white/[0.04]">
                          {s.proofImageUrl && (
                            <button
                              onClick={() => setProofImage({ url: s.proofImageUrl!, location: s.location })}
                              className="flex items-center gap-1 px-1.5 py-0.5 text-[7px] font-mono text-yellow-400/60 hover:text-yellow-400 bg-yellow-400/5 hover:bg-yellow-400/10 rounded transition-colors"
                            >
                              <Image size={8} />
                              VIEW PROOF
                            </button>
                          )}
                          {s.source === "camera" && (
                            <button
                              onClick={() => onOpenCamera?.(s.sourceId)}
                              className="flex items-center gap-1 px-1.5 py-0.5 text-[7px] font-mono text-cyan-400/60 hover:text-cyan-400 bg-cyan-400/5 hover:bg-cyan-400/10 rounded transition-colors"
                            >
                              <Camera size={8} />
                              OPEN CAMERA
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] font-mono text-white/20 px-2 py-2">
                    No sightings yet. Scanning all feeds...
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const newStatus = bolo.status === "paused" ? "active" : "paused";
                      fetch("/api/bolo", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: bolo.id, status: newStatus }) });
                    }}
                    className={`flex items-center gap-1.5 px-2 py-1 text-[8px] font-mono transition-colors ${bolo.status === "paused" ? "text-green-400/60 hover:text-green-400" : "text-blue-400/40 hover:text-blue-400/70"}`}
                  >
                    {bolo.status === "paused" ? <Play size={8} /> : <Pause size={8} />}
                    {bolo.status === "paused" ? "RESUME" : "PAUSE"}
                  </button>
                  <button
                    onClick={() => onClear?.(bolo.id)}
                    className="flex items-center gap-1.5 px-2 py-1 text-[8px] font-mono text-red-400/40 hover:text-red-400/70 transition-colors"
                  >
                    <Trash2 size={8} />
                    CANCEL
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Cleared BOLOs (collapsed) */}
      {cleared.length > 0 && (
        <div className="px-3 py-2 border-t border-white/[0.04]">
          <p className="text-[8px] font-mono text-white/15 tracking-wider">
            {cleared.length} CLEARED BOLO{cleared.length > 1 ? "S" : ""}
          </p>
        </div>
      )}

      {/* Proof image modal */}
      {proofImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setProofImage(null)}
        >
          <div
            className="relative max-w-[80vw] max-h-[80vh] bg-[#0a0a0f] border border-white/[0.1] rounded-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-yellow-400/20 bg-yellow-400/5">
              <div className="flex items-center gap-2">
                <Crosshair size={10} className="text-yellow-400" />
                <span className="text-[10px] font-mono text-yellow-400 font-bold tracking-wider">⚠ SUSPECT VEHICLE FOUND</span>
                <span className="text-[9px] font-mono text-white/40">{proofImage.location}</span>
              </div>
              <button
                onClick={() => setProofImage(null)}
                className="text-white/30 hover:text-white/70 text-[10px] font-mono"
              >
                ESC
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={proofImage.url}
              alt="BOLO proof"
              className="max-w-full max-h-[70vh] object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
