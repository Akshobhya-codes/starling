"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, ChevronRight, Loader2, Send, Shield, Terminal, Zap } from "lucide-react";

interface QueryResponse {
  answer: string;
  flyTo: { lat: number; lng: number } | null;
  highlightIds: string[];
  filterType: string | null;
  threatLevel: "low" | "moderate" | "elevated" | "high" | "critical";
  recommendations: string[];
  bolo?: unknown;
}

interface ChatMessage {
  id: string;
  role: "user" | "nemo";
  content: string;
  threatLevel?: QueryResponse["threatLevel"];
  recommendations?: string[];
  timestamp: Date;
}

interface NemoChatProps {
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

export default function NemoChat({ onFlyTo, onHighlight, onFilterType, onBoloCreated }: NemoChatProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "nemo",
      content: "Nemo online. Starling Operations Center active.\n\nI'm your AI operations analyst powered by OpenAI. I can track vehicles, analyze incidents, scan camera feeds, and provide tactical intelligence.\n\nType a command or ask me anything. Use /help for available commands.",
      threatLevel: "low",
      recommendations: [],
      timestamp: new Date(),
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = useCallback((role: "user" | "nemo", content: string, extra?: Partial<ChatMessage>) => {
    const msg: ChatMessage = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role,
      content,
      timestamp: new Date(),
      ...extra,
    };
    setMessages((prev) => [...prev, msg]);
    return msg;
  }, []);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    addMessage("user", text);

    // Local fly-to shortcuts
    const localFlyTo = tryLocalFlyTo(text);
    if (localFlyTo) {
      onFlyTo(localFlyTo.lat, localFlyTo.lng);
      addMessage("nemo", "Navigating to location.", { threatLevel: "low" });
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const data: QueryResponse = await res.json();

      addMessage("nemo", data.answer, {
        threatLevel: data.threatLevel,
        recommendations: data.recommendations,
      });

      if (data.flyTo) onFlyTo(data.flyTo.lat, data.flyTo.lng);
      if (data.highlightIds?.length > 0) onHighlight(data.highlightIds);
      if (data.filterType) onFilterType(data.filterType);
      if (data.bolo && onBoloCreated) onBoloCreated(data.bolo);
    } catch {
      addMessage("nemo", "Connection error. Check system status.", { threatLevel: "high" });
    } finally {
      setLoading(false);
    }
  }, [input, loading, addMessage, onFlyTo, onHighlight, onFilterType, onBoloCreated]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06] bg-black/20">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <Terminal size={12} className="text-cyan-400/70" />
          <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-cyan-400/70">
            Nemo Terminal
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Zap size={9} className="text-amber-400/50" />
          <span className="text-[8px] font-mono tracking-wider text-white/20">GPT-4o</span>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
            {/* Role label */}
            <div className={`flex items-center gap-1.5 mb-1 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              {msg.role === "nemo" ? (
                <Brain size={10} className="text-cyan-400/60" />
              ) : (
                <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
              )}
              <span className="text-[8px] font-mono tracking-[0.15em] uppercase text-white/25">
                {msg.role === "nemo" ? "NEMO" : "OPERATOR"}
              </span>
              <span className="text-[7px] font-mono text-white/10">
                {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>

            {/* Message bubble */}
            <div
              className={`max-w-[95%] rounded-xl px-3.5 py-2.5 text-[12px] font-mono leading-relaxed ${
                msg.role === "user"
                  ? "bg-white/[0.08] text-white/80 rounded-tr-sm"
                  : "bg-[#0c1020]/80 border border-white/[0.06] text-white/85 rounded-tl-sm"
              }`}
            >
              {msg.role === "nemo" && msg.threatLevel && msg.threatLevel !== "low" && (
                <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-white/[0.06]">
                  <Shield size={10} style={{ color: THREAT_COLORS[msg.threatLevel] }} />
                  <span
                    className="text-[8px] font-mono uppercase tracking-[0.2em]"
                    style={{ color: THREAT_COLORS[msg.threatLevel] }}
                  >
                    {msg.threatLevel} threat
                  </span>
                </div>
              )}
              <p className="whitespace-pre-wrap">{msg.content}</p>

              {msg.recommendations && msg.recommendations.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-white/[0.06] space-y-1">
                  <div className="text-[7px] font-mono uppercase tracking-[0.2em] text-white/20 mb-1">
                    Recommendations
                  </div>
                  {msg.recommendations.map((rec, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-1.5 text-[10px] font-mono text-white/50"
                    >
                      <ChevronRight size={8} className="mt-0.5 shrink-0 text-cyan-400/30" />
                      {rec}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-start gap-2">
            <Brain size={10} className="text-cyan-400/60 mt-1" />
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#0c1020]/80 border border-white/[0.06]">
              <Loader2 size={12} className="animate-spin text-cyan-400/50" />
              <span className="text-[11px] font-mono text-white/30">Nemo is analyzing...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="px-3 py-2.5 border-t border-white/[0.06] bg-black/20">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#080810]/80 px-3 py-2">
          <span className="text-cyan-400/40 text-[11px] font-mono">{">"}</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Talk to Nemo... (e.g. track a red sedan near downtown)"
            className="flex-1 bg-transparent text-[12px] font-mono tracking-wide text-white/90 outline-none placeholder:text-white/15"
            disabled={loading}
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
            className="shrink-0 p-1 rounded text-white/20 hover:text-cyan-400/70 disabled:opacity-30 transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="text-[7px] font-mono text-white/10">
            /help for commands · /bolo to track vehicles · /status for overview
          </span>
          <span className="text-[7px] font-mono text-white/10">
            Powered by OpenAI
          </span>
        </div>
      </div>
    </div>
  );
}
