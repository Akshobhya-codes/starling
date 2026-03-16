"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, ChevronRight, Loader2, Search, Shield, X } from "lucide-react";

interface QueryResponse {
  answer: string;
  flyTo: { lat: number; lng: number } | null;
  highlightIds: string[];
  filterType: string | null;
  threatLevel: "low" | "moderate" | "elevated" | "high" | "critical";
  recommendations: string[];
  bolo?: unknown;
}

interface CommandBarProps {
  onFlyTo: (lat: number, lng: number) => void;
  onHighlight: (ids: string[]) => void;
  onFilterType: (type: string | null) => void;
  onBoloCreated?: (bolo: unknown) => void;
}

const THREAT_COLORS: Record<QueryResponse["threatLevel"], string> = {
  low: "#22c55e",
  moderate: "#eab308",
  elevated: "#f97316",
  high: "#ef4444",
  critical: "#dc2626",
};

const QUICK_QUERIES = [
  "What's happening near YC right now?",
  "Show me all critical incidents",
  "Any police or fire activity nearby?",
  "/status",
];

const LOCATION_SHORTCUTS: Record<string, { lat: number; lng: number }> = {
  "yc": { lat: 37.7604, lng: -122.3886 },
  "yc office": { lat: 37.7604, lng: -122.3886 },
  "y combinator": { lat: 37.7604, lng: -122.3886 },
  "home": { lat: 37.7604, lng: -122.3886 },
  "bay bridge": { lat: 37.7983, lng: -122.3778 },
  "golden gate": { lat: 37.8199, lng: -122.4783 },
  "golden gate bridge": { lat: 37.8199, lng: -122.4783 },
  "civic center": { lat: 37.7793, lng: -122.4193 },
  "union square": { lat: 37.7879, lng: -122.4074 },
  "embarcadero": { lat: 37.7936, lng: -122.393 },
  "fishermans wharf": { lat: 37.808, lng: -122.4177 },
  "chinatown": { lat: 37.7941, lng: -122.4078 },
  "mission": { lat: 37.7599, lng: -122.4148 },
  "castro": { lat: 37.7609, lng: -122.435 },
  "haight": { lat: 37.7692, lng: -122.4481 },
  "tenderloin": { lat: 37.7847, lng: -122.4141 },
  "soma": { lat: 37.7785, lng: -122.395 },
  "downtown": { lat: 37.7879, lng: -122.4074 },
  "sfo": { lat: 37.6213, lng: -122.379 },
  "airport": { lat: 37.6213, lng: -122.379 },
};

function tryLocalFlyTo(text: string): { lat: number; lng: number } | null {
  const lower = text.toLowerCase().replace(/[^a-z0-9/ ]/g, "").trim();
  const moveMatch = lower.match(/^\/move(?:to)?\s+(.+)$/);
  if (moveMatch) {
    return LOCATION_SHORTCUTS[moveMatch[1].trim()] || null;
  }

  const navMatch = lower.match(/^(take me|bring me|go|fly|move|navigate|show me|zoom|head)\s*(to|at|near|over to)?\s+(.+)$/);
  if (!navMatch) return null;

  const destination = navMatch[3].trim();
  if (!destination) return null;
  if (LOCATION_SHORTCUTS[destination]) return LOCATION_SHORTCUTS[destination];

  for (const [key, coords] of Object.entries(LOCATION_SHORTCUTS)) {
    if (destination.includes(key) || key.includes(destination)) return coords;
  }

  return null;
}

export default function CommandBar({ onFlyTo, onHighlight, onFilterType, onBoloCreated }: CommandBarProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.metaKey && event.key === "k") {
        event.preventDefault();
        setOpen(true);
        setResponse(null);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
        setResponse(null);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const handleQuery = useCallback(async (nextQuery?: string) => {
    const queryText = (nextQuery ?? query).trim();
    if (!queryText) return;

    const localFlyTo = tryLocalFlyTo(queryText);
    if (localFlyTo) {
      onFlyTo(localFlyTo.lat, localFlyTo.lng);
      setResponse({
        answer: "Flying to location.",
        flyTo: localFlyTo,
        highlightIds: [],
        filterType: null,
        threatLevel: "low",
        recommendations: [],
      });
      return;
    }

    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryText }),
      });
      const data: QueryResponse = await res.json();
      setResponse(data);

      if (data.flyTo) onFlyTo(data.flyTo.lat, data.flyTo.lng);
      if (data.highlightIds?.length > 0) onHighlight(data.highlightIds);
      if (data.filterType) onFilterType(data.filterType);
      if (data.bolo && onBoloCreated) onBoloCreated(data.bolo);
    } catch {
      setResponse({
        answer: "Network error. Check connection.",
        flyTo: null,
        highlightIds: [],
        filterType: null,
        threatLevel: "low",
        recommendations: [],
      });
    } finally {
      setLoading(false);
    }
  }, [onBoloCreated, onFilterType, onFlyTo, onHighlight, query]);

  const threatColor = response ? THREAT_COLORS[response.threatLevel] : THREAT_COLORS.low;

  return (
    <div className="relative w-[520px]">
      {open && response && (
        <div className="absolute bottom-full mb-3 w-full overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0a0a14]/95 shadow-2xl shadow-black/70 backdrop-blur-xl">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-2.5">
            <Shield size={11} style={{ color: threatColor }} />
            <span className="text-[9px] font-mono uppercase tracking-[0.2em]" style={{ color: threatColor }}>
              {response.threatLevel} threat
            </span>
          </div>

          <div className="px-5 py-4">
            <p className="whitespace-pre-wrap text-[13px] font-mono leading-relaxed text-white/85">
              {response.answer}
            </p>
          </div>

          {response.recommendations.length > 0 && (
            <div className="space-y-1.5 px-5 pb-4">
              <div className="mb-1 text-[8px] font-mono uppercase tracking-[0.2em] text-white/25">
                Recommendations
              </div>
              {response.recommendations.map((recommendation, index) => (
                <div key={index} className="flex items-start gap-2 rounded-lg border border-white/[0.05] bg-white/[0.03] px-3 py-2 text-[11px] font-mono text-white/60">
                  <ChevronRight size={10} className="mt-0.5 shrink-0 text-white/20" />
                  {recommendation}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {open && !response && !loading && !query && (
        <div className="absolute bottom-full mb-3 w-full overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0a0a14]/95 shadow-2xl shadow-black/70 backdrop-blur-xl">
          <div className="border-b border-white/[0.06] px-5 py-2.5">
            <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-white/25">
              Ask The City
            </span>
          </div>
          {QUICK_QUERIES.map((quickQuery) => (
            <button
              key={quickQuery}
              onClick={() => {
                setQuery(quickQuery);
                handleQuery(quickQuery);
              }}
              className="group flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
            >
              <Brain size={12} className="shrink-0 text-white/15 group-hover:text-white/40" />
              <span className="text-[12px] font-mono tracking-wide text-white/40 group-hover:text-white/70">
                {quickQuery}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && loading && (
        <div className="absolute bottom-full mb-3 w-full overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0a0a14]/95 shadow-2xl shadow-black/70 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-5 py-6">
            <Loader2 size={16} className="animate-spin text-cyan-400/60" />
            <span className="text-[11px] font-mono tracking-wider text-white/40">
              Searching city data...
            </span>
          </div>
        </div>
      )}

      <div
        className="flex cursor-text items-center rounded-full border border-white/[0.1] bg-[#0a0a14]/90 px-5 py-3 shadow-2xl shadow-black/50 backdrop-blur-xl"
        onClick={() => {
          if (!open) {
            setOpen(true);
            setResponse(null);
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }}
      >
        {loading ? (
          <Loader2 size={18} className="shrink-0 animate-spin text-cyan-400/50" />
        ) : (
          <Search size={18} className="shrink-0 text-white/30" />
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => {
              if (!response && !query && !loading) setOpen(false);
            }, 300);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleQuery();
            if (event.key === "Escape") {
              setOpen(false);
              setQuery("");
              setResponse(null);
              (event.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Search incidents, places, or BOLOs..."
          className="w-full bg-transparent px-3 py-0 text-sm font-mono tracking-wider text-white/90 outline-none placeholder:text-white/20"
        />
        {(query || response) && (
          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery("");
              setResponse(null);
            }}
            className="shrink-0 text-white/20 hover:text-white/50"
          >
            <X size={16} />
          </button>
        )}
        {!open && !query && (
          <kbd className="flex shrink-0 items-center gap-1 text-[10px] font-mono text-white/15">
            <span>&#8984;K</span>
          </kbd>
        )}
      </div>
    </div>
  );
}
