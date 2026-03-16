"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CameraInfo } from "@/lib/types";
import {
  X, ChevronLeft, ChevronRight, Camera, RefreshCw,
  MapPin, Eye, EyeOff, Maximize2, Minimize2,
} from "lucide-react";

interface CameraViewerProps {
  cameras: CameraInfo[];
  selectedCameraId: string | null;
  onClose: () => void;
  onSelectCamera: (id: string) => void;
  onFlyTo?: (lat: number, lng: number) => void;
}

const REFRESH_INTERVAL = 15000;

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function isEmbeddedVideoCamera(camera: CameraInfo | null): boolean {
  if (!camera?.streamUrl) return false;
  return camera.streamUrl.includes("youtube.com/embed") || camera.streamUrl.includes("youtube-nocookie.com/embed");
}

export default function CameraViewer({
  cameras,
  selectedCameraId,
  onClose,
  onSelectCamera,
  onFlyTo,
}: CameraViewerProps) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showList, setShowList] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const epochRef = useRef(0);

  const camera = cameras.find((c) => c.id === selectedCameraId) || null;
  const currentIdx = cameras.findIndex((c) => c.id === selectedCameraId);
  const isEmbeddedVideo = isEmbeddedVideoCamera(camera);

  const loadImage = useCallback((camId: string) => {
    epochRef.current++;
    setLoading(true);
    setError(false);
    setImgSrc(`/api/cameras/${camId}/image?t=${Date.now()}`);
  }, []);

  // Load image when camera changes
  useEffect(() => {
    if (!selectedCameraId) return;
    if (isEmbeddedVideo) {
      setImgSrc(null);
      setLoading(false);
      setError(false);
      if (refreshTimer.current) clearInterval(refreshTimer.current);
      return;
    }
    loadImage(selectedCameraId);

    // Auto-refresh
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(() => {
      loadImage(selectedCameraId);
    }, REFRESH_INTERVAL);

    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [isEmbeddedVideo, loadImage, selectedCameraId]);

  const prev = useCallback(() => {
    if (cameras.length === 0) return;
    const idx = currentIdx <= 0 ? cameras.length - 1 : currentIdx - 1;
    onSelectCamera(cameras[idx].id);
  }, [cameras, currentIdx, onSelectCamera]);

  const next = useCallback(() => {
    if (cameras.length === 0) return;
    const idx = currentIdx >= cameras.length - 1 ? 0 : currentIdx + 1;
    onSelectCamera(cameras[idx].id);
  }, [cameras, currentIdx, onSelectCamera]);

  // Keyboard nav
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [prev, next, onClose]);

  if (!camera) return null;

  return (
    <div
      className={`absolute z-40 flex flex-col bg-[#0a0a0f]/95 backdrop-blur-xl border border-white/[0.08] rounded-lg shadow-2xl shadow-black/60 overflow-hidden transition-all ${
        expanded
          ? "inset-4"
          : "bottom-4 left-4 w-[420px]"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
        <Camera size={12} className="text-white/30" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-mono text-white/70 truncate">
            {camera.name}
          </div>
          <div className="text-[8px] font-mono text-white/25 tabular-nums">
            {camera.id} — {camera.lat.toFixed(4)}, {camera.lng.toFixed(4)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (!isEmbeddedVideo) loadImage(camera.id);
            }}
            className="p-1 text-white/20 hover:text-white/50 transition-colors"
            title={isEmbeddedVideo ? "Live embed" : "Refresh"}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => onFlyTo?.(camera.lat, camera.lng)}
            className="p-1 text-white/20 hover:text-white/50 transition-colors"
            title="Fly to camera"
          >
            <MapPin size={11} />
          </button>
          <button
            onClick={() => setShowList((v) => !v)}
            className="p-1 text-white/20 hover:text-white/50 transition-colors"
            title="Camera list"
          >
            {showList ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1 text-white/20 hover:text-white/50 transition-colors"
            title={expanded ? "Minimize" : "Maximize"}
          >
            {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
          <button
            onClick={onClose}
            className="p-1 text-white/20 hover:text-white/50 transition-colors"
            title="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Camera list sidebar */}
        {showList && (
          <div className="w-44 border-r border-white/[0.06] overflow-y-auto scrollbar-thin flex-shrink-0">
            {cameras.map((cam) => (
              <button
                key={cam.id}
                onClick={() => onSelectCamera(cam.id)}
                className={`w-full text-left px-3 py-2 border-b border-white/[0.03] transition-colors ${
                  cam.id === selectedCameraId
                    ? "bg-white/[0.06] text-white/80"
                    : "text-white/35 hover:bg-white/[0.03] hover:text-white/55"
                }`}
              >
                <div className="text-[9px] font-mono truncate">{cam.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className={`w-1 h-1 rounded-full ${
                      cam.lastFetched ? "bg-emerald-400/60" : "bg-white/10"
                    }`}
                  />
                  <span className="text-[7px] font-mono text-white/20 tabular-nums">
                    {cam.lastFetched ? timeAgo(cam.lastFetched) : "no data"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Image area */}
        <div className="flex-1 relative bg-black flex items-center justify-center min-h-[220px]">
          {isEmbeddedVideo && camera?.streamUrl ? (
            <iframe
              src={camera.streamUrl}
              title={camera.name}
              className="h-full w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : imgSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc}
              alt={camera.name}
              className={`w-full h-full object-contain ${loading && !error ? "opacity-60" : ""}`}
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setError(true); }}
            />
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-[10px] font-mono text-white/20 text-center">
                <Camera size={24} className="mx-auto mb-2 text-white/10" />
                Feed unavailable
              </div>
            </div>
          )}
          {loading && !imgSrc && (
            <div className="text-[10px] font-mono text-white/20 animate-pulse">Loading...</div>
          )}

          {/* Nav arrows */}
          <button
            onClick={prev}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/50 rounded-full text-white/30 hover:text-white/70 transition-colors backdrop-blur-sm"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={next}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/50 rounded-full text-white/30 hover:text-white/70 transition-colors backdrop-blur-sm"
          >
            <ChevronRight size={16} />
          </button>

          {/* Camera counter */}
          <div className="absolute bottom-2 right-2 text-[8px] font-mono text-white/20 bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm tabular-nums">
            {currentIdx + 1} / {cameras.length}
          </div>
        </div>
      </div>

      {/* Analysis footer */}
      {camera.lastAnalysis && (
        <div className="px-3 py-2 border-t border-white/[0.06] text-[9px] font-mono">
          <div className="flex items-center gap-3 text-white/30">
            <span>
              Traffic:{" "}
              <span className={
                camera.lastAnalysis.trafficDensity === "heavy" || camera.lastAnalysis.trafficDensity === "gridlock"
                  ? "text-red-400/70"
                  : camera.lastAnalysis.trafficDensity === "moderate"
                  ? "text-amber-400/70"
                  : "text-emerald-400/60"
              }>
                {camera.lastAnalysis.trafficDensity}
              </span>
            </span>
            {camera.lastAnalysis.weather && (
              <span>Weather: <span className="text-white/45">{camera.lastAnalysis.weather}</span></span>
            )}
            {camera.lastAnalysis.hasIncident && (
              <span className="text-amber-400/70">
                {camera.lastAnalysis.incidents.length} incident{camera.lastAnalysis.incidents.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {camera.lastAnalysis.hasIncident && camera.lastAnalysis.incidents.map((inc, i) => (
            <div key={i} className="mt-1 text-white/25 pl-2 border-l border-white/[0.06]">
              <span className="text-amber-400/50 uppercase tracking-wider">{inc.type}</span>
              {" — "}{inc.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
