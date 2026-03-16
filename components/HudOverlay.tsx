"use client";

import { useEffect, useState } from "react";
import { FeedStatus } from "@/lib/types";

interface HudOverlayProps {
  cameraLat: number;
  cameraLng: number;
  cameraAlt: number;
  feedStatus: FeedStatus;
  activeCount: number;
}

function formatCoord(deg: number, isLat: boolean): string {
  const dir = isLat ? (deg >= 0 ? "N" : "S") : (deg >= 0 ? "E" : "W");
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d - m / 60) * 3600).toFixed(1);
  return `${d}${String.fromCharCode(176)}${m.toString().padStart(2, "0")}'${s}"${dir}`;
}

function formatAlt(alt: number): string {
  if (alt >= 1000) return `${(alt / 1000).toFixed(1)} km`;
  return `${Math.round(alt)} m`;
}

function getTiltLabel(alt: number): string {
  if (alt > 20000) return "Regional";
  if (alt > 5000) return "City";
  if (alt > 1500) return "District";
  if (alt > 500) return "Street";
  return "Detail";
}

export default function HudOverlay({ cameraLat, cameraLng, cameraAlt, feedStatus, activeCount }: HudOverlayProps) {
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toISOString().replace("T", " ").replace(/\.\d+Z/, "Z"));
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
      {/* Soft vignette */}
      <div className="absolute inset-0 hud-vignette" />

      {/* Top-left: System + altitude context */}
      <div className="absolute top-5 left-5">
        <div className="text-white/20 text-[9px] font-mono tracking-wider mb-0.5">
          SF-OSINT-FC
        </div>
        <div className="text-white/35 text-[10px] font-mono tabular-nums">
          {time}
        </div>
      </div>

      {/* Top-right: Camera info */}
      <div className="absolute top-5 right-5 text-right">
        <div className="text-white/30 text-[9px] font-mono tabular-nums">
          ALT {formatAlt(cameraAlt)}
        </div>
        <div className="text-white/15 text-[8px] font-mono mt-0.5">
          {getTiltLabel(cameraAlt)}
        </div>
      </div>

      {/* Bottom-left: Coordinates */}
      <div className="absolute bottom-5 left-5">
        <div className="text-white/35 text-[10px] font-mono tracking-wider tabular-nums">
          {formatCoord(cameraLat, true)}  {formatCoord(cameraLng, false)}
        </div>
      </div>

      {/* Bottom-right: Active count */}
      <div className="absolute bottom-5 right-5 text-right">
        <div className="text-white/20 text-[9px] font-mono tabular-nums">
          {activeCount} active
        </div>
      </div>

      {/* Center crosshair (very subtle) */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="w-5 h-[1px] bg-white/[0.08]" />
        <div className="w-[1px] h-5 bg-white/[0.08] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>
    </div>
  );
}
