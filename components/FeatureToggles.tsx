"use client";

import { useState, useEffect, useCallback } from "react";
import { Camera, TrafficCone, Phone, Ship, Plane, ChevronDown, ChevronUp, Power, type LucideIcon } from "lucide-react";

interface FeatureFlags {
  cameras: boolean;
  boloV2: boolean;
  feed511: boolean;
  feedDataSF: boolean;
  ships: boolean;
  flights: boolean;
}

const FEATURES: {
  key: keyof FeatureFlags;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
}[] = [
  {
    key: "cameras",
    label: "CAMERAS",
    description: "Traffic camera analysis + BOLO matching",
    icon: Camera,
    color: "cyan",
  },
  {
    key: "boloV2",
    label: "BOLO V2",
    description: "Staged detect-match-verify BOLO pipeline",
    icon: Camera,
    color: "red",
  },
  {
    key: "feed511",
    label: "511 TRAFFIC",
    description: "Bay Area traffic event feed",
    icon: TrafficCone,
    color: "blue",
  },
  {
    key: "feedDataSF",
    label: "SF DISPATCH",
    description: "DataSF dispatch records",
    icon: Phone,
    color: "purple",
  },
  {
    key: "ships",
    label: "VESSELS",
    description: "Open vessel telemetry near viewport",
    icon: Ship,
    color: "teal",
  },
  {
    key: "flights",
    label: "FLIGHTS",
    description: "OpenSky aircraft state vectors",
    icon: Plane,
    color: "amber",
  },
];

const COLOR_MAP: Record<string, { dot: string; border: string; bg: string; text: string }> = {
  cyan: { dot: "bg-cyan-400", border: "border-cyan-400/30", bg: "bg-cyan-400/[0.06]", text: "text-cyan-400/80" },
  red: { dot: "bg-red-400", border: "border-red-400/30", bg: "bg-red-400/[0.06]", text: "text-red-400/80" },
  blue: { dot: "bg-blue-400", border: "border-blue-400/30", bg: "bg-blue-400/[0.06]", text: "text-blue-400/80" },
  purple: { dot: "bg-purple-400", border: "border-purple-400/30", bg: "bg-purple-400/[0.06]", text: "text-purple-400/80" },
  teal: { dot: "bg-teal-400", border: "border-teal-400/30", bg: "bg-teal-400/[0.06]", text: "text-teal-400/80" },
  amber: { dot: "bg-amber-400", border: "border-amber-400/30", bg: "bg-amber-400/[0.06]", text: "text-amber-400/80" },
};

export default function FeatureToggles() {
  const [features, setFeatures] = useState<FeatureFlags>({
    cameras: false,
    boloV2: true,
    feed511: false,
    feedDataSF: false,
    ships: false,
    flights: false,
  });
  const [expanded, setExpanded] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/features")
      .then((r) => r.json())
      .then((d) => setFeatures(d.features))
      .catch(() => {});
  }, []);

  const toggle = useCallback(async (key: keyof FeatureFlags) => {
    setToggling(key);
    try {
      const res = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: key, enabled: !features[key] }),
      });
      const data = await res.json();
      setFeatures(data.features);
    } catch {}
    setToggling(null);
  }, [features]);

  const activeCount = Object.values(features).filter(Boolean).length;

  return (
    <div className="relative">
      {/* Collapsed: show active count + toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 px-2 py-0.5 border rounded-sm text-[9px] font-mono tracking-wider transition-colors ${
          activeCount > 0
            ? "border-green-400/30 text-green-400/70 bg-green-400/[0.06]"
            : "border-white/[0.08] text-white/30 hover:text-white/60 hover:border-white/20"
        }`}
      >
        <Power size={9} />
        {activeCount > 0 ? `${activeCount}/${FEATURES.length}` : "FEEDS"}
        {expanded ? <ChevronUp size={8} /> : <ChevronDown size={8} />}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="absolute top-full right-0 mt-1 w-64 bg-[#0a0a0c]/95 backdrop-blur-xl border border-white/[0.08] rounded-md shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/[0.06]">
            <div className="text-[9px] font-mono tracking-[0.15em] text-white/40 uppercase">
              Data Sources
            </div>
          </div>

          <div className="py-1">
            {FEATURES.map((feat) => {
              const isOn = features[feat.key];
              const isLoading = toggling === feat.key;
              const colors = COLOR_MAP[feat.color];
              const Icon = feat.icon;

              return (
                <button
                  key={feat.key}
                  onClick={() => toggle(feat.key)}
                  disabled={isLoading}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all hover:bg-white/[0.03] ${
                    isLoading ? "opacity-50" : ""
                  }`}
                >
                  {/* Status indicator */}
                  <div
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
                      isOn ? colors.dot + " animate-pulse" : "bg-white/10"
                    }`}
                  />

                  {/* Icon */}
                  <Icon
                    size={12}
                    className={`flex-shrink-0 transition-colors ${
                      isOn ? colors.text : "text-white/20"
                    }`}
                  />

                  {/* Label + description */}
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-[10px] font-mono tracking-wider transition-colors ${
                        isOn ? "text-white/80" : "text-white/30"
                      }`}
                    >
                      {feat.label}
                    </div>
                    <div className="text-[8px] font-mono text-white/15 truncate">
                      {feat.description}
                    </div>
                  </div>

                  {/* Toggle switch */}
                  <div
                    className={`w-7 h-3.5 rounded-full flex-shrink-0 transition-colors relative ${
                      isOn ? colors.bg + " " + colors.border + " border" : "bg-white/[0.04] border border-white/[0.08]"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-2 h-2 rounded-full transition-all ${
                        isOn ? colors.dot + " right-0.5" : "bg-white/20 left-0.5"
                      }`}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* All on / all off */}
          <div className="px-3 py-2 border-t border-white/[0.06] flex gap-2">
            <button
              onClick={async () => {
                for (const feat of FEATURES) {
                  if (!features[feat.key]) {
                    await fetch("/api/features", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ feature: feat.key, enabled: true }),
                    });
                  }
                }
                const res = await fetch("/api/features");
                setFeatures((await res.json()).features);
              }}
              className="flex-1 py-1 text-[8px] font-mono tracking-wider text-green-400/50 hover:text-green-400/80 bg-green-400/[0.03] hover:bg-green-400/[0.06] border border-green-400/10 rounded-sm transition-colors"
            >
              ALL ON
            </button>
            <button
              onClick={async () => {
                for (const feat of FEATURES) {
                  if (features[feat.key]) {
                    await fetch("/api/features", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ feature: feat.key, enabled: false }),
                    });
                  }
                }
                const res = await fetch("/api/features");
                setFeatures((await res.json()).features);
              }}
              className="flex-1 py-1 text-[8px] font-mono tracking-wider text-red-400/50 hover:text-red-400/80 bg-red-400/[0.03] hover:bg-red-400/[0.06] border border-red-400/10 rounded-sm transition-colors"
            >
              ALL OFF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
