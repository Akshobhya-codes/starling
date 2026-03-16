"use client";

import { Target, X } from "lucide-react";

interface FocusModeProps {
  center: { lat: number; lng: number } | null;
  radius: number;
  onRadiusChange: (r: number) => void;
  onClear: () => void;
}

export default function FocusMode({ center, radius, onRadiusChange, onClear }: FocusModeProps) {
  if (!center) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-mono text-green-500/30 tracking-wider">
        <Target size={10} />
        <span>CLICK MAP TO FOCUS</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1 border border-green-500/20 rounded-sm text-[9px] font-mono">
      <Target size={10} className="text-green-500/60" />
      <span className="text-green-500/50 tabular-nums">
        {center.lat.toFixed(4)} {center.lng.toFixed(4)}
      </span>
      <input
        type="range"
        min="0.25"
        max="5"
        step="0.25"
        value={radius}
        onChange={(e) => onRadiusChange(parseFloat(e.target.value))}
        className="w-16 accent-green-500 h-1"
      />
      <span className="text-green-500/70 tabular-nums">{radius}MI</span>
      <button onClick={onClear} className="text-green-500/30 hover:text-green-500/70">
        <X size={10} />
      </button>
    </div>
  );
}
