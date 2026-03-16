"use client";

import { FeedStatus } from "@/lib/types";

interface StatusBarProps {
  status: FeedStatus;
  lastServerLog?: { ts: string; level: "info" | "warn" | "error"; message: string } | null;
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${
        active ? "bg-emerald-400/70" : "bg-white/15"
      }`}
    />
  );
}

export default function StatusBar({ status, lastServerLog }: StatusBarProps) {
  const levelClass =
    lastServerLog?.level === "error"
      ? "text-red-300/80"
      : lastServerLog?.level === "warn"
      ? "text-amber-300/80"
      : "text-cyan-300/75";

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-black/50 border-t border-white/[0.06] text-[9px] font-mono tracking-wider">
      <div className="flex items-center gap-5 text-white/30">
        <span className="flex items-center gap-1.5">
          <StatusDot active={status.cameras.active > 0} />
          CAM {status.cameras.active}/{status.cameras.total}
        </span>
        <span className="flex items-center gap-1.5">
          <StatusDot active={status.fiveEleven === "ok"} />
          511 {status.fiveEleven === "ok" ? "OK" : status.fiveEleven === "throttled" ? "THROTTLED" : "ERR"}
        </span>
      </div>
      <div className="flex items-center gap-4 min-w-0">
        {lastServerLog && (
          <div className={"max-w-[40vw] truncate " + levelClass}>
            {lastServerLog.message}
          </div>
        )}
        <div className="text-white/25 tabular-nums shrink-0">
          {status.activeHypotheses} active
        </div>
      </div>
    </div>
  );
}
