import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { startEngine } from "@/lib/engine";
import { fetchRoadsForBBox } from "@/lib/overpass";
import { enrichRoadsWithTraffic } from "@/lib/google-routes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  startEngine();

  const { searchParams } = new URL(request.url);
  const bboxParam = searchParams.get("bbox");

  // If bbox provided, fetch real roads from Overpass then enrich with Google traffic
  if (bboxParam) {
    const [south, west, north, east] = bboxParam.split(",").map(Number);
    if (!isNaN(south) && !isNaN(west) && !isNaN(north) && !isNaN(east)) {
      try {
        const realRoads = await fetchRoadsForBBox({ south, west, north, east });
        if (realRoads.length > 0) {
          // Enrich with real-time Google Routes traffic data
          const enriched = await enrichRoadsWithTraffic(realRoads, bboxParam);
          return NextResponse.json({ roads: enriched, source: "google_traffic" });
        }
      } catch (e) {
        console.error("[Traffic] Fetch failed:", e);
      }
    }
  }

  // Fallback to store roads (hardcoded)
  const roads = Array.from(store.roads.values());
  return NextResponse.json({ roads, source: "fallback" });
}
