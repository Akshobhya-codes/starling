import { FlightTrack } from "./types";

export async function fetchFlightsForBBox(
  bbox: { south: number; west: number; north: number; east: number }
): Promise<FlightTrack[]> {
  const params = new URLSearchParams({
    lamin: bbox.south.toFixed(4),
    lomin: bbox.west.toFixed(4),
    lamax: bbox.north.toFixed(4),
    lomax: bbox.east.toFixed(4),
  });

  const url = `https://opensky-network.org/api/states/all?${params.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) return [];

  const data = await res.json();
  const states: unknown[] = Array.isArray(data?.states) ? data.states : [];
  const now = new Date().toISOString();
  const flights: FlightTrack[] = [];

  for (const s of states) {
    if (!Array.isArray(s)) continue;
    const id = String(s[0] || "");
    const callsign = String(s[1] || "").trim();
    const lng = Number(s[5]);
    const lat = Number(s[6]);
    const onGround = Boolean(s[8]);
    const velocityMps = Number(s[9]);
    const heading = Number(s[10]);
    const altitudeM = Number(s[7]);

    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng) || onGround) continue;

    flights.push({
      id,
      callsign: callsign || id.toUpperCase(),
      lat,
      lng,
      heading: Number.isFinite(heading) ? heading : 0,
      speedKts: Number.isFinite(velocityMps) ? Math.max(0, velocityMps * 1.94384) : 0,
      altitudeM: Number.isFinite(altitudeM) ? altitudeM : 1200,
      updatedAt: now,
      source: "opensky",
    });
  }

  return flights.slice(0, 250);
}
