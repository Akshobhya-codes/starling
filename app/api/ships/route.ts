import { NextResponse } from "next/server";
import { fetchShipsForBBox } from "@/lib/ships";
import { generateSimulatedVessels } from "@/lib/sim-tracks";

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
  if (!bbox) return NextResponse.json({ vessels: [], source: "invalid_bbox" }, { status: 400 });

  if (simulate) {
    return NextResponse.json({ vessels: generateSimulatedVessels(bbox), source: "simulated" });
  }

  try {
    const { vessels, source } = await fetchShipsForBBox(bbox);
    if (vessels.length === 0) {
      return NextResponse.json({ vessels: generateSimulatedVessels(bbox), source: "simulated_fallback" });
    }
    return NextResponse.json({ vessels, source });
  } catch (e) {
    console.error("[Ships] fetch error", e);
    return NextResponse.json({ vessels: generateSimulatedVessels(bbox), source: "simulated_fallback" });
  }
}
