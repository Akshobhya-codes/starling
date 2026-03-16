import { NextResponse } from "next/server";
import { fetchFlightsForBBox } from "@/lib/flights";
import { generateSimulatedFlights } from "@/lib/sim-tracks";

export const dynamic = "force-dynamic";

function parseBBox(raw: string | null) {
  if (!raw) return null;
  const [south, west, north, east] = raw.split(",").map(Number);
  if ([south, west, north, east].some((n) => Number.isNaN(n))) return null;
  return { south, west, north, east };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bbox = parseBBox(searchParams.get("bbox"));
  const simulate = searchParams.get("simulate") === "1";
  if (!bbox) return NextResponse.json({ flights: [], source: "invalid_bbox" }, { status: 400 });

  if (simulate) {
    return NextResponse.json({ flights: generateSimulatedFlights(bbox), source: "simulated" });
  }

  try {
    const flights = await fetchFlightsForBBox(bbox);
    if (flights.length === 0) {
      return NextResponse.json({ flights: generateSimulatedFlights(bbox), source: "simulated_fallback" });
    }
    return NextResponse.json({ flights, source: "opensky" });
  } catch (e) {
    console.error("[Flights] fetch error", e);
    return NextResponse.json({ flights: generateSimulatedFlights(bbox), source: "simulated_fallback" });
  }
}
