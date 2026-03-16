"use client";

import { TrafficFlow } from "./CesiumMap";
import { Car, Gauge, TrendingUp } from "lucide-react";

interface TrafficFlowOverlayProps {
  flow: TrafficFlow;
}

export default function TrafficFlowOverlay({ flow }: TrafficFlowOverlayProps) {
  // Estimate flow rate as vehicles * density factor based on speed
  // Higher speed = vehicles clear faster = higher throughput
  const flowRate = Math.round(flow.vehicleCount * Math.max(1, flow.avgSpeed / 5));
  const congestionLevel =
    flow.avgSpeed > 35 ? "FREE FLOW" :
    flow.avgSpeed > 20 ? "MODERATE" :
    flow.avgSpeed > 10 ? "HEAVY" : "GRIDLOCK";
  const congestionColor =
    flow.avgSpeed > 35 ? "text-green-400" :
    flow.avgSpeed > 20 ? "text-yellow-400" :
    flow.avgSpeed > 10 ? "text-orange-400" : "text-red-400";

  return (
    <div className="absolute top-4 left-4 z-30 pointer-events-none">
      <div className="bg-black/70 backdrop-blur-md border border-yellow-400/20 rounded-sm px-4 py-3 font-mono min-w-[200px]">
        <div className="flex items-center gap-2 mb-3 border-b border-yellow-400/10 pb-2">
          <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          <span className="text-[10px] tracking-[0.2em] text-yellow-400/80 uppercase">
            Bbox Traffic Flow
          </span>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-white/40">
              <Car size={10} />
              <span className="text-[9px] tracking-wider">VEHICLES</span>
            </div>
            <span className="text-[13px] text-yellow-400 tabular-nums font-semibold">
              {flow.vehicleCount}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-white/40">
              <Gauge size={10} />
              <span className="text-[9px] tracking-wider">AVG SPEED</span>
            </div>
            <span className="text-[13px] text-white/80 tabular-nums">
              {Math.round(flow.avgSpeed)} <span className="text-[9px] text-white/30">MPH</span>
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-white/40">
              <TrendingUp size={10} />
              <span className="text-[9px] tracking-wider">FLOW RATE</span>
            </div>
            <span className="text-[13px] text-white/80 tabular-nums">
              {flowRate} <span className="text-[9px] text-white/30">VPH</span>
            </span>
          </div>

          <div className="pt-1 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-white/30 tracking-wider">STATUS</span>
              <span className={`text-[10px] tracking-wider font-semibold ${congestionColor}`}>
                {congestionLevel}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
