"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import HypothesisPanel from "@/components/HypothesisPanel";
import SitrepPanel from "@/components/SitrepPanel";
import StatusBar from "@/components/StatusBar";
import HudOverlay from "@/components/HudOverlay";
import NemoChat from "@/components/NemoChat";
import IncidentDetail from "@/components/IncidentDetail";
import BoundingBoxControl from "@/components/BoundingBox";
import type { BBox, TrafficFlow } from "@/components/CesiumMap";
import TrafficFlowOverlay from "@/components/TrafficFlowOverlay";
import { Hypothesis, FeedStatus, CameraInfo, RoadSegment, IncidentType, Bolo, VesselTrack, FlightTrack } from "@/lib/types";
import CameraViewer from "@/components/CameraViewer";
import BoloPanel from "@/components/BoloPanel";
import FeatureToggles from "@/components/FeatureToggles";
import { Camera } from "lucide-react";

const CesiumMap = dynamic(() => import("@/components/CesiumMap"), { ssr: false });

type RightTab = "sitrep" | "hypotheses" | "bolos";
type ServerLogEntry = { ts: string; level: "info" | "warn" | "error"; message: string };
type FeatureFlags = {
  cameras: boolean;
  boloV2: boolean;
  feed511: boolean;
  feedDataSF: boolean;
  ships: boolean;
  flights: boolean;
};

const FEATURES_POLL_MS = 15000;
const CAMERAS_POLL_MS = 30000;
const BOLOS_BACKUP_POLL_MS = 30000;
const INCIDENTS_POLL_MS = 30000;

const FILTER_TYPES: { label: string; value: IncidentType | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Accident", value: "accident" },
  { label: "Congestion", value: "congestion" },
  { label: "Closure", value: "road_closure" },
  { label: "Medical", value: "medical" },
  { label: "Fire", value: "fire" },
  { label: "Hazard", value: "hazard" },
  { label: "Police", value: "police" },
  { label: "Construction", value: "construction" },
];

export default function Home() {
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [roads, setRoads] = useState<RoadSegment[]>([]);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>({
    cameras: { active: 0, total: 0 },
    fiveEleven: "ok",
    activeHypotheses: 0,
  });
  const [selectedHypothesis, setSelectedHypothesis] = useState<string | null>(null);
  const [cameraPos, setCameraPos] = useState({ lat: 37.7604, lng: -122.3886, alt: 250 });
  const [flyToTarget, setFlyToTarget] = useState<{ lat: number; lng: number } | null>(null);
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [bboxDrawing, setBboxDrawing] = useState(false);
  const [activeTab, setActiveTab] = useState<RightTab>("hypotheses");
  const [typeFilter, setTypeFilter] = useState<IncidentType | "all">("all");
  const [trafficFlow, setTrafficFlow] = useState<TrafficFlow | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [detailHypothesis, setDetailHypothesis] = useState<Hypothesis | null>(null);
  const [bolos, setBolos] = useState<Bolo[]>([]);
  const [features, setFeatures] = useState<FeatureFlags>({
    cameras: false,
    boloV2: true,
    feed511: false,
    feedDataSF: false,
    ships: false,
    flights: false,
  });
  const [vessels, setVessels] = useState<VesselTrack[]>([]);
  const [flights, setFlights] = useState<FlightTrack[]>([]);
  const [serverLogs, setServerLogs] = useState<ServerLogEntry[]>([]);

  // SSE connection
  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("init", (e) => {
      const data = JSON.parse(e.data);
      setHypotheses(data.hypotheses || []);
      setFeedStatus(data.feedStatus);
      if (data.bolos) setBolos(data.bolos);
      if (data.serverLogs) setServerLogs(data.serverLogs);
    });
    es.addEventListener("server:log", (e) => {
      const log = JSON.parse(e.data) as ServerLogEntry;
      setServerLogs((prev) => [...prev.slice(-79), log]);
    });
    es.addEventListener("hypothesis:new", (e) => {
      const hyp = JSON.parse(e.data);
      setHypotheses((prev) => [hyp, ...prev.filter((h) => h.id !== hyp.id)]);
    });
    es.addEventListener("hypothesis:update", (e) => {
      const hyp = JSON.parse(e.data);
      setHypotheses((prev) => prev.map((h) => (h.id === hyp.id ? hyp : h)));
    });
    es.addEventListener("hypothesis:cleared", (e) => {
      const hyp = JSON.parse(e.data);
      setHypotheses((prev) => prev.filter((h) => h.id !== hyp.id));
    });
    es.addEventListener("bolo:new", (e) => {
      const bolo = JSON.parse(e.data);
      setBolos((prev) => [bolo, ...prev.filter((b) => b.id !== bolo.id)]);
    });
    es.addEventListener("bolo:sighting", (e) => {
      const { bolo } = JSON.parse(e.data);
      setBolos((prev) => prev.map((b) => (b.id === bolo.id ? bolo : b)));
    });
    es.addEventListener("bolo:cleared", (e) => {
      const bolo = JSON.parse(e.data);
      setBolos((prev) => prev.map((b) => (b.id === bolo.id ? bolo : b)));
    });
    es.addEventListener("bolo:update", (e) => {
      const bolo = JSON.parse(e.data);
      setBolos((prev) => prev.map((b) => (b.id === bolo.id ? bolo : b)));
    });
    es.addEventListener("features", (e) => {
      const f = JSON.parse(e.data);
      setFeatures(f);
    });
    return () => es.close();
  }, []);

  // Sync feature flags from backend
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/features");
        const data = await res.json();
        if (!cancelled && data?.features) setFeatures(data.features);
      } catch {}
    };
    pull();
    const iv = setInterval(pull, FEATURES_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    const fetchCameras = async () => {
      try {
        const res = await fetch("/api/cameras");
        setCameras((await res.json()).cameras || []);
      } catch {}
    };
    fetchCameras();
    const iv = setInterval(fetchCameras, CAMERAS_POLL_MS);
    return () => clearInterval(iv);
  }, []);

  // Poll BOLOs to catch sightings (SSE backup)
  useEffect(() => {
    const fetchBolos = async () => {
      try {
        const res = await fetch("/api/bolo");
        const data = await res.json();
        if (data.bolos) setBolos(data.bolos);
      } catch {}
    };
    const iv = setInterval(fetchBolos, BOLOS_BACKUP_POLL_MS);
    return () => clearInterval(iv);
  }, []);

  // Compute a viewport bbox from camera position + altitude for road fetching
  const viewportBbox = useMemo(() => {
    if (bbox) return bbox;
    const degPerMeter = 1 / 111320;
    const spread = cameraPos.alt * degPerMeter * 1.2;
    const clampedSpread = Math.min(spread, 0.05);
    return {
      south: cameraPos.lat - clampedSpread,
      north: cameraPos.lat + clampedSpread,
      west: cameraPos.lng - clampedSpread,
      east: cameraPos.lng + clampedSpread,
    };
  }, [bbox, cameraPos.lat, cameraPos.lng, cameraPos.alt]);

  const [debouncedViewport, setDebouncedViewport] = useState(viewportBbox);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedViewport(viewportBbox), 800);
    return () => clearTimeout(timer);
  }, [viewportBbox]);

  useEffect(() => {
    let cancelled = false;
    const vp = debouncedViewport;
    const param = `${vp.south.toFixed(4)},${vp.west.toFixed(4)},${vp.north.toFixed(4)},${vp.east.toFixed(4)}`;
    const fetchRoads = async () => {
      try {
        const res = await fetch(`/api/traffic?bbox=${encodeURIComponent(param)}`);
        const data = await res.json();
        if (!cancelled && data.roads?.length > 0) {
          setRoads(data.roads);
        }
      } catch {}
    };
    fetchRoads();
    return () => { cancelled = true; };
  }, [debouncedViewport]);

  useEffect(() => {
    if (!features.ships) return;
    let cancelled = false;
    const vp = debouncedViewport;
    const bboxParam = `${vp.south.toFixed(4)},${vp.west.toFixed(4)},${vp.north.toFixed(4)},${vp.east.toFixed(4)}`;
    const poll = async () => {
      try {
        const res = await fetch(`/api/ships?bbox=${encodeURIComponent(bboxParam)}&simulate=1`);
        const data = await res.json();
        if (!cancelled) setVessels(data?.vessels || []);
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 12000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [features.ships, debouncedViewport]);

  useEffect(() => {
    if (!features.flights) return;
    let cancelled = false;
    const vp = debouncedViewport;
    const bboxParam = `${vp.south.toFixed(4)},${vp.west.toFixed(4)},${vp.north.toFixed(4)},${vp.east.toFixed(4)}`;
    const poll = async () => {
      try {
        const res = await fetch(`/api/flights?bbox=${encodeURIComponent(bboxParam)}&simulate=1`);
        const data = await res.json();
        if (!cancelled) setFlights(data?.flights || []);
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 12000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [features.flights, debouncedViewport]);

  useEffect(() => {
    const poll = async () => {
      try {
        const data = await (await fetch("/api/incidents")).json();
        setFeedStatus(data.feedStatus);
        if (data.hypotheses?.length > 0) {
          const serverHyps: Hypothesis[] = data.hypotheses;
          setHypotheses((prev) => {
            const existingIds = new Set(prev.map((h) => h.id));
            const serverIds = new Set(serverHyps.map((h) => h.id));
            const newOnes = serverHyps.filter((h) => !existingIds.has(h.id));
            const updated = prev
              .filter((h) => serverIds.has(h.id))
              .map((h) => serverHyps.find((s) => s.id === h.id) || h);
            return [...newOnes, ...updated];
          });
        }
      } catch {}
    };
    const iv = setInterval(poll, INCIDENTS_POLL_MS);
    return () => clearInterval(iv);
  }, []);

  const filteredHypotheses = useMemo(() => {
    let filtered = hypotheses;
    if (bbox) {
      filtered = filtered.filter(
        (h) => h.lat >= bbox.south && h.lat <= bbox.north && h.lng >= bbox.west && h.lng <= bbox.east
      );
    }
    if (typeFilter !== "all") {
      filtered = filtered.filter((h) => h.type === typeFilter);
    }
    return filtered;
  }, [hypotheses, bbox, typeFilter]);

  const handleCameraMove = useCallback((lat: number, lng: number, alt: number) => {
    setCameraPos({ lat, lng, alt });
  }, []);

  const handleBBoxDrawn = useCallback((b: BBox) => {
    setBbox(b);
    setBboxDrawing(false);
  }, []);

  const handleTrafficFlow = useCallback((flow: TrafficFlow | null) => {
    setTrafficFlow(flow);
  }, []);

  const activeBoloCount = bolos.filter((b) => b.status !== "cleared").length;
  const TABS: { key: RightTab; label: string }[] = [
    { key: "sitrep", label: "SITREP" },
    { key: "hypotheses", label: "QUEUE" },
    { key: "bolos", label: activeBoloCount > 0 ? "BOLO (" + activeBoloCount + ")" : "BOLO" },
  ];

  return (
    <div className="h-screen w-screen flex flex-col bg-[#060608] text-white overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-black/40 border-b border-white/[0.06] z-30 relative">
        <div className="flex items-center gap-3">
          <h1 className="text-[11px] font-mono tracking-[0.2em] uppercase text-white/60">
            STARLING <span className="text-white/25">Nemo Ops</span>
          </h1>
          <div className="w-px h-3 bg-white/[0.08]" />
          <span className="text-[8px] font-mono tracking-wider text-white/15">
            AI Operations Center · Powered by OpenAI
          </span>
        </div>
        <div className="flex items-center gap-3">
          <FeatureToggles />
          <BoundingBoxControl
            bbox={bbox}
            drawing={bboxDrawing}
            onStartDraw={() => setBboxDrawing(true)}
            onClear={() => { setBbox(null); setBboxDrawing(false); }}
            onSetRadius={(b) => { setBbox(b); setBboxDrawing(false); }}
            centerLat={cameraPos.lat}
            centerLng={cameraPos.lng}
          />
          <button
            onClick={() => setSelectedCamera(cameras.length > 0 ? cameras[0].id : null)}
            className={`flex items-center gap-1 px-2 py-0.5 border rounded-sm text-[9px] font-mono tracking-wider transition-colors ${
              selectedCamera
                ? "border-cyan-400/30 text-cyan-400/70 bg-cyan-400/[0.06]"
                : "border-white/[0.08] text-white/30 hover:text-white/60 hover:border-white/20"
            }`}
          >
            <Camera size={9} />
            CAMS
          </button>
        </div>
      </div>

      {/* Main: 3-column layout — Nemo Chat | Map | Data Panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Nemo Chat Terminal (primary interface) */}
        <div className="w-96 flex flex-col bg-[#060608]/95 backdrop-blur-xl border-r border-white/[0.06] z-20 relative">
          <NemoChat
            onFlyTo={(lat, lng) => setFlyToTarget({ lat, lng })}
            onHighlight={(ids) => {
              if (ids.length === 1) setSelectedHypothesis(ids[0]);
            }}
            onFilterType={(type) => {
              if (type) {
                setTypeFilter(type as IncidentType);
                setActiveTab("hypotheses");
              }
            }}
            onBoloCreated={(bolo) => {
              setBolos((prev) => [bolo as Bolo, ...prev.filter((b) => b.id !== (bolo as Bolo).id)]);
              setActiveTab("bolos");
            }}
          />
        </div>

        {/* Center: Cesium Map */}
        <div className="flex-1 relative">
          <CesiumMap
            hypotheses={filteredHypotheses}
            cameras={cameras}
            roads={roads}
            vessels={features.ships ? vessels : []}
            flights={features.flights ? flights : []}
            showVessels={features.ships}
            showFlights={features.flights}
            selectedHypothesis={selectedHypothesis}
            onSelectHypothesis={setSelectedHypothesis}
            onCameraMove={handleCameraMove}
            flyToTarget={flyToTarget}
            bboxDrawing={bboxDrawing}
            bbox={bbox}
            onBBoxDrawn={handleBBoxDrawn}
            onTrafficFlow={handleTrafficFlow}
            onSelectCamera={(id) => {
              setSelectedCamera(id);
              const cam = cameras.find((c) => c.id === id);
              if (cam) setFlyToTarget({ lat: cam.lat, lng: cam.lng });
            }}
          />
          {bbox && trafficFlow && <TrafficFlowOverlay flow={trafficFlow} />}
          <HudOverlay
            cameraLat={cameraPos.lat}
            cameraLng={cameraPos.lng}
            cameraAlt={cameraPos.alt}
            feedStatus={feedStatus}
            activeCount={filteredHypotheses.length}
          />
          {selectedCamera && (
            <CameraViewer
              cameras={cameras}
              selectedCameraId={selectedCamera}
              onClose={() => setSelectedCamera(null)}
              onSelectCamera={setSelectedCamera}
              onFlyTo={(lat, lng) => setFlyToTarget({ lat, lng })}
            />
          )}
        </div>

        {/* Right rail: Data panels with tabs */}
        <div className="w-80 flex flex-col bg-[#060608]/90 backdrop-blur-xl border-l border-white/[0.06] z-20 relative">
          {/* Tab bar */}
          <div className="flex border-b border-white/[0.06]">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2.5 text-[9px] font-mono tracking-[0.15em] transition-colors ${
                  activeTab === tab.key
                    ? "text-white/80 border-b-2 border-white/40"
                    : "text-white/25 hover:text-white/40"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Filter chips (only on hypotheses tab) */}
          {activeTab === "hypotheses" && (
            <div className="px-3 py-2 border-b border-white/[0.06] flex flex-wrap gap-1">
              {FILTER_TYPES.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setTypeFilter(f.value)}
                  className={`px-2 py-0.5 text-[8px] font-mono tracking-wider rounded-full transition-colors ${
                    typeFilter === f.value
                      ? "bg-white/10 text-white/80"
                      : "text-white/25 hover:text-white/40 bg-white/[0.02]"
                  }`}
                >
                  {f.label.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === "sitrep" && <SitrepPanel hypotheses={filteredHypotheses} />}
            {activeTab === "hypotheses" && (
              <HypothesisPanel
                hypotheses={filteredHypotheses}
                selectedId={selectedHypothesis}
                onSelect={(id) => {
                  if (id === selectedHypothesis && id) {
                    const hyp = filteredHypotheses.find((h) => h.id === id);
                    if (hyp) setDetailHypothesis(hyp);
                  } else {
                    setSelectedHypothesis(id);
                  }
                }}
                onOpenCamera={setSelectedCamera}
                onOpenDetail={(hyp) => setDetailHypothesis(hyp)}
              />
            )}
            {activeTab === "bolos" && (
              <BoloPanel
                bolos={bolos}
                onFlyTo={(lat, lng) => setFlyToTarget({ lat, lng })}
                onOpenCamera={(cameraId) => {
                  setSelectedCamera(cameraId);
                  const cam = cameras.find((c) => c.id === cameraId);
                  if (cam) setFlyToTarget({ lat: cam.lat, lng: cam.lng });
                }}
                onClear={async (id) => {
                  await fetch("/api/bolo", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id }),
                  });
                }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="z-30 relative">
        <StatusBar status={feedStatus} lastServerLog={serverLogs.length > 0 ? serverLogs[serverLogs.length - 1] : null} />
      </div>

      {/* Incident Detail Overlay */}
      {detailHypothesis && (
        <IncidentDetail
          hypothesis={detailHypothesis}
          onClose={() => setDetailHypothesis(null)}
          onOpenCamera={setSelectedCamera}
          onFlyTo={(lat, lng) => setFlyToTarget({ lat, lng })}
        />
      )}
    </div>
  );
}
