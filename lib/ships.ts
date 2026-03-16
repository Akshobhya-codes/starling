import { VesselTrack } from "./types";

function numberOr(value: string | null | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractXmlTagValue(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}[^>]*>([^<]+)</(?:\\w+:)?${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

function parse511Xml(xml: string): VesselTrack[] {
  // 511 transit feed can come as SIRI XML; we opportunistically parse only fields we need.
  const blocks = xml.split(/<VehicleActivity>|<MonitoredVehicleJourney>/i).slice(1);
  const vessels: VesselTrack[] = [];
  const now = new Date().toISOString();

  for (const block of blocks) {
    const lat = numberOr(extractXmlTagValue(block, "Latitude")[0], NaN);
    const lng = numberOr(extractXmlTagValue(block, "Longitude")[0], NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const lineRef = extractXmlTagValue(block, "LineRef")[0] || "";
    const operatorRef = extractXmlTagValue(block, "OperatorRef")[0] || "";
    const publishedLineName = extractXmlTagValue(block, "PublishedLineName")[0] || "";
    const id =
      extractXmlTagValue(block, "VehicleRef")[0] ||
      extractXmlTagValue(block, "DatedVehicleJourneyRef")[0] ||
      `${lat.toFixed(5)}_${lng.toFixed(5)}_${lineRef || operatorRef}`;
    const speedMps = numberOr(extractXmlTagValue(block, "Speed")[0], 0);
    const heading = numberOr(extractXmlTagValue(block, "Bearing")[0], 0);

    const name = [publishedLineName, lineRef, operatorRef].filter(Boolean).join(" ").trim() || "Vessel";
    // Keep likely marine records (ferry operators/lines) and reject generic bus lines.
    const marineHint = `${lineRef} ${operatorRef} ${publishedLineName}`.toLowerCase();
    if (!marineHint.includes("ferry") && !marineHint.includes("boat") && !marineHint.includes("water")) {
      continue;
    }

    vessels.push({
      id,
      name,
      lat,
      lng,
      heading,
      speedKts: Math.max(0, speedMps * 1.94384),
      updatedAt: now,
      source: "511_transit",
    });
  }

  return vessels.slice(0, 200);
}

function parseSwiftlyJson(json: unknown): VesselTrack[] {
  const root = json as { entity?: unknown[] } | unknown[];
  const entities = Array.isArray((root as { entity?: unknown[] })?.entity)
    ? ((root as { entity?: unknown[] }).entity as unknown[])
    : Array.isArray(root)
      ? root
      : [];
  const now = new Date().toISOString();
  const out: VesselTrack[] = [];

  for (const item of entities) {
    const rec = item as Record<string, unknown>;
    const v = ((rec.vehicle as Record<string, unknown> | undefined) ?? rec) as Record<string, unknown>;
    const p = ((v.position as Record<string, unknown> | undefined) ?? v) as Record<string, unknown>;
    const lat = Number(p.latitude);
    const lng = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const trip = (v.trip as Record<string, unknown> | undefined) || {};
    const vehicleObj = (v.vehicle as Record<string, unknown> | undefined) || {};

    out.push({
      id: String(vehicleObj.id || v.id || rec.id || `${lat}_${lng}`),
      name: String(trip.route_id || trip.trip_id || "Ferry"),
      lat,
      lng,
      heading: numberOr(String(p.bearing), 0),
      speedKts: Math.max(0, numberOr(String(p.speed), 0) * 1.94384),
      updatedAt: now,
      source: "swiftly",
    });
  }
  return out.slice(0, 200);
}

export async function fetchShipsForBBox(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<{ vessels: VesselTrack[]; source: string }> {
  const customUrl = process.env.SFBAY_FERRY_VEHICLE_POSITIONS_URL;
  const customToken = process.env.SFBAY_FERRY_API_KEY;

  if (customUrl) {
    const headers: HeadersInit = {};
    if (customToken) headers.Authorization = customToken.startsWith("Bearer ") ? customToken : `Bearer ${customToken}`;
    const res = await fetch(customUrl, { headers, signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const json = await res.json();
        return { vessels: parseSwiftlyJson(json), source: "swiftly_custom" };
      }
      const xml = await res.text();
      return { vessels: parse511Xml(xml), source: "swiftly_xml" };
    }
  }

  const key = process.env.FIVE11_API_KEY;
  if (!key) return { vessels: [], source: "none" };
  const url = `https://api.511.org/transit/VehicleMonitoring?api_key=${encodeURIComponent(key)}&agency=RG`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) return { vessels: [], source: "511_error" };
  const xml = await res.text();
  const vessels = parse511Xml(xml).filter(
    (v) => v.lat >= bbox.south && v.lat <= bbox.north && v.lng >= bbox.west && v.lng <= bbox.east
  );
  return { vessels, source: "511_transit" };
}
