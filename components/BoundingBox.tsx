"use client";

import { useState } from "react";
import { Square, X, Scan, Crosshair } from "lucide-react";

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface BoundingBoxProps {
  bbox: BBox | null;
  drawing: boolean;
  onStartDraw: () => void;
  onClear: () => void;
  onSetRadius: (bbox: BBox) => void;
  centerLat: number;
  centerLng: number;
}

const RADIUS_OPTIONS = [
  { label: "0.5 MI", miles: 0.5 },
  { label: "1 MI", miles: 1 },
  { label: "2 MI", miles: 2 },
  { label: "5 MI", miles: 5 },
];

function bboxFromRadius(lat: number, lng: number, miles: number): BBox {
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.cos((lat * Math.PI) / 180));
  return {
    south: lat - dLat,
    north: lat + dLat,
    west: lng - dLng,
    east: lng + dLng,
  };
}

export default function BoundingBoxControl({
  bbox, drawing, onStartDraw, onClear, onSetRadius, centerLat, centerLng,
}: BoundingBoxProps) {
  const [showRadiusMenu, setShowRadiusMenu] = useState(false);

  if (drawing) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 border border-amber-400/30 rounded-sm text-[9px] font-mono text-amber-400/70 tracking-wider animate-pulse">
        <Scan size={10} />
        <span>CLICK 2 CORNERS ON MAP</span>
        <button onClick={onClear} className="text-amber-400/30 hover:text-amber-400/70 ml-1">
          <X size={10} />
        </button>
      </div>
    );
  }

  if (bbox) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 border border-white/[0.1] rounded-sm text-[9px] font-mono">
        <Square size={9} className="text-white/30" />
        <span className="text-white/40 tabular-nums">
          {bbox.south.toFixed(3)},{bbox.west.toFixed(3)} &rarr; {bbox.north.toFixed(3)},{bbox.east.toFixed(3)}
        </span>
        <button onClick={onClear} className="text-white/20 hover:text-white/50">
          <X size={10} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 relative">
      <button
        onClick={onStartDraw}
        className="flex items-center gap-1.5 px-2 py-0.5 border border-white/[0.08] rounded-sm text-[9px] font-mono text-white/30 hover:text-white/50 hover:border-white/15 transition-colors tracking-wider"
      >
        <Square size={9} />
        <span>BBOX</span>
      </button>
      <button
        onClick={() => setShowRadiusMenu((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-0.5 border border-white/[0.08] rounded-sm text-[9px] font-mono text-white/30 hover:text-white/50 hover:border-white/15 transition-colors tracking-wider"
      >
        <Crosshair size={9} />
        <span>RADIUS</span>
      </button>
      {showRadiusMenu && (
        <div className="absolute top-full right-0 mt-1 bg-[#0a0a0f] border border-white/[0.1] rounded-sm shadow-xl z-50 overflow-hidden">
          {RADIUS_OPTIONS.map((opt) => (
            <button
              key={opt.miles}
              onClick={() => {
                onSetRadius(bboxFromRadius(centerLat, centerLng, opt.miles));
                setShowRadiusMenu(false);
              }}
              className="block w-full px-4 py-1.5 text-[9px] font-mono tracking-wider text-white/40 hover:text-white/80 hover:bg-white/[0.05] transition-colors text-left whitespace-nowrap"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
