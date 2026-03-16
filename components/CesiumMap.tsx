"use client";

import { useEffect, useRef, useCallback } from "react";
import { Hypothesis, CameraInfo, RoadSegment, VesselTrack, FlightTrack } from "@/lib/types";

export interface BBox {
  south: number; west: number; north: number; east: number;
}

export interface TrafficFlow {
  vehicleCount: number;
  avgSpeed: number;
}

interface CesiumMapProps {
  hypotheses: Hypothesis[];
  cameras: CameraInfo[];
  roads: RoadSegment[];
  vessels: VesselTrack[];
  flights: FlightTrack[];
  showVessels: boolean;
  showFlights: boolean;
  selectedHypothesis: string | null;
  onSelectHypothesis: (id: string | null) => void;
  onCameraMove?: (lat: number, lng: number, alt: number) => void;
  flyToTarget?: { lat: number; lng: number } | null;
  bboxDrawing: boolean;
  bbox: BBox | null;
  onBBoxDrawn: (bbox: BBox) => void;
  onTrafficFlow?: (flow: TrafficFlow | null) => void;
  onSelectCamera?: (id: string) => void;
}

const SOURCE_COLORS: Record<string, string> = {
  camera: "#ef4444",    // red — AI vision
  scanner: "#facc15",   // yellow — legacy feed
  "511": "#3b82f6",     // blue — traffic feed
  dispatch: "#a855f7",  // purple — dispatch
  multi: "#22c55e",     // green — multi-source
};

function getHypColor(hyp: Hypothesis): string {
  const sources = new Set(hyp.evidence.map((e) => e.source));
  if (sources.size >= 2) return SOURCE_COLORS.multi;
  const primary = hyp.evidence[hyp.evidence.length - 1]?.source || "511";
  return SOURCE_COLORS[primary] || SOURCE_COLORS["511"];
}

/** Haversine distance between two [lng, lat] points in miles */
function haversineMiles(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * sinLon * sinLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Compute total polyline length in miles */
function polylineLengthMiles(pts: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += haversineMiles(pts[i], pts[i + 1]);
  }
  return total || 0.01; // avoid division by zero
}

const MIN_HEIGHT = 50;
const MAX_HEIGHT = 80000;
const MAX_PITCH = -0.01; // nearly horizontal allowed

export default function CesiumMap({
  hypotheses, cameras, roads, vessels, flights, showVessels, showFlights, selectedHypothesis, onSelectHypothesis,
  onCameraMove, flyToTarget, bboxDrawing, bbox, onBBoxDrawn, onTrafficFlow, onSelectCamera,
}: CesiumMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const entityMapRef = useRef<Map<string, any>>(new Map());
  const carEntitiesRef = useRef<any[]>([]);
  const vesselEntitiesRef = useRef<Map<string, any>>(new Map());
  const flightEntitiesRef = useRef<Map<string, any>>(new Map());
  const vesselStateRef = useRef<Map<string, { lat: number; lng: number; heading: number; speedKts: number }>>(new Map());
  const flightStateRef = useRef<Map<string, { lat: number; lng: number; heading: number; speedKts: number; altitudeM: number }>>(new Map());
  const dynamicAnimRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const cesiumRef = useRef<any>(null);
  const bboxCorner1Ref = useRef<{ lat: number; lng: number } | null>(null);
  const bboxDrawingRef = useRef(false);
  const bboxRef = useRef<BBox | null>(null);
  const onSelectCameraRef = useRef(onSelectCamera);
  onSelectCameraRef.current = onSelectCamera;

  // Keep refs in sync with props
  useEffect(() => {
    bboxDrawingRef.current = bboxDrawing;
    if (!bboxDrawing) bboxCorner1Ref.current = null;
  }, [bboxDrawing]);

  useEffect(() => {
    bboxRef.current = bbox;
  }, [bbox]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      (window as any).CESIUM_BASE_URL = "https://cesium.com/downloads/cesiumjs/releases/1.139/Build/Cesium/";

      const Cesium = await import("cesium");
      if (cancelled) return;
      cesiumRef.current = Cesium;

      Cesium.Ion.defaultAccessToken = process.env.NEXT_PUBLIC_CESIUM_TOKEN || "";
      if (!containerRef.current) return;

      const viewer = new Cesium.Viewer(containerRef.current, {
        baseLayerPicker: false, geocoder: false, homeButton: false,
        sceneModePicker: false, navigationHelpButton: false,
        animation: false, timeline: false, fullscreenButton: false,
        selectionIndicator: false, infoBox: false,
        creditContainer: document.createElement("div"),
        baseLayer: false, terrain: undefined as any,
      });

      viewer.imageryLayers.removeAll();
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#08080c");
      viewer.scene.globe.show = false;
      if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
      if (viewer.scene.moon) viewer.scene.moon.show = false;
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;

      // Google Photorealistic 3D tiles need sun-based lighting
      // Hide the sun glyph but keep it as the light source
      if (viewer.scene.sun) viewer.scene.sun.show = false;
      viewer.scene.globe.enableLighting = true;

      // Lock clock to midday in SF so tiles are always bright
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date("2026-06-15T20:00:00Z")); // noon PST, summer
      viewer.clock.multiplier = 0;
      viewer.clock.shouldAnimate = false;

      // Max out the sun light intensity
      viewer.scene.light = new Cesium.SunLight({ intensity: 3.0 });
      viewer.scene.highDynamicRange = false;

      // ── Camera controls ──
      // Keep Cesium defaults: left drag = orbit, right drag = zoom, middle = pan
      // Just constrain the result so you can't look at sky
      const controller = viewer.scene.screenSpaceCameraController;
      controller.minimumZoomDistance = MIN_HEIGHT;
      controller.maximumZoomDistance = MAX_HEIGHT;
      controller.enableLook = false; // disable free-look (prevents flipping)
      controller.enableZoom = true;
      controller.enableRotate = true;
      controller.enableTilt = true;
      controller.enableTranslate = true;
      // Pinch gestures on trackpad/touch
      controller.zoomEventTypes = [
        Cesium.CameraEventType.WHEEL,
        Cesium.CameraEventType.PINCH,
        { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
      ];
      controller.tiltEventTypes = [
        Cesium.CameraEventType.MIDDLE_DRAG,
        Cesium.CameraEventType.PINCH,
        { eventType: Cesium.CameraEventType.RIGHT_DRAG },
        { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.ALT },
      ];

      // Pitch/roll constraint every frame
      viewer.scene.preRender.addEventListener(() => {
        if (viewer.camera.pitch > MAX_PITCH) {
          viewer.camera.setView({
            orientation: { heading: viewer.camera.heading, pitch: MAX_PITCH, roll: 0 },
          });
        }
        if (Math.abs(viewer.camera.roll) > 0.01) {
          viewer.camera.setView({
            orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: 0 },
          });
        }
        // Height clamp
        try {
          const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
          if (carto.height < MIN_HEIGHT) {
            viewer.camera.setView({
              destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, MIN_HEIGHT),
            });
          }
        } catch {}
      });

      // Google 3D Tiles
      const googleKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";
      try {
        const tileset = await Cesium.Cesium3DTileset.fromUrl(
          `https://tile.googleapis.com/v1/3dtiles/root.json?key=${googleKey}`
        );
        viewer.scene.primitives.add(tileset);
        console.log("[Cesium] Google 3D Tiles loaded");
      } catch (e) {
        console.warn("[Cesium] Google 3D Tiles failed, falling back to OSM:", e);
        viewer.scene.globe.show = true;
        viewer.scene.globe.enableLighting = false;
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#111118");
        try {
          const t = await Cesium.Cesium3DTileset.fromIonAssetId(96188);
          viewer.scene.primitives.add(t);
          t.style = new Cesium.Cesium3DTileStyle({ color: "color('#1e1e2e', 0.9)" });
        } catch {}
      }

      // Initial view
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(-122.3886, 37.7604, 250),
        orientation: { heading: Cesium.Math.toRadians(10), pitch: Cesium.Math.toRadians(-25), roll: 0 },
      });

      // HUD coordinate tracking
      viewer.camera.changed.addEventListener(() => {
        if (!onCameraMove) return;
        try {
          const c = Cesium.Cartographic.fromCartesian(viewer.camera.position);
          onCameraMove(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude), c.height);
        } catch {}
      });
      if (onCameraMove) {
        try {
          const c = Cesium.Cartographic.fromCartesian(viewer.camera.position);
          onCameraMove(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude), c.height);
        } catch {}
      }

      // Helper: pick lat/lng from screen position
      function pickLatLng(position: any): { lat: number; lng: number } | null {
        const ray = viewer.camera.getPickRay(position);
        if (!ray) return null;
        const cartesian = viewer.scene.globe?.pick(ray, viewer.scene) ||
          viewer.camera.pickEllipsoid(position, Cesium.Ellipsoid.WGS84);
        if (!cartesian) return null;
        const c = Cesium.Cartographic.fromCartesian(cartesian);
        return { lat: Cesium.Math.toDegrees(c.latitude), lng: Cesium.Math.toDegrees(c.longitude) };
      }

      // Click handler
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click: any) => {
        // Bbox drawing mode
        if (bboxDrawingRef.current) {
          const ll = pickLatLng(click.position);
          if (!ll) return;

          if (!bboxCorner1Ref.current) {
            bboxCorner1Ref.current = ll;
          } else {
            const c1 = bboxCorner1Ref.current;
            const c2 = ll;
            onBBoxDrawn({
              south: Math.min(c1.lat, c2.lat),
              west: Math.min(c1.lng, c2.lng),
              north: Math.max(c1.lat, c2.lat),
              east: Math.max(c1.lng, c2.lng),
            });
            bboxCorner1Ref.current = null;
          }
          return;
        }

        // Normal: select hypothesis or camera
        const picked = viewer.scene.pick(click.position);
        if (Cesium.defined(picked) && picked.id?.hypId) {
          onSelectHypothesis(picked.id.hypId);
        } else if (Cesium.defined(picked) && picked.id?._camId) {
          onSelectCameraRef.current?.(picked.id._camId);
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // Hover handler - show camera labels on hover
      let lastHovered: any = null;
      handler.setInputAction((move: any) => {
        const picked = viewer.scene.pick(move.endPosition);
        // Unhover previous
        if (lastHovered && lastHovered.label) {
          lastHovered.label.show = false;
        }
        lastHovered = null;
        if (Cesium.defined(picked) && picked.id?._camId && picked.id.label) {
          picked.id.label.show = true;
          lastHovered = picked.id;
          viewer.scene.canvas.style.cursor = "pointer";
        } else if (Cesium.defined(picked) && picked.id?.hypId) {
          viewer.scene.canvas.style.cursor = "pointer";
        } else {
          viewer.scene.canvas.style.cursor = "";
        }
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

      viewerRef.current = viewer;
    }

    init();

    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (dynamicAnimRef.current) cancelAnimationFrame(dynamicAnimRef.current);
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
      }
    };
  }, []);

  // ── Bbox rectangle rendering ──
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || viewer.isDestroyed()) return;

    const existing = viewer.entities.getById("bbox-rect");
    if (existing) viewer.entities.remove(existing);

    if (bbox) {
      viewer.entities.add({
        id: "bbox-rect",
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(bbox.west, bbox.south, bbox.east, bbox.north),
          material: Cesium.Color.fromCssColorString("rgba(34, 197, 94, 0.08)"),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("rgba(34, 197, 94, 0.6)"),
          outlineWidth: 2,
          height: 0,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    }
  }, [bbox]);

  // ── Incident markers ──
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || viewer.isDestroyed()) return;

    const existingIds = new Set(entityMapRef.current.keys());
    const currentIds = new Set(hypotheses.map((h) => h.id));

    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        const e = entityMapRef.current.get(id);
        if (e) viewer.entities.remove(e);
        entityMapRef.current.delete(id);
      }
    }

    for (const hyp of hypotheses) {
      const color = Cesium.Color.fromCssColorString(getHypColor(hyp));
      const isSelected = hyp.id === selectedHypothesis;
      // Ring thickness = confidence (thicker = more confident)
      const outlineWidth = Math.max(2, Math.round(hyp.confidence * 6));
      // Core size: severity-based
      const corePx = hyp.severity === "critical" ? 22 : hyp.severity === "high" ? 18 : 14;
      const glowColor = color.withAlpha(0.25);

      if (entityMapRef.current.has(hyp.id)) {
        const e = entityMapRef.current.get(hyp.id);
        e.position = Cesium.Cartesian3.fromDegrees(hyp.lng, hyp.lat, 50);
        // Inner glyph
        e.point.color = isSelected ? Cesium.Color.WHITE : color;
        e.point.outlineColor = isSelected ? color : glowColor;
        e.point.outlineWidth = isSelected ? outlineWidth + 2 : outlineWidth;
        e.point.pixelSize = isSelected ? corePx + 4 : corePx;
        // Label only when selected
        e.label.show = isSelected;
        if (isSelected) {
          e.label.text = `${hyp.type.replace("_", " ").toUpperCase()}\n${hyp.locationLabel}`;
        }
      } else {
        const e = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(hyp.lng, hyp.lat, 50),
          point: {
            pixelSize: isSelected ? corePx + 4 : corePx,
            color: isSelected ? Cesium.Color.WHITE : color,
            outlineColor: isSelected ? color : glowColor,
            outlineWidth: isSelected ? outlineWidth + 2 : outlineWidth,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            show: isSelected,
            text: isSelected ? `${hyp.type.replace("_", " ").toUpperCase()}\n${hyp.locationLabel}` : "",
            font: "10px monospace",
            fillColor: Cesium.Color.fromCssColorString("rgba(255,255,255,0.8)"),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -(corePx + outlineWidth + 6)),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            backgroundColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.6)"),
            showBackground: true,
            backgroundPadding: new Cesium.Cartesian2(6, 4),
          },
        });
        (e as any).hypId = hyp.id;
        entityMapRef.current.set(hyp.id, e);
      }
    }
  }, [hypotheses, selectedHypothesis]);

  // ── Traffic particles (Cesium point entities, only inside bbox) ──
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || viewer.isDestroyed()) return;

    // Clean up old particles
    for (const e of carEntitiesRef.current) {
      try { viewer.entities.remove(e); } catch {}
    }
    carEntitiesRef.current = [];
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    // No bbox or no roads = no particles
    if (!bbox || roads.length === 0) {
      if (onTrafficFlow) onTrafficFlow(null);
      return;
    }

    // Only include roads that have at least one point inside the user-drawn bbox
    const validRoads = roads.filter((r) => {
      if (r.polyline.length < 2) return false;
      return r.polyline.some(
        (pt) => pt[1] >= bbox.south && pt[1] <= bbox.north && pt[0] >= bbox.west && pt[0] <= bbox.east
      );
    });
    if (validRoads.length === 0) return;

    // Precompute road lengths in miles
    const roadLengths = validRoads.map((r) => polylineLengthMiles(r.polyline as [number, number][]));

    // Up to 5 cars per road, max 800
    const MAX = 800;
    const YELLOW = Cesium.Color.fromCssColorString("#facc15");
    const GLOW = Cesium.Color.fromCssColorString("rgba(250, 204, 21, 0.5)");
    const perRoad = Math.max(1, Math.min(5, Math.floor(MAX / validRoads.length)));

    const particles: { entity: any; roadIdx: number; t: number; speed: number }[] = [];

    for (let ri = 0; ri < validRoads.length && particles.length < MAX; ri++) {
      const road = validRoads[ri];
      const pts = road.polyline;
      const count = Math.min(perRoad, MAX - particles.length);
      for (let ci = 0; ci < count; ci++) {
        const t = (ci + Math.random()) / count;
        const si = Math.min(Math.floor(t * (pts.length - 1)), pts.length - 2);
        const st = (t * (pts.length - 1)) - si;
        const lng = pts[si][0] + (pts[si + 1][0] - pts[si][0]) * st;
        const lat = pts[si][1] + (pts[si + 1][1] - pts[si][1]) * st;

        const entity = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lng, lat, 2),
          point: {
            pixelSize: 10,
            color: YELLOW,
            outlineColor: GLOW,
            outlineWidth: 5,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });

        particles.push({ entity, roadIdx: ri, t, speed: road.currentSpeed });
        carEntitiesRef.current.push(entity);
      }
    }

    console.log(`[Traffic] ${particles.length} entities on ${validRoads.length} roads`);

    // Animation loop
    let lastTime = performance.now();
    let flowFrame = 0;

    function tick() {
      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      const C = cesiumRef.current;
      if (!C) return;

      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      let count = 0;
      let totalSpeed = 0;

      for (const p of particles) {
        const road = validRoads[p.roadIdx];
        if (!road) continue;
        // Use live road speed instead of cached p.speed
        const speed = road.currentSpeed ?? p.speed;
        const roadLen = roadLengths[p.roadIdx];
        // Normalize t increment by road length so all vehicles move at correct visual speed
        p.t += (speed / 3600 * dt) / roadLen;
        // When vehicle reaches end of road, reassign to a new random position
        if (p.t >= 1.0) {
          p.roadIdx = Math.floor(Math.random() * validRoads.length);
          p.t = Math.random() * 0.1; // enter near start of new road
        }
        const pts = validRoads[p.roadIdx].polyline;
        const si = Math.min(Math.floor(p.t * (pts.length - 1)), pts.length - 2);
        const st = (p.t * (pts.length - 1)) - si;
        const lng = pts[si][0] + (pts[si + 1][0] - pts[si][0]) * st;
        const lat = pts[si][1] + (pts[si + 1][1] - pts[si][1]) * st;
        p.entity.position = C.Cartesian3.fromDegrees(lng, lat, 2);
        count++;
        totalSpeed += speed;
      }

      flowFrame++;
      if (flowFrame >= 30) {
        flowFrame = 0;
        if (onTrafficFlow) {
          onTrafficFlow(count > 0 ? { vehicleCount: count, avgSpeed: totalSpeed / count } : null);
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    }
    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [roads, bbox]);

  // Fly to selected hypothesis + impact ripple rings
  useEffect(() => {
    const viewer = viewerRef.current; const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || viewer.isDestroyed()) return;

    // Remove old ripple entities
    const oldRipples = Array.from(viewer.entities.values).filter((e: any) => e._isRipple);
    for (const e of oldRipples) viewer.entities.remove(e);

    if (!selectedHypothesis) return;
    const hyp = hypotheses.find((h) => h.id === selectedHypothesis);
    if (!hyp) return;

    // Impact radius calculation
    const sevMult = { critical: 4, high: 3, medium: 2, low: 1 }[hyp.severity] || 1;
    const typeMult: Record<string, number> = {
      accident: 3, fire: 3.5, road_closure: 2.5, congestion: 2,
      construction: 1.5, medical: 1, police: 1.5, hazard: 1.5, weather: 2, other: 1,
    };
    const baseRadius = sevMult * (typeMult[hyp.type] || 1) * 0.3 * hyp.confidence; // miles
    const color = Cesium.Color.fromCssColorString(getHypColor(hyp));

    // Draw 3 concentric impact rings
    const rings = [
      { factor: 0.3, alpha: 0.12, label: "Direct" },
      { factor: 0.6, alpha: 0.06, label: "Delay" },
      { factor: 1.0, alpha: 0.03, label: "Ripple" },
    ];

    for (const ring of rings) {
      const radiusMeters = baseRadius * ring.factor * 1609.34;
      const e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(hyp.lng, hyp.lat, 1),
        ellipse: {
          semiMajorAxis: radiusMeters,
          semiMinorAxis: radiusMeters,
          material: color.withAlpha(ring.alpha),
          outline: true,
          outlineColor: color.withAlpha(ring.alpha * 3),
          outlineWidth: 1,
          height: 1,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
      });
      (e as any)._isRipple = true;
    }
  }, [selectedHypothesis, hypotheses]);

  // Fly to search target
  useEffect(() => {
    const viewer = viewerRef.current; const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || viewer.isDestroyed() || !flyToTarget) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(flyToTarget.lng, flyToTarget.lat - 0.006, 500),
      orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-30), roll: 0 },
      duration: 2.0,
    });
  }, [flyToTarget]);

  // Camera markers
  useEffect(() => {
    const viewer = viewerRef.current; const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || viewer.isDestroyed()) return;
    const toRemove = Array.from(viewer.entities.values).filter((e: any) => e._isCam);
    for (const e of toRemove) viewer.entities.remove(e);
    for (const cam of cameras) {
      const isActive = !!cam.lastFetched;
      const e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(cam.lng, cam.lat, 30),
        point: {
          pixelSize: 20,
          color: isActive ? Cesium.Color.fromCssColorString("#22d3ee") : Cesium.Color.fromCssColorString("#334155"),
          outlineColor: isActive ? Cesium.Color.fromCssColorString("#0e7490") : Cesium.Color.fromCssColorString("#1e293b"),
          outlineWidth: 4,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          show: false,
          text: cam.name,
          font: "9px monospace",
          fillColor: Cesium.Color.fromCssColorString("rgba(255,255,255,0.7)"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.6)"),
          showBackground: true,
          backgroundPadding: new Cesium.Cartesian2(4, 2),
        },
      });
      (e as any)._isCam = true;
      (e as any)._camId = cam.id;
    }
  }, [cameras]);

  // Vessel + flight animated overlays
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || viewer.isDestroyed()) return;

    const upsertVessel = (v: VesselTrack) => {
      const existing = vesselEntitiesRef.current.get(v.id);
      vesselStateRef.current.set(v.id, {
        lat: v.lat,
        lng: v.lng,
        heading: v.heading || 0,
        speedKts: v.speedKts || 0,
      });
      if (existing) return;
      const e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(v.lng, v.lat, 4),
        point: {
          pixelSize: 11,
          color: Cesium.Color.fromCssColorString("#2dd4bf"),
          outlineColor: Cesium.Color.fromCssColorString("rgba(45,212,191,0.45)"),
          outlineWidth: 5,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          show: false,
          text: v.name,
          font: "9px monospace",
          fillColor: Cesium.Color.fromCssColorString("rgba(255,255,255,0.75)"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.6)"),
          showBackground: true,
          backgroundPadding: new Cesium.Cartesian2(4, 2),
        },
      });
      (e as any)._isVessel = true;
      vesselEntitiesRef.current.set(v.id, e);
    };

    const upsertFlight = (f: FlightTrack) => {
      const existing = flightEntitiesRef.current.get(f.id);
      flightStateRef.current.set(f.id, {
        lat: f.lat,
        lng: f.lng,
        heading: f.heading || 0,
        speedKts: f.speedKts || 0,
        altitudeM: Math.max(300, f.altitudeM || 1200),
      });
      if (existing) return;
      const e = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(f.lng, f.lat, Math.max(300, f.altitudeM || 1200)),
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString("#f59e0b"),
          outlineColor: Cesium.Color.fromCssColorString("rgba(245,158,11,0.4)"),
          outlineWidth: 4,
          heightReference: Cesium.HeightReference.NONE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          show: false,
          text: f.callsign || f.id.toUpperCase(),
          font: "9px monospace",
          fillColor: Cesium.Color.fromCssColorString("rgba(255,255,255,0.75)"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.NONE,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.6)"),
          showBackground: true,
          backgroundPadding: new Cesium.Cartesian2(4, 2),
        },
      });
      (e as any)._isFlight = true;
      flightEntitiesRef.current.set(f.id, e);
    };

    const vesselIds = new Set((showVessels ? vessels : []).map((v) => v.id));
    for (const [id, entity] of vesselEntitiesRef.current.entries()) {
      if (!vesselIds.has(id)) {
        viewer.entities.remove(entity);
        vesselEntitiesRef.current.delete(id);
        vesselStateRef.current.delete(id);
      }
    }
    if (showVessels) {
      for (const v of vessels) upsertVessel(v);
    } else {
      for (const entity of vesselEntitiesRef.current.values()) viewer.entities.remove(entity);
      vesselEntitiesRef.current.clear();
      vesselStateRef.current.clear();
    }

    const flightIds = new Set((showFlights ? flights : []).map((f) => f.id));
    for (const [id, entity] of flightEntitiesRef.current.entries()) {
      if (!flightIds.has(id)) {
        viewer.entities.remove(entity);
        flightEntitiesRef.current.delete(id);
        flightStateRef.current.delete(id);
      }
    }
    if (showFlights) {
      for (const f of flights) upsertFlight(f);
    } else {
      for (const entity of flightEntitiesRef.current.values()) viewer.entities.remove(entity);
      flightEntitiesRef.current.clear();
      flightStateRef.current.clear();
    }

    let last = performance.now();
    if (dynamicAnimRef.current) cancelAnimationFrame(dynamicAnimRef.current);

    const tick = () => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.15);
      last = now;

      for (const [id, state] of vesselStateRef.current.entries()) {
        const e = vesselEntitiesRef.current.get(id);
        if (!e) continue;
        const meters = state.speedKts * 0.514444 * dt;
        const r = (state.heading * Math.PI) / 180;
        const dLat = (meters * Math.cos(r)) / 111320;
        const dLng = (meters * Math.sin(r)) / (111320 * Math.max(0.2, Math.cos((state.lat * Math.PI) / 180)));
        state.lat += dLat;
        state.lng += dLng;
        e.position = Cesium.Cartesian3.fromDegrees(state.lng, state.lat, 4);
      }

      for (const [id, state] of flightStateRef.current.entries()) {
        const e = flightEntitiesRef.current.get(id);
        if (!e) continue;
        const meters = state.speedKts * 0.514444 * dt;
        const r = (state.heading * Math.PI) / 180;
        const dLat = (meters * Math.cos(r)) / 111320;
        const dLng = (meters * Math.sin(r)) / (111320 * Math.max(0.2, Math.cos((state.lat * Math.PI) / 180)));
        state.lat += dLat;
        state.lng += dLng;
        e.position = Cesium.Cartesian3.fromDegrees(state.lng, state.lat, state.altitudeM);
      }

      dynamicAnimRef.current = requestAnimationFrame(tick);
    };

    dynamicAnimRef.current = requestAnimationFrame(tick);
    return () => {
      if (dynamicAnimRef.current) cancelAnimationFrame(dynamicAnimRef.current);
    };
  }, [vessels, flights, showVessels, showFlights]);

  // Zoom helpers
  const zoomIn = useCallback(() => {
    const v = viewerRef.current; const C = cesiumRef.current;
    if (!v || !C || v.isDestroyed()) return;
    const c = C.Cartographic.fromCartesian(v.camera.position);
    v.camera.flyTo({
      destination: C.Cartesian3.fromRadians(c.longitude, c.latitude, Math.max(MIN_HEIGHT, c.height * 0.5)),
      orientation: { heading: v.camera.heading, pitch: v.camera.pitch, roll: 0 },
      duration: 0.4,
    });
  }, []);

  const zoomOut = useCallback(() => {
    const v = viewerRef.current; const C = cesiumRef.current;
    if (!v || !C || v.isDestroyed()) return;
    const c = C.Cartographic.fromCartesian(v.camera.position);
    v.camera.flyTo({
      destination: C.Cartesian3.fromRadians(c.longitude, c.latitude, Math.min(MAX_HEIGHT, c.height * 2)),
      orientation: { heading: v.camera.heading, pitch: v.camera.pitch, roll: 0 },
      duration: 0.4,
    });
  }, []);

  const resetView = useCallback(() => {
    const v = viewerRef.current; const C = cesiumRef.current;
    if (!v || !C || v.isDestroyed()) return;
    v.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(-122.3886, 37.7604, 250),
      orientation: { heading: C.Math.toRadians(10), pitch: C.Math.toRadians(-25), roll: 0 },
      duration: 1.5,
    });
  }, []);

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      // Cmd+= / Cmd+- / Cmd+0 for zoom/reset
      if (e.metaKey) {
        if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomIn(); }
        else if (e.key === "-") { e.preventDefault(); zoomOut(); }
        else if (e.key === "0") { e.preventDefault(); resetView(); }
        return;
      }

      // Skip if user is typing in an input
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;

      // Arrow keys: orbit heading (left/right) and tilt pitch (up/down)
      const v = viewerRef.current; const C = cesiumRef.current;
      if (!v || !C || v.isDestroyed()) return;

      const ROTATE_STEP = C.Math.toRadians(5);
      const TILT_STEP = C.Math.toRadians(3);

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        v.camera.setView({
          orientation: { heading: v.camera.heading - ROTATE_STEP, pitch: v.camera.pitch, roll: 0 },
        });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        v.camera.setView({
          orientation: { heading: v.camera.heading + ROTATE_STEP, pitch: v.camera.pitch, roll: 0 },
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const newPitch = Math.min(v.camera.pitch + TILT_STEP, MAX_PITCH);
        v.camera.setView({
          orientation: { heading: v.camera.heading, pitch: newPitch, roll: 0 },
        });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const newPitch = Math.max(v.camera.pitch - TILT_STEP, C.Math.toRadians(-89));
        v.camera.setView({
          orientation: { heading: v.camera.heading, pitch: newPitch, roll: 0 },
        });
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [zoomIn, zoomOut, resetView]);

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className={`w-full h-full ${bboxDrawing ? "cursor-crosshair" : ""}`} />
      <div className="absolute bottom-6 left-6 flex flex-col gap-1 z-30 pointer-events-auto">
        <button onClick={zoomIn} className="w-7 h-7 flex items-center justify-center bg-black/50 border border-white/[0.08] rounded text-white/40 hover:text-white/70 hover:border-white/20 transition-colors font-mono text-sm backdrop-blur-sm" title="Zoom in (Cmd +)">+</button>
        <button onClick={zoomOut} className="w-7 h-7 flex items-center justify-center bg-black/50 border border-white/[0.08] rounded text-white/40 hover:text-white/70 hover:border-white/20 transition-colors font-mono text-sm backdrop-blur-sm" title="Zoom out (Cmd -)">-</button>
        <button onClick={resetView} className="w-7 h-7 flex items-center justify-center bg-black/50 border border-white/[0.08] rounded text-white/40 hover:text-white/70 hover:border-white/20 transition-colors font-mono text-[9px] backdrop-blur-sm mt-1" title="Reset view (Cmd 0)">SF</button>
      </div>
    </div>
  );
}
