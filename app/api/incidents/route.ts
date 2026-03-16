import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { startEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  startEngine();
  const hypotheses = store.getActiveHypotheses();
  return NextResponse.json({
    hypotheses,
    feedStatus: store.feedStatus,
  });
}
