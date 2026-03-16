import { addEvidence } from "./hypothesis";
import { store } from "./store";
import { Evidence, IncidentType } from "./types";

function mapEventType(type: string): IncidentType {
  const lower = (type || "").toLowerCase();
  if (lower.includes("accident") || lower.includes("collision")) return "accident";
  if (lower.includes("congestion") || lower.includes("slow")) return "congestion";
  if (lower.includes("construction") || lower.includes("work")) return "construction";
  if (lower.includes("fire")) return "fire";
  if (lower.includes("hazard") || lower.includes("debris")) return "hazard";
  if (lower.includes("closure") || lower.includes("closed")) return "road_closure";
  if (lower.includes("weather") || lower.includes("fog")) return "weather";
  return "other";
}

export async function poll511() {
  const apiKey = process.env.FIVE11_API_KEY;
  if (!apiKey) {
    console.log("[511] No FIVE11_API_KEY set — skipping");
    store.feedStatus.fiveEleven = "error";
    return;
  }

  try {
    const url = `https://api.511.org/traffic/events?api_key=${apiKey}&agency=MTC&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!res.ok) {
      console.log(`[511] HTTP ${res.status} — ${res.status === 429 ? "rate limited" : "error"}`);
      store.feedStatus.fiveEleven = res.status === 429 ? "throttled" : "error";
      return;
    }

    // 511 returns JSON with BOM sometimes
    let text = await res.text();
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const data = JSON.parse(text);

    const events = data.events || [];
    let count = 0;

    for (const event of events) {
      const geo = event.geography;
      if (!geo?.coordinates) continue;

      let lat: number, lng: number;
      const coords = geo.coordinates;
      if (Array.isArray(coords[0])) {
        // LineString or nested
        lng = coords[0][0];
        lat = coords[0][1];
      } else {
        lng = coords[0];
        lat = coords[1];
      }

      // Filter to SF area
      if (lat < 37.7 || lat > 37.82 || lng < -122.52 || lng > -122.35) continue;

      const type = mapEventType(event.event_type || event.headline || "");
      const description = event.headline || event.description || "511 Traffic Event";
      const locationLabel = event.geography_description || event.roads?.[0]?.name || "San Francisco";

      const evidence: Evidence = {
        source: "511",
        sourceId: `511_${event.id || Date.now()}`,
        timestamp: new Date().toISOString(),
        weight: 0.9,
        rawData: { headline: event.headline, type: event.event_type },
        summary: description,
      };

      addEvidence(type, lat, lng, locationLabel, description, evidence);
      count++;
      if (count >= 30) break;
    }

    console.log(`[511] Ingested ${count} events from ${events.length} total`);
    store.feedStatus.fiveEleven = "ok";
  } catch (e) {
    console.error("[511] Poll error:", e);
    store.feedStatus.fiveEleven = "error";
  }
}

export async function pollDataSF() {
  const token = process.env.DATASF_APP_TOKEN;
  const baseUrl = "https://data.sfgov.org/resource/gnap-fj3t.json";
  const params = new URLSearchParams({
    $limit: "200",
    $order: "received_datetime DESC",
    ...(token ? { $$app_token: token } : {}),
  });

  try {
    const res = await fetch(`${baseUrl}?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return;

    const data = await res.json();

    for (const call of data) {
      if (!call.intersection_point) continue;

      const coords = call.intersection_point.coordinates;
      if (!coords) continue;

      const lng = coords[0];
      const lat = coords[1];
      if (lat < 37.7 || lat > 37.82 || lng < -122.52 || lng > -122.35) continue;

      const type = mapEventType(call.call_type_final_desc || call.call_type_original_desc || "");
      const description = call.call_type_final_desc || call.call_type_original_desc || "Dispatch Call";
      const locationLabel = call.intersection_name || "San Francisco";

      const evidence: Evidence = {
        source: "dispatch",
        sourceId: `dsf_${call.cad_number || Date.now()}`,
        timestamp: call.received_datetime || new Date().toISOString(),
        weight: 0.85,
        rawData: { callType: call.call_type_final_desc, priority: call.priority_final },
        summary: description,
      };

      addEvidence(type, lat, lng, locationLabel, description, evidence);
    }
    console.log(`[DataSF] Ingested dispatch calls`);
  } catch (e) {
    console.error("[DataSF] Poll error:", e);
  }
}
