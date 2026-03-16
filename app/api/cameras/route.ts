import { NextResponse } from "next/server";
import { getWorkingCameras } from "@/lib/cameras";
import { store } from "@/lib/store";
import { startEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  startEngine();
  const storeCameras = new Map(store.cameras);
  const cameras = getWorkingCameras().map((camera) => ({
    ...camera,
    ...(storeCameras.get(camera.id) || {}),
  }));
  return NextResponse.json({ cameras });
}
