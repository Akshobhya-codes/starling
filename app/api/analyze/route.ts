import { NextResponse } from "next/server";
import { addEvidence } from "@/lib/hypothesis";
import { store } from "@/lib/store";
import { Evidence, IncidentType } from "@/lib/types";

export const dynamic = "force-dynamic";

// Receives real-time Overshoot vision analysis results from the client
// and feeds them into the hypothesis + traffic systems
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      cameraId,
      cameraName,
      lat,
      lng,
      trafficDensity,
      incidents,
      weather,
      vehicleCount,
    } = body;

    if (!cameraId || !lat || !lng) {
      return NextResponse.json({ error: "Missing cameraId, lat, lng" }, { status: 400 });
    }

    // Update camera's analysis in the store
    const cam = store.cameras.get(cameraId);
    if (cam) {
      cam.lastAnalysis = {
        hasIncident: incidents?.length > 0,
        incidents: incidents || [],
        trafficDensity: trafficDensity || "moderate",
        weather,
        timestamp: new Date().toISOString(),
      };
      cam.lastFetched = new Date().toISOString();
      store.cameras.set(cameraId, cam);
    }

    // Update road density near this camera
    if (trafficDensity) {
      for (const [id, road] of store.roads) {
        for (const point of road.polyline) {
          const dLat = Math.abs(point[1] - lat);
          const dLng = Math.abs(point[0] - lng);
          if (dLat < 0.005 && dLng < 0.005) {
            road.density = trafficDensity;
            store.roads.set(id, road);
            break;
          }
        }
      }
    }

    // Feed incidents into the hypothesis engine
    const created: string[] = [];
    if (incidents && incidents.length > 0) {
      for (const inc of incidents) {
        const validTypes: IncidentType[] = [
          "accident", "congestion", "construction", "fire",
          "medical", "hazard", "police", "road_closure", "other",
        ];
        const type: IncidentType = validTypes.includes(inc.type) ? inc.type : "other";

        const evidence: Evidence = {
          source: "camera",
          sourceId: `overshoot-${cameraId}`,
          timestamp: new Date().toISOString(),
          weight: 0.8, // slightly higher weight for real-time video analysis
          rawData: {
            camera: cameraName,
            source: "overshoot",
            trafficDensity,
            weather,
            vehicleCount,
            incident: inc,
          },
          summary: `[Overshoot] ${inc.description}`,
        };

        const hyp = addEvidence(type, lat, lng, cameraName, inc.description, evidence);
        created.push(hyp.id);
      }
    }

    store.updateFeedStatus();

    return NextResponse.json({
      ok: true,
      cameraId,
      trafficDensity,
      vehicleCount,
      incidentsProcessed: incidents?.length || 0,
      hypothesesUpdated: created,
    });
  } catch (e) {
    console.error("[Analyze] Error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
