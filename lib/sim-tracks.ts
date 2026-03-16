import { FlightTrack, VesselTrack } from "./types";

interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

function span(v: number, min: number) {
  return Math.max(v, min);
}

export function generateSimulatedVessels(bbox: BBox, count = 28): VesselTrack[] {
  const h = span(bbox.north - bbox.south, 0.01);
  const w = span(bbox.east - bbox.west, 0.01);
  const t = Date.now() / 1000;
  const now = new Date().toISOString();
  const out: VesselTrack[] = [];

  for (let i = 0; i < count; i++) {
    const speedKts = 8 + (i % 7) * 1.8;
    const heading = (i * 41 + t * 2.5) % 360;
    const drift = ((t * speedKts) / 7000 + i * 0.071) % 1;
    const lat = bbox.south + (((i * 0.137 + drift * 0.89) % 1 + 1) % 1) * h;
    const lng = bbox.west + (((i * 0.211 + drift * 0.63) % 1 + 1) % 1) * w;

    out.push({
      id: `sim-ship-${i + 1}`,
      name: `SIM VSL ${String(i + 1).padStart(2, "0")}`,
      lat,
      lng,
      heading,
      speedKts,
      updatedAt: now,
      source: "swiftly",
    });
  }

  return out;
}

export function generateSimulatedFlights(bbox: BBox, count = 24): FlightTrack[] {
  const h = span(bbox.north - bbox.south, 0.01);
  const w = span(bbox.east - bbox.west, 0.01);
  const t = Date.now() / 1000;
  const now = new Date().toISOString();
  const out: FlightTrack[] = [];

  for (let i = 0; i < count; i++) {
    const speedKts = 180 + (i % 9) * 22;
    const heading = (i * 29 + t * 6.5) % 360;
    const drift = ((t * speedKts) / 18000 + i * 0.043) % 1;
    const lat = bbox.south + (((i * 0.083 + drift * 0.77) % 1 + 1) % 1) * h;
    const lng = bbox.west + (((i * 0.191 + drift * 0.52) % 1 + 1) % 1) * w;
    const altitudeM = 1200 + (i % 8) * 520;

    out.push({
      id: `sim-flight-${i + 1}`,
      callsign: `SIM${String(120 + i)}`,
      lat,
      lng,
      heading,
      speedKts,
      altitudeM,
      updatedAt: now,
      source: "opensky",
    });
  }

  return out;
}
