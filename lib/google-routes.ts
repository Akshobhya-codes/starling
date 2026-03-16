import { RoadSegment } from "./types";

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

interface LatLng {
  latitude: number;
  longitude: number;
}

interface RouteProbe {
  origin: LatLng;
  destination: LatLng;
  roadIndices: number[];
}

// Sample a grid of short probes across the bbox to get real traffic conditions
function buildProbes(roads: RoadSegment[], maxProbes: number): RouteProbe[] {
  const probes: RouteProbe[] = [];
  const step = Math.max(1, Math.floor(roads.length / maxProbes));

  for (let i = 0; i < roads.length && probes.length < maxProbes; i += step) {
    const road = roads[i];
    const pts = road.polyline;
    if (pts.length < 2) continue;

    // Use first and last point of road as origin/destination
    const origin: LatLng = { latitude: pts[0][1], longitude: pts[0][0] };
    const dest: LatLng = {
      latitude: pts[pts.length - 1][1],
      longitude: pts[pts.length - 1][0],
    };

    // Skip very short segments (origin ≈ destination)
    const dlat = Math.abs(origin.latitude - dest.latitude);
    const dlng = Math.abs(origin.longitude - dest.longitude);
    if (dlat < 0.0003 && dlng < 0.0003) continue;

    // Collect nearby road indices that this probe represents
    const nearby: number[] = [i];
    for (let j = Math.max(0, i - step + 1); j < Math.min(roads.length, i + step); j++) {
      if (j !== i) nearby.push(j);
    }

    probes.push({ origin, destination: dest, roadIndices: nearby });
  }

  return probes;
}

interface ProbeResult {
  congestionRatio: number; // 1.0 = free flow, >1 = congested
  realSpeedMph: number | null;
  roadIndices: number[];
}

async function fetchProbe(
  probe: RouteProbe,
  apiKey: string
): Promise<ProbeResult | null> {
  try {
    const body = {
      origin: { location: { latLng: probe.origin } },
      destination: { location: { latLng: probe.destination } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: false,
    };

    const res = await fetch(ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[GoogleRoutes] Probe failed (HTTP ${res.status})`);
      return null;
    }

    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) return null;

    // duration includes traffic, staticDuration is free-flow
    const duration = parseDuration(route.duration);
    const staticDuration = parseDuration(route.staticDuration);
    const distanceMeters = route.distanceMeters || 0;

    if (!duration || !staticDuration || staticDuration === 0) return null;

    const congestionRatio = duration / staticDuration;
    // Real speed in mph from traffic-aware duration
    const realSpeedMph =
      distanceMeters > 0 ? (distanceMeters / duration) * 2.237 : null;

    return {
      congestionRatio,
      realSpeedMph,
      roadIndices: probe.roadIndices,
    };
  } catch (e) {
    console.error("[GoogleRoutes] Probe failed:", e);
    return null;
  }
}

// Parse "123s" or "123.456s" duration string
function parseDuration(d: string | undefined): number | null {
  if (!d) return null;
  const match = d.match(/^([\d.]+)s$/);
  return match ? parseFloat(match[1]) : null;
}

// Cache to avoid hammering Google Routes API
let cachedBboxKey: string | null = null;
let cachedResult: RoadSegment[] | null = null;
let cachedAt = 0;
const CACHE_TTL = 60_000; // 60 seconds

export async function enrichRoadsWithTraffic(
  roads: RoadSegment[],
  bboxKey: string
): Promise<RoadSegment[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn("[GoogleRoutes] No API key, returning roads with simulated speeds");
    return roads;
  }

  // Check cache
  const now = Date.now();
  if (cachedBboxKey === bboxKey && cachedResult && now - cachedAt < CACHE_TTL) {
    return cachedResult;
  }

  // Sample up to 10 probes across the road network (to stay within rate limits)
  const probes = buildProbes(roads, 10);
  if (probes.length === 0) return roads;

  console.log(`[GoogleRoutes] Sending ${probes.length} traffic probes...`);

  // Run probes in parallel (batches of 5 to avoid rate limits)
  const results: (ProbeResult | null)[] = [];
  for (let i = 0; i < probes.length; i += 5) {
    const batch = probes.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map((p) => fetchProbe(p, apiKey))
    );
    results.push(...batchResults);
  }

  const validResults = results.filter((r): r is ProbeResult => r !== null);
  console.log(`[GoogleRoutes] Got ${validResults.length}/${probes.length} valid results`);

  if (validResults.length === 0) return roads;

  // Build congestion map: roadIndex -> congestionRatio
  const congestionMap = new Map<number, { ratio: number; speed: number | null }>();
  for (const r of validResults) {
    for (const idx of r.roadIndices) {
      congestionMap.set(idx, { ratio: r.congestionRatio, speed: r.realSpeedMph });
    }
  }

  // Average congestion for roads without a direct probe
  const avgRatio =
    validResults.reduce((sum, r) => sum + r.congestionRatio, 0) /
    validResults.length;

  // Apply real traffic data to roads
  const enriched = roads.map((road, i) => {
    const probe = congestionMap.get(i);
    const ratio = probe?.ratio ?? avgRatio;

    // currentSpeed = freeFlowSpeed / congestionRatio (clamped)
    const currentSpeed = Math.max(
      3,
      Math.round(road.freeFlowSpeed / ratio)
    );

    // Density based on congestion ratio
    const density =
      ratio < 1.15 ? "light" as const :
      ratio < 1.5 ? "moderate" as const :
      ratio < 2.0 ? "heavy" as const :
      "gridlock" as const;

    return { ...road, currentSpeed, density };
  });

  // Cache
  cachedBboxKey = bboxKey;
  cachedResult = enriched;
  cachedAt = now;

  return enriched;
}
