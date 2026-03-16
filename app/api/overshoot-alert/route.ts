import { NextResponse } from "next/server";
import { addEvidence } from "@/lib/hypothesis";
import { startEngine } from "@/lib/engine";
import { store } from "@/lib/store";
import { Evidence, IncidentType } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_INCIDENT_TYPES: IncidentType[] = [
  "accident",
  "congestion",
  "construction",
  "fire",
  "medical",
  "hazard",
  "police",
  "road_closure",
  "weather",
  "other",
];

/** Map Overshoot incident type strings to our IncidentType union. */
function mapIncidentType(raw: string): IncidentType {
  const normalized = raw.toLowerCase().trim();

  // Direct matches
  if ((VALID_INCIDENT_TYPES as string[]).includes(normalized)) {
    return normalized as IncidentType;
  }

  // Common synonyms / close mappings
  const ALIASES: Record<string, IncidentType> = {
    crash: "accident",
    collision: "accident",
    wreck: "accident",
    traffic: "congestion",
    jam: "congestion",
    gridlock: "congestion",
    backup: "congestion",
    slowdown: "congestion",
    road_work: "construction",
    roadwork: "construction",
    closure: "road_closure",
    closed: "road_closure",
    blocked: "road_closure",
    emergency: "medical",
    ambulance: "medical",
    ems: "medical",
    fire_truck: "fire",
    blaze: "fire",
    smoke: "fire",
    cop: "police",
    patrol: "police",
    law_enforcement: "police",
    debris: "hazard",
    spill: "hazard",
    obstruction: "hazard",
    fog: "weather",
    rain: "weather",
    storm: "weather",
    flooding: "weather",
  };

  if (ALIASES[normalized]) {
    return ALIASES[normalized];
  }

  return "other";
}

/** Map Overshoot severity strings to evidence weight. */
function severityToWeight(severity: string): number {
  switch (severity?.toLowerCase()) {
    case "critical":
      return 0.95;
    case "high":
      return 0.85;
    case "medium":
      return 0.75;
    case "low":
      return 0.6;
    default:
      return 0.7;
  }
}

/**
 * POST /api/overshoot-alert
 *
 * Accepts Overshoot real-time vision incident data from the client and
 * feeds it into the hypothesis pipeline via addEvidence().
 *
 * Body: {
 *   cameraId: string,
 *   cameraName: string,
 *   lat: number,
 *   lng: number,
 *   incidents: Array<{ type: string, description: string, severity: string }>,
 *   trafficDensity?: string
 * }
 */
export async function POST(request: Request) {
  // Ensure the engine is running so hypotheses get decay cycles, SSE, etc.
  startEngine();

  try {
    const body = await request.json();
    const { cameraId, cameraName, lat, lng, incidents, trafficDensity } = body;

    if (!cameraId || lat == null || lng == null) {
      return NextResponse.json(
        { error: "Missing required fields: cameraId, lat, lng" },
        { status: 400 }
      );
    }

    if (!Array.isArray(incidents) || incidents.length === 0) {
      return NextResponse.json(
        { error: "No incidents provided" },
        { status: 400 }
      );
    }

    // Update camera store entry if it exists
    const cam = store.cameras.get(cameraId);
    if (cam) {
      cam.lastAnalysis = {
        hasIncident: true,
        incidents: incidents.map((inc: any) => ({
          type: mapIncidentType(inc.type),
          description: inc.description || "",
          severity: inc.severity || "medium",
        })),
        trafficDensity: trafficDensity || "moderate",
        timestamp: new Date().toISOString(),
      };
      cam.lastFetched = new Date().toISOString();
      store.cameras.set(cameraId, cam);
    }

    // Update road density near this camera
    if (trafficDensity) {
      for (const [, road] of store.roads) {
        for (const point of road.polyline) {
          const dLat = Math.abs(point[1] - lat);
          const dLng = Math.abs(point[0] - lng);
          if (dLat < 0.005 && dLng < 0.005) {
            road.density = trafficDensity;
            break;
          }
        }
      }
    }

    // Create hypotheses from each incident
    const hypothesisIds: string[] = [];

    for (const inc of incidents) {
      const incidentType = mapIncidentType(inc.type || "other");
      const weight = severityToWeight(inc.severity);

      const evidence: Evidence = {
        source: "camera",
        sourceId: `overshoot-${cameraId}`,
        timestamp: new Date().toISOString(),
        weight,
        rawData: {
          camera: cameraName,
          source: "overshoot-realtime",
          trafficDensity,
          incident: inc,
        },
        summary: `[Overshoot RT] ${inc.description || inc.type}`,
      };

      const hyp = addEvidence(
        incidentType,
        lat,
        lng,
        cameraName || cameraId,
        inc.description || `${incidentType} detected via Overshoot`,
        evidence
      );

      hypothesisIds.push(hyp.id);
    }

    store.updateFeedStatus();

    return NextResponse.json({
      ok: true,
      cameraId,
      incidentsProcessed: incidents.length,
      hypothesisIds,
    });
  } catch (e: any) {
    console.error("[Overshoot Alert] Error:", e);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
