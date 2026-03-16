import { NextResponse } from "next/server";
import { startEngine, getBoloValidationHistory } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  startEngine();
  const history = getBoloValidationHistory();
  const latest = history.length > 0 ? history[history.length - 1] : null;
  return NextResponse.json({ latest, history });
}
