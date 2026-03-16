import { RoadSegment, TrafficDensity } from "./types";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

interface OverpassElement {
  type: "way" | "node";
  id: number;
  nodes?: number[];
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
}

const SPEED_BY_CLASS: Record<string, number> = {
  motorway: 55,
  trunk: 45,
  primary: 30,
  secondary: 25,
  tertiary: 25,
  residential: 20,
  unclassified: 20,
  living_street: 15,
  service: 10,
};

const CARS_BY_CLASS: Record<string, number> = {
  motorway: 20,
  trunk: 16,
  primary: 12,
  secondary: 8,
  tertiary: 6,
  residential: 4,
  unclassified: 3,
  living_street: 2,
  service: 2,
};

const DENSITY_BY_CLASS: Record<string, TrafficDensity> = {
  motorway: "heavy",
  trunk: "moderate",
  primary: "moderate",
  secondary: "light",
  tertiary: "light",
  residential: "light",
};

function parseMaxSpeed(tag: string | undefined): number | null {
  if (!tag) return null;
  const match = tag.match(/^(\d+)/);
  if (match) return parseInt(match[1], 10);
  return null;
}

// Cache keyed by bbox string
let cachedKey: string | null = null;
let cachedRoads: RoadSegment[] | null = null;

export interface BBoxParam {
  south: number;
  west: number;
  north: number;
  east: number;
}

export async function fetchRoadsForBBox(bbox: BBoxParam): Promise<RoadSegment[]> {
  const key = `${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`;
  if (cachedKey === key && cachedRoads) return cachedRoads;

  // Include all driveable streets for dense coverage
  const query = `[out:json][timeout:25];(
    way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  );out body;>;out skel qt;`;

  console.log(`[Overpass] Fetching roads for bbox ${key}...`);
  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!res.ok) {
      console.error("[Overpass] HTTP error:", res.status);
      return cachedRoads || [];
    }

    const data = await res.json();
    const elements: OverpassElement[] = data.elements;

    // Build node lookup
    const nodes = new Map<number, [number, number]>();
    for (const el of elements) {
      if (el.type === "node" && el.lat !== undefined && el.lon !== undefined) {
        nodes.set(el.id, [el.lon, el.lat]);
      }
    }

    const roads: RoadSegment[] = [];
    const ways = elements.filter((el) => el.type === "way" && el.nodes && el.tags);

    for (const way of ways) {
      const polyline: [number, number][] = [];
      for (const nodeId of way.nodes!) {
        const coord = nodes.get(nodeId);
        if (coord) polyline.push(coord);
      }

      if (polyline.length < 2) continue;

      const highway = way.tags!.highway || "tertiary";
      const name = way.tags!.name || way.tags!.ref || `road-${way.id}`;
      const maxSpeed = parseMaxSpeed(way.tags!.maxspeed);
      const freeFlowSpeed = maxSpeed || SPEED_BY_CLASS[highway] || 25;

      // Add realistic variation to current speed (65-100% of free flow)
      const variation = 0.65 + Math.random() * 0.35;
      const currentSpeed = Math.round(freeFlowSpeed * variation);

      const baseCars = CARS_BY_CLASS[highway] || 4;
      // Scale car count by road length
      const lengthFactor = Math.min(3, polyline.length / 4);
      const carCount = Math.max(3, Math.round(baseCars * lengthFactor));

      roads.push({
        id: `osm-${way.id}`,
        name,
        polyline,
        freeFlowSpeed,
        currentSpeed,
        density: DENSITY_BY_CLASS[highway] || "moderate",
        carCount,
      });
    }

    // Cap at 400 roads to keep client fast
    const capped = roads.length > 400 ? roads.slice(0, 400) : roads;
    console.log(`[Overpass] Loaded ${roads.length} roads, serving ${capped.length} (${nodes.size} nodes)`);
    cachedKey = key;
    cachedRoads = capped;
    return capped;
  } catch (e) {
    console.error("[Overpass] Fetch failed:", e);
    return cachedRoads || [];
  }
}
