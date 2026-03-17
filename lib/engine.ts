import { poll511, pollDataSF } from "./feeds";
import { loadCameras, getCameras, fetchCameraImage, getWorkingCameras } from "./cameras";
import { analyzeCamera, batchBoloScan, verifyBoloCandidate } from "./vision";
import { addEvidence } from "./hypothesis";
import { runDecayCycle } from "./hypothesis";
import { initializeRoads, updateTrafficFromIncidents } from "./traffic-sim";
import { store, FeatureFlags } from "./store";
import { sseBroker } from "./sse";
import { Evidence, CameraInfo, BoloSighting, TrafficDensity } from "./types";
import { addServerLog } from "./server-logs";
import { persistProof } from "./proof-persistence";

type PipelineStats = {
  ts: string;
  v1Matches: number;
  v2Matches: number;
  overlap: number;
  sampledCameras: number;
};

type PendingSighting = {
  hits: number;
  firstSeenMs: number;
  lastSeenMs: number;
  confidenceSum: number;
  bbox?: [number, number, number, number];
  attributes?: BoloSighting["attributes"];
};

const validationHistory: PipelineStats[] = [];
const pendingSightings = new Map<string, PendingSighting>();
const confirmedSightingCooldown = new Map<string, number>();

const MIN_CONFIRM_HITS = 2;
const MIN_HIT_CONFIDENCE = 0.55;
const MIN_AVG_CONFIDENCE = 0.68;
const CONFIRM_WINDOW_MS = 90_000;
const CONFIRM_COOLDOWN_MS = 60_000;

function logEngine(level: "info" | "warn" | "error", message: string) {
  const entry = addServerLog(level, message);
  sseBroker.broadcast("server:log", entry);
}

function hasVisionProviderConfigured(): boolean {
  return Boolean(process.env.NVIDIA_API_KEY || process.env.GEMINI_API_KEY);
}

const globalForEngine = globalThis as unknown as {
  __engineStarted?: boolean;
  __intervals: Record<string, ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null>;
  __cameraLoopRunning?: boolean;
  __cameraLoopStopped?: boolean;
};

if (!globalForEngine.__intervals) {
  globalForEngine.__intervals = {};
}

export function startEngine() {
  if (globalForEngine.__engineStarted) return;
  globalForEngine.__engineStarted = true;
  console.log("[Engine] Starting Starling Operations Center (Nemo engine)...");
  logEngine("info", "Engine starting");

  // Initialize road segments
  initializeRoads();

  // Load cameras from Caltrans API (async), then populate store
  loadCameras().then((cams) => {
    store.cameras.clear();
    for (const cam of cams) {
      store.cameras.set(cam.id, { ...cam });
    }
    store.updateFeedStatus();
    console.log(`[Engine] Loaded ${cams.length} cameras into store`);
    logEngine("info", `Loaded ${cams.length} cameras`);
  });

  // Also populate store with fallback cameras immediately so UI isn't empty
  for (const cam of getCameras()) {
    store.cameras.set(cam.id, { ...cam });
  }
  store.updateFeedStatus();

  // Decay cycle always runs (core to hypothesis management)
  setInterval(() => {
    runDecayCycle();
    updateTrafficFromIncidents();
  }, 30000);

  // Initial traffic update after 5s
  setTimeout(() => updateTrafficFromIncidents(), 5000);

  console.log("[Engine] Core started — features await user activation");
  logEngine("info", "Core started; waiting for feature toggles");
}

// ── Feature toggle API ──

export function toggleFeature(feature: keyof FeatureFlags, enabled: boolean) {
  const was = store.features[feature];
  store.features[feature] = enabled;

  if (enabled && !was) {
    startFeature(feature);
  } else if (!enabled && was) {
    stopFeature(feature);
  }

  console.log(`[Engine] Feature "${feature}" ${enabled ? "ENABLED" : "DISABLED"}`);
  logEngine("info", `Feature ${feature} ${enabled ? "enabled" : "disabled"}`);
  sseBroker.broadcast("features", store.features);
}

function startFeature(feature: keyof FeatureFlags) {
  switch (feature) {
    case "cameras":
      startCameraLoop();
      startBoloScanLoop();
      break;

    case "boloV2":
      break;

    case "feed511":
      poll511();
      globalForEngine.__intervals.feed511 = setInterval(() => {
        if (store.features.feed511) poll511();
      }, 60000);
      break;

    case "feedDataSF":
      pollDataSF();
      globalForEngine.__intervals.feedDataSF = setInterval(() => {
        if (store.features.feedDataSF) pollDataSF();
      }, 60000);
      break;
  }
}

function stopFeature(feature: keyof FeatureFlags) {
  switch (feature) {
    case "cameras":
      globalForEngine.__cameraLoopStopped = true;
      globalForEngine.__cameraLoopRunning = false;
      if (globalForEngine.__intervals.cameraTimeout) {
        clearTimeout(globalForEngine.__intervals.cameraTimeout as ReturnType<typeof setTimeout>);
        globalForEngine.__intervals.cameraTimeout = null;
      }
      stopBoloScanLoop();
      break;

    case "boloV2":
      break;

    case "feed511":
      if (globalForEngine.__intervals.feed511) {
        clearInterval(globalForEngine.__intervals.feed511 as ReturnType<typeof setInterval>);
        globalForEngine.__intervals.feed511 = null;
      }
      store.feedStatus.fiveEleven = "error";
      break;

    case "feedDataSF":
      if (globalForEngine.__intervals.feedDataSF) {
        clearInterval(globalForEngine.__intervals.feedDataSF as ReturnType<typeof setInterval>);
        globalForEngine.__intervals.feedDataSF = null;
      }
      break;
  }
}

export function getFeatures(): FeatureFlags {
  return { ...store.features };
}

// ── Priority camera scheduler ──

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const NEAR_INCIDENT_MILES = 0.5;
const PRIORITY_INTERVAL = 60000;   // 1 min when active incidents
const NORMAL_INTERVAL = 120000;    // 2 min normally — conserve quota
const BOLO_PRIORITY_CAMERA_SLEEP_MS = 60000; // While BOLOs active, pause generic camera analysis loop

function getBboxCenter(bbox?: [number, number, number, number]) {
  if (!bbox || bbox.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = bbox;
  return {
    x: (xmin + xmax) / 2,
    y: (ymin + ymax) / 2,
  };
}

function bboxIoU(a?: [number, number, number, number], b?: [number, number, number, number]): number {
  if (!a || !b) return 0;
  const [ay1, ax1, ay2, ax2] = a;
  const [by1, bx1, by2, bx2] = b;
  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function matchKeyForCandidate(boloId: string, cam: CameraInfo, bbox?: [number, number, number, number]): string {
  const center = getBboxCenter(bbox);
  if (!center) return `${boloId}:${cam.id}:na`;
  const qx = Math.round(center.x / 10) * 10;
  const qy = Math.round(center.y / 10) * 10;
  return `${boloId}:${cam.id}:${qx}:${qy}`;
}

function attributesConflict(
  a?: BoloSighting["attributes"],
  b?: BoloSighting["attributes"]
): boolean {
  if (!a || !b) return false;
  const norm = (v?: string) => (v || "").toLowerCase().trim();
  if (a.make && b.make && norm(a.make) !== norm(b.make)) return true;
  if (a.model && b.model && norm(a.model) !== norm(b.model)) return true;
  if (a.primaryColor && b.primaryColor && norm(a.primaryColor) !== norm(b.primaryColor)) return true;
  return false;
}

function normalizeBbox(bbox: [number, number, number, number]): [number, number, number, number] {
  let [ymin, xmin, ymax, xmax] = bbox;
  // If any value > 100, assume pixel coords on a ~1000-unit canvas and scale
  if (ymin > 100 || xmin > 100 || ymax > 100 || xmax > 100) {
    const maxVal = Math.max(ymin, xmin, ymax, xmax);
    const scale = maxVal > 500 ? 1000 : 100;
    ymin = (ymin / scale) * 100;
    xmin = (xmin / scale) * 100;
    ymax = (ymax / scale) * 100;
    xmax = (xmax / scale) * 100;
  }
  // Clamp to 0-100
  ymin = Math.max(0, Math.min(100, ymin));
  xmin = Math.max(0, Math.min(100, xmin));
  ymax = Math.max(0, Math.min(100, ymax));
  xmax = Math.max(0, Math.min(100, xmax));
  // Ensure min < max
  if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
  if (xmin > xmax) [xmin, xmax] = [xmax, xmin];
  return [ymin, xmin, ymax, xmax];
}

function buildProofImageUrl(cam: CameraInfo, sightingId: string, confidence: number, bbox?: [number, number, number, number]): string {
  const params = new URLSearchParams({
    id: sightingId,
    url: cam.imageUrl,
    cameraId: cam.id,
    cameraName: cam.name,
    confidence: String(confidence),
    label: "SUSPECT VEHICLE FOUND",
    location: cam.name,
  });
  if (bbox && bbox.length === 4) {
    const normalized = normalizeBbox(bbox);
    params.set("bbox", normalized.join(","));
  }
  return `/api/proof?${params.toString()}`;
}

function recordBoloSighting(
  boloId: string,
  cam: CameraInfo,
  details: string,
  confidence: number,
  bbox?: [number, number, number, number],
  attributes?: BoloSighting["attributes"],
  verified?: boolean
) {
  const bolo = store.bolos.get(boloId);
  if (!bolo || bolo.status === "cleared") return;
  if (confidence < MIN_HIT_CONFIDENCE) return;

  const now = Date.now();
  const key = matchKeyForCandidate(boloId, cam, bbox);
  const cooldownUntil = confirmedSightingCooldown.get(key) || 0;
  if (cooldownUntil > now) {
    return;
  }

  // V2 verified matches bypass multi-hit: two-pass verification already serves
  // as the second confirmation, so we promote directly to confirmed.
  if (verified) {
    confirmedSightingCooldown.set(key, now + CONFIRM_COOLDOWN_MS);
    pendingSightings.delete(key);

    const sightingId = "sight_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const proofUrl = buildProofImageUrl(cam, sightingId, confidence, bbox);
    const rawProofUrl = `/api/proof?id=${encodeURIComponent(sightingId)}&mode=raw`;

    const sighting: BoloSighting = {
      id: sightingId,
      boloId: bolo.id,
      source: "camera",
      sourceId: cam.id,
      location: cam.name,
      lat: cam.lat,
      lng: cam.lng,
      timestamp: new Date().toISOString(),
      confidence,
      details,
      attributes,
      bbox,
      proofImageUrl: proofUrl,
      proofRawImageUrl: rawProofUrl,
      proofAnnotatedImageUrl: proofUrl,
    };

    bolo.sightings.push(sighting);
    bolo.status = "confirmed";
    bolo.lastKnownLocation = cam.name;
    bolo.latestScore = confidence;
    store.bolos.set(bolo.id, bolo);
    sseBroker.broadcast("bolo:sighting", { bolo, sighting });
    logEngine("warn", `BOLO CONFIRMED (verified) ${bolo.id} at ${cam.name} conf=${confidence.toFixed(2)}`);
    persistProof({
      sightingId,
      imageUrl: cam.imageUrl,
      cameraId: cam.id,
      cameraName: cam.name,
      confidence,
      label: "BOLO MATCH",
      bbox,
    }).catch((e) => console.warn("[Proof] Proactive save failed:", e));
    return;
  }

  const existing = pendingSightings.get(key);
  if (existing && now - existing.lastSeenMs > CONFIRM_WINDOW_MS) {
    pendingSightings.delete(key);
  }

  const current = pendingSightings.get(key);
  if (!current) {
    pendingSightings.set(key, {
      hits: 1,
      firstSeenMs: now,
      lastSeenMs: now,
      confidenceSum: confidence,
      bbox,
      attributes,
    });
    if (bolo.status === "candidate") {
      bolo.status = "active";
      store.bolos.set(bolo.id, bolo);
      sseBroker.broadcast("bolo:update", bolo);
    }
    logEngine("info", `BOLO candidate queued ${bolo.id} at ${cam.name} conf=${confidence.toFixed(2)}`);
    return;
  }

  if (bbox && current.bbox && bboxIoU(current.bbox, bbox) < 0.1) {
    pendingSightings.set(key, {
      hits: 1,
      firstSeenMs: now,
      lastSeenMs: now,
      confidenceSum: confidence,
      bbox,
      attributes,
    });
    return;
  }

  if (attributesConflict(current.attributes, attributes)) {
    pendingSightings.set(key, {
      hits: 1,
      firstSeenMs: now,
      lastSeenMs: now,
      confidenceSum: confidence,
      bbox,
      attributes,
    });
    return;
  }

  current.hits += 1;
  current.lastSeenMs = now;
  current.confidenceSum += confidence;
  if (bbox) current.bbox = bbox;
  if (attributes) current.attributes = attributes;
  pendingSightings.set(key, current);

  const ageMs = now - current.firstSeenMs;
  const avgConfidence = current.confidenceSum / current.hits;
  if (current.hits < MIN_CONFIRM_HITS || ageMs > CONFIRM_WINDOW_MS || avgConfidence < MIN_AVG_CONFIDENCE) {
    logEngine(
      "info",
      `BOLO candidate hold ${bolo.id} at ${cam.name} hits=${current.hits} avg=${avgConfidence.toFixed(2)}`
    );
    return;
  }

  pendingSightings.delete(key);
  confirmedSightingCooldown.set(key, now + CONFIRM_COOLDOWN_MS);

  const sightingId = "sight_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  const finalConfidence = Math.max(confidence, avgConfidence);
  const proofUrl = buildProofImageUrl(cam, sightingId, finalConfidence, bbox);
  const rawProofUrl = `/api/proof?id=${encodeURIComponent(sightingId)}&mode=raw`;

  const sighting: BoloSighting = {
    id: sightingId,
    boloId: bolo.id,
    source: "camera",
    sourceId: cam.id,
    location: cam.name,
    lat: cam.lat,
    lng: cam.lng,
    timestamp: new Date().toISOString(),
    confidence: finalConfidence,
    details,
    attributes: current.attributes || attributes,
    bbox: current.bbox || bbox,
    proofImageUrl: proofUrl,
    proofRawImageUrl: rawProofUrl,
    proofAnnotatedImageUrl: proofUrl,
  };

  bolo.sightings.push(sighting);
  bolo.status = "confirmed";
  bolo.lastKnownLocation = cam.name;
  bolo.latestScore = finalConfidence;
  store.bolos.set(bolo.id, bolo);
  sseBroker.broadcast("bolo:sighting", { bolo, sighting });
  logEngine("warn", `BOLO confirmed ${bolo.id} at ${cam.name} conf=${finalConfidence.toFixed(2)} hits=${current.hits}`);
  persistProof({
    sightingId,
    imageUrl: cam.imageUrl,
    cameraId: cam.id,
    cameraName: cam.name,
    confidence: finalConfidence,
    label: "BOLO MATCH",
    bbox: current.bbox || bbox,
  }).catch((e) => console.warn("[Proof] Proactive save failed:", e));
}

function scoreCam(cam: CameraInfo): number {
  let score = 0;
  const storedCam = store.cameras.get(cam.id);

  if (storedCam?.lastFetched) {
    const ageMin = (Date.now() - new Date(storedCam.lastFetched).getTime()) / 60000;
    score += Math.min(ageMin / 5, 3);
  } else {
    score += 5;
  }

  for (const hyp of store.hypotheses.values()) {
    if (hyp.state === "cleared") continue;
    const dist = haversine(cam.lat, cam.lng, hyp.lat, hyp.lng);
    if (dist < NEAR_INCIDENT_MILES) {
      const severityBoost = hyp.severity === "critical" ? 10 : hyp.severity === "high" ? 7 : hyp.severity === "medium" ? 4 : 2;
      const distBoost = (NEAR_INCIDENT_MILES - dist) / NEAR_INCIDENT_MILES;
      score += severityBoost * distBoost;
    }
  }

  if (storedCam?.lastAnalysis?.hasIncident) {
    score += 4;
  }

  return score;
}

function pickNextCamera(exclude: Set<string>): CameraInfo {
  const allCams = getCameras();
  let best: CameraInfo = allCams[0];
  let bestScore = -1;

  for (const cam of allCams) {
    if (exclude.has(cam.id)) continue;
    const s = scoreCam(cam);
    if (s > bestScore) {
      bestScore = s;
      best = cam;
    }
  }
  return best;
}

async function processCamera(cam: CameraInfo) {
  // BOLO-priority mode: never run generic camera analysis while BOLOs are active.
  if (store.getActiveBolos().length > 0) {
    return;
  }
  try {
    const base64 = await fetchCameraImage(cam);
    if (!base64) return;

    const storedCam = store.cameras.get(cam.id);
    if (storedCam) {
      storedCam.lastFetched = new Date().toISOString();
      store.cameras.set(cam.id, storedCam);
    }

    const activeBolos = store.getActiveBolos();
    console.log("[Camera] " + cam.name + " processing with " + activeBolos.length + " active BOLOs: " + activeBolos.map(b => b.id).join(", "));
    const analysis = await analyzeCamera(base64, cam.name, activeBolos.length > 0 ? activeBolos : undefined);

    if (storedCam) {
      storedCam.lastAnalysis = analysis;
      store.cameras.set(cam.id, storedCam);
    }

    analysis.incidents = (analysis.incidents || []).filter((inc) => {
      const desc = (inc.description || "").toLowerCase();
      return !desc.includes("temporarily unavailable") &&
             !desc.includes("feed unavailable") &&
             !desc.includes("no feed") &&
             !desc.includes("camera offline") &&
             !desc.includes("no image") &&
             !desc.includes("unavailable");
    });
    if (analysis.incidents.length === 0) analysis.hasIncident = false;

    if (analysis.hasIncident && analysis.incidents.length > 0) {
      for (const incident of analysis.incidents) {
        const evidence: Evidence = {
          source: "camera",
          sourceId: cam.id,
          timestamp: analysis.timestamp,
          weight: 0.75,
          rawData: { camera: cam.name, analysis },
          summary: incident.description,
        };
        addEvidence(incident.type, cam.lat, cam.lng, cam.name, incident.description, evidence);
      }
    }

    const rawAnalysis = analysis as CameraInfo["lastAnalysis"] & {
      boloMatches?: Array<{
        boloId?: string;
        confidence?: number;
        details?: string;
        bbox?: [number, number, number, number];
      }>;
    };
    if (!store.features.boloV2 && rawAnalysis.boloMatches && rawAnalysis.boloMatches.length > 0) {
      for (const match of rawAnalysis.boloMatches) {
        if (!match.boloId) continue;
        if (store.bolos.has(match.boloId)) {
          recordBoloSighting(
            match.boloId,
            cam,
            match.details || "Legacy visual match on camera",
            match.confidence || 0.5,
            match.bbox
          );
        }
      }
    }

    updateRoadDensityFromCamera(cam, analysis.trafficDensity);
    console.log("[Camera] " + cam.name + ": density=" + analysis.trafficDensity + " incidents=" + analysis.incidents.length + " boloMatches=" + (rawAnalysis.boloMatches?.length || 0));
  } catch (e) {
    console.error(`[Camera] Error processing ${cam.name}:`, e);
  }
  store.updateFeedStatus();
}

async function startCameraLoop() {
  if (!hasVisionProviderConfigured()) {
    console.log("[Nemo] No vision provider key - camera analysis disabled");
    logEngine("warn", "Camera analysis disabled (missing NVIDIA_API_KEY or GEMINI_API_KEY)");
    return;
  }

  if (globalForEngine.__cameraLoopRunning) return;
  globalForEngine.__cameraLoopRunning = true;
  globalForEngine.__cameraLoopStopped = false;

  const recentlyProcessed = new Set<string>();
  const BATCH_SIZE = 2; // Keep low to conserve API quota for BOLO scans

  const tick = async () => {
    if (globalForEngine.__cameraLoopStopped || !store.features.cameras) {
      globalForEngine.__cameraLoopRunning = false;
      return;
    }

    // BOLO-priority mode: when BOLO scanning is active, suppress generic camera incident loop.
    // This keeps quota focused on the dedicated batch BOLO scanner.
    if (store.getActiveBolos().length > 0) {
      globalForEngine.__intervals.cameraTimeout = setTimeout(tick, BOLO_PRIORITY_CAMERA_SLEEP_MS);
      return;
    }

    const batch: CameraInfo[] = [];
    const tickExclude = new Set(recentlyProcessed);
    for (let i = 0; i < BATCH_SIZE; i++) {
      const cam = pickNextCamera(tickExclude);
      if (batch.some((c) => c.id === cam.id)) break;
      batch.push(cam);
      tickExclude.add(cam.id);
    }

    for (const cam of batch) {
      recentlyProcessed.add(cam.id);
    }

    while (recentlyProcessed.size > 15) {
      const first = recentlyProcessed.values().next().value;
      if (first) recentlyProcessed.delete(first);
      else break;
    }

    await Promise.allSettled(batch.map((cam) => processCamera(cam)));

    if (globalForEngine.__cameraLoopStopped || !store.features.cameras) {
      globalForEngine.__cameraLoopRunning = false;
      return;
    }

    const hasActiveIncidents = Array.from(store.hypotheses.values()).some(
      (h) => h.state !== "cleared" && (h.severity === "critical" || h.severity === "high")
    );
    const nextDelay = hasActiveIncidents ? PRIORITY_INTERVAL : NORMAL_INTERVAL;
    logEngine("info", `Camera loop tick complete; next in ${Math.round(nextDelay / 1000)}s`);
    globalForEngine.__intervals.cameraTimeout = setTimeout(tick, nextDelay);
  };

  globalForEngine.__intervals.cameraTimeout = setTimeout(tick, 3000);
}

function updateRoadDensityFromCamera(cam: CameraInfo, density: string) {
  const allowedDensities: TrafficDensity[] = ["empty", "light", "moderate", "heavy", "gridlock"];
  const normalizedDensity: TrafficDensity = allowedDensities.includes(density as TrafficDensity)
    ? (density as TrafficDensity)
    : "moderate";
  for (const [id, road] of store.roads) {
    for (const point of road.polyline) {
      const dLat = Math.abs(point[1] - cam.lat);
      const dLng = Math.abs(point[0] - cam.lng);
      if (dLat < 0.005 && dLng < 0.005) {
        road.density = normalizedDensity;
        store.roads.set(id, road);
        return;
      }
    }
  }
}

// ── Dedicated batch BOLO scanner ──
// Runs independently: scans camera URLs directly for maximum speed

const globalForBolo = globalThis as unknown as {
  __boloScanRunning?: boolean;
  __boloScanTimer?: ReturnType<typeof setTimeout> | null;
  __boloScanOffset?: number;
};
function getBoloScanRunning() { return globalForBolo.__boloScanRunning ?? false; }
function setBoloScanRunning(v: boolean) { globalForBolo.__boloScanRunning = v; }
function getBoloScanTimer() { return globalForBolo.__boloScanTimer ?? null; }
function setBoloScanTimer(v: ReturnType<typeof setTimeout> | null) { globalForBolo.__boloScanTimer = v; }
function getBoloScanOffset() { return globalForBolo.__boloScanOffset ?? 0; }
function setBoloScanOffset(v: number) { globalForBolo.__boloScanOffset = v; }

const BOLO_BATCH_SIZE = 3;       // Cameras per batch (sequential within batch)
const BOLO_PARALLEL_BATCHES = 1; // Number of simultaneous batches (sequential to respect Groq RPM)
const BOLO_SCAN_INTERVAL = 15000; // 15s between scan cycles
const BOLO_VALIDATION_SAMPLE = 4;
const BOLO_VERIFY_TOP_PER_BOLO = 2;
const BOLO_VERIFY_MAX_PER_CYCLE = 4;
const BOLO_VERIFY_MIN_CONFIDENCE = 0.64;

function getBoloScanConfig() {
  const geminiEnabled = Boolean(process.env.GEMINI_API_KEY);
  if (geminiEnabled) {
    return {
      batchSize: 4,
      parallelBatches: 2,
      scanIntervalMs: 60000,
    };
  }
  return {
    batchSize: BOLO_BATCH_SIZE,
    parallelBatches: BOLO_PARALLEL_BATCHES,
    scanIntervalMs: BOLO_SCAN_INTERVAL,
  };
}

function getBoloVerifyConfig() {
  const geminiEnabled = Boolean(process.env.GEMINI_API_KEY);
  if (geminiEnabled) {
    return {
      topPerBolo: Number.parseInt(process.env.BOLO_VERIFY_TOP_PER_BOLO || "2", 10),
      maxPerCycle: Number.parseInt(process.env.BOLO_VERIFY_MAX_PER_CYCLE || "3", 10),
      minConfidence: Number.parseFloat(process.env.BOLO_VERIFY_MIN_CONFIDENCE || "0.55"),
    };
  }
  return {
    topPerBolo: Number.parseInt(process.env.BOLO_VERIFY_TOP_PER_BOLO || String(BOLO_VERIFY_TOP_PER_BOLO), 10),
    maxPerCycle: Number.parseInt(process.env.BOLO_VERIFY_MAX_PER_CYCLE || String(BOLO_VERIFY_MAX_PER_CYCLE), 10),
    minConfidence: Number.parseFloat(process.env.BOLO_VERIFY_MIN_CONFIDENCE || String(BOLO_VERIFY_MIN_CONFIDENCE)),
  };
}

type BatchedMatchCandidate = {
  cam: CameraInfo;
  match: {
    cameraName: string;
    boloId: string;
    confidence: number;
    details: string;
    bbox?: [number, number, number, number];
    attributes?: BoloSighting["attributes"];
  };
};

function selectVerificationCandidates(
  rawCandidates: BatchedMatchCandidate[],
  config: { topPerBolo: number; maxPerCycle: number }
): BatchedMatchCandidate[] {
  const grouped = new Map<string, BatchedMatchCandidate[]>();

  for (const candidate of rawCandidates) {
    if (!candidate.match.bbox || candidate.match.bbox.length !== 4) continue;
    const list = grouped.get(candidate.match.boloId) || [];
    list.push(candidate);
    grouped.set(candidate.match.boloId, list);
  }

  const selected: BatchedMatchCandidate[] = [];
  const safeTopPerBolo = Math.max(1, config.topPerBolo);
  for (const list of grouped.values()) {
    list.sort((a, b) => (b.match.confidence || 0) - (a.match.confidence || 0));
    selected.push(...list.slice(0, safeTopPerBolo));
  }

  selected.sort((a, b) => (b.match.confidence || 0) - (a.match.confidence || 0));
  const safeMax = Math.max(1, config.maxPerCycle);
  return selected.slice(0, safeMax);
}

async function runLegacyValidationScan(cams: CameraInfo[]) {
  const activeBolos = store.getActiveBolos();
  const hits: Array<{ boloId: string; cameraId: string }> = [];
  for (const cam of cams) {
    try {
      const analysis = await analyzeCamera(cam.imageUrl, cam.name, activeBolos, true);
      const rawAnalysis = analysis as CameraInfo["lastAnalysis"] & {
        boloMatches?: Array<{ boloId?: string }>;
      };
      for (const match of rawAnalysis.boloMatches || []) {
        if (match.boloId) {
          hits.push({ boloId: match.boloId, cameraId: cam.id });
        }
      }
    } catch {
      // best effort validation path only
    }
  }
  return hits;
}

async function runBoloScanBatch() {
  const activeBolos = store.getActiveBolos();
  if (activeBolos.length === 0 || !store.features.cameras) return;

  // Use only working cameras (excludes "temporarily unavailable")
  const allCams = getWorkingCameras().filter(c => c.imageUrl);
  if (allCams.length === 0) {
    console.log("[BOLO Scan] No working cameras available");
    logEngine("warn", "BOLO scan skipped (no working cameras)");
    return;
  }
  
  const scanConfig = getBoloScanConfig();
  const totalCamsPerCycle = Math.min(scanConfig.batchSize * scanConfig.parallelBatches, allCams.length);
  
  // Get camera batches
  const batches: CameraInfo[][] = [];
  for (let b = 0; b < scanConfig.parallelBatches; b++) {
    const startIdx = (getBoloScanOffset() + b * scanConfig.batchSize) % allCams.length;
    const batch: CameraInfo[] = [];
    for (let i = 0; i < scanConfig.batchSize && batch.length < allCams.length; i++) {
      batch.push(allCams[(startIdx + i) % allCams.length]);
    }
    batches.push(batch);
  }
  setBoloScanOffset((getBoloScanOffset() + totalCamsPerCycle) % allCams.length);

  console.log(
    `[BOLO Scan] ${store.features.boloV2 ? "V2" : "V1"} scanning ${totalCamsPerCycle} cameras for ${activeBolos.length} BOLO(s)`
  );
  logEngine(
    "info",
    `BOLO ${store.features.boloV2 ? "V2" : "V1"} cycle start: ${totalCamsPerCycle} cams, ${activeBolos.length} bolos`
  );

  if (!store.features.boloV2) {
    for (const batch of batches) {
      for (const cam of batch) {
        try {
          const analysis = await analyzeCamera(cam.imageUrl, cam.name, activeBolos, true);
          const rawAnalysis = analysis as CameraInfo["lastAnalysis"] & {
            boloMatches?: Array<{
              boloId?: string;
              confidence?: number;
              details?: string;
              bbox?: [number, number, number, number];
            }>;
          };
          for (const match of rawAnalysis.boloMatches || []) {
            if (!match.boloId) continue;
            recordBoloSighting(
              match.boloId,
              cam,
              match.details || "Legacy visual match on camera",
              match.confidence || 0.5,
              match.bbox
            );
          }
        } catch (error) {
          console.warn("[BOLO Scan] V1 camera scan failed:", error);
        }
      }
    }
    return;
  }

  const batchPromises = batches.map(async (cams, bIdx) => {
    const camerasWithUrls = cams.map(cam => ({
      name: cam.name,
      imageUrl: cam.imageUrl,
      cam,
    }));

    console.log(`[BOLO Scan] batch ${bIdx} starting with ${cams.length} cameras: ${cams.map(c => c.name).join(", ")}`);
    const t0 = Date.now();
    try {
      const result = await batchBoloScan(
        camerasWithUrls.map(c => ({ name: c.name, imageUrl: c.imageUrl })),
        activeBolos
      );
      console.log(`[BOLO Scan] batch ${bIdx} done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matches=${result.matches.length}`);
      return result.matches.map(match => ({ match, cams: camerasWithUrls }));
    } catch (err) {
      console.error(`[BOLO Scan] batch ${bIdx} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, err);
      throw err;
    }
  });

  const allResults = await Promise.allSettled(batchPromises);
  const rawCandidates: BatchedMatchCandidate[] = [];

  for (const batchResult of allResults) {
    if (batchResult.status !== "fulfilled") continue;
    
    for (const { match, cams } of batchResult.value) {
      const camData = cams.find(c => c.name === match.cameraName);
      if (!camData) continue;
      rawCandidates.push({
        cam: camData.cam,
        match: {
          cameraName: match.cameraName,
          boloId: match.boloId,
          confidence: match.confidence || 0.5,
          details: match.details || "Visual match on camera",
          bbox: match.bbox,
          attributes: match.attributes,
        },
      });
    }
  }

  const verifyConfig = getBoloVerifyConfig();
  const candidatesToVerify = selectVerificationCandidates(rawCandidates, {
    topPerBolo: verifyConfig.topPerBolo,
    maxPerCycle: verifyConfig.maxPerCycle,
  });
  logEngine(
    "info",
    `BOLO candidates: raw=${rawCandidates.length}, selected=${candidatesToVerify.length}, min=${verifyConfig.minConfidence.toFixed(2)}`
  );

  const acceptedMatches: BatchedMatchCandidate[] = [];
  for (const candidate of candidatesToVerify) {
    const bolo = store.bolos.get(candidate.match.boloId);
    if (!bolo || bolo.status === "cleared") continue;

    // High-confidence batch matches skip the extra verification API call
    // since the batch prompt is already a targeted BOLO-matching question
    if (candidate.match.confidence >= 0.65) {
      logEngine("info", `BOLO high-conf batch match ${bolo.id} at ${candidate.cam.name} conf=${candidate.match.confidence.toFixed(2)} (skipping verify)`);
      acceptedMatches.push(candidate);
      continue;
    }

    if (!candidate.match.bbox) continue;
    try {
      const verification = await verifyBoloCandidate(
        candidate.cam.imageUrl,
        candidate.cam.name,
        bolo,
        {
          bbox: candidate.match.bbox,
          confidence: candidate.match.confidence,
          details: candidate.match.details,
          attributes: candidate.match.attributes || { source: "llm", confidenceByAttribute: {} },
        },
        true
      );
      if (!verification.matched || verification.confidence < verifyConfig.minConfidence) {
        continue;
      }
      acceptedMatches.push({
        cam: candidate.cam,
        match: {
          ...candidate.match,
          confidence: Math.max(candidate.match.confidence, verification.confidence),
          details: `${candidate.match.details}; ${verification.details}`.slice(0, 220),
        },
      });
    } catch (error) {
      console.warn("[BOLO Scan] verification failed, accepting batch match:", candidate.match.confidence >= 0.5 ? "accepted" : "rejected");
      if (candidate.match.confidence >= 0.5) {
        acceptedMatches.push(candidate);
      }
    }
  }

  const v2Hits: Array<{ boloId: string; cameraId: string }> = [];
  for (const accepted of acceptedMatches) {
    v2Hits.push({ boloId: accepted.match.boloId, cameraId: accepted.cam.id });
    recordBoloSighting(
      accepted.match.boloId,
      accepted.cam,
      accepted.match.details,
      accepted.match.confidence,
      accepted.match.bbox,
      accepted.match.attributes,
      true
    );
  }

  logEngine("info", `BOLO cycle complete; matches=${v2Hits.length}`);
}

export function startBoloScanLoop() {
  if (getBoloScanRunning()) return;
  if (!hasVisionProviderConfigured()) return;
  setBoloScanRunning(true);
  setBoloScanOffset(0);

  const scanConfig = getBoloScanConfig();
  const totalCamsPerCycle = scanConfig.batchSize * scanConfig.parallelBatches;
  console.log(`[BOLO Scan] Starting scan loop (${getCameras().length} cameras, ${totalCamsPerCycle} per cycle, ${scanConfig.scanIntervalMs/1000}s interval)`);
  logEngine("info", `BOLO scan loop started (${scanConfig.scanIntervalMs / 1000}s interval, ${scanConfig.parallelBatches}x${scanConfig.batchSize})`);

  const tick = async () => {
    if (!getBoloScanRunning() || !store.features.cameras) return;

    try {
      await runBoloScanBatch();
    } catch (e) {
      console.error("[BOLO Scan] Error:", e);
      logEngine("error", "BOLO scan cycle error");
    }

    if (getBoloScanRunning() && store.features.cameras) {
      const hasBolos = store.getActiveBolos().length > 0;
      const nextDelay = hasBolos ? getBoloScanConfig().scanIntervalMs : 60000;
      setBoloScanTimer(setTimeout(tick, nextDelay));
    }
  };

  setBoloScanTimer(setTimeout(tick, 2000));
}

export function getBoloValidationHistory(): PipelineStats[] {
  return validationHistory.slice();
}

export function stopBoloScanLoop() {
  setBoloScanRunning(false);
  const timer = getBoloScanTimer();
  if (timer) {
    clearTimeout(timer);
    setBoloScanTimer(null);
  }
}
