import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getWorkingCameras, markCameraUnavailable } from "@/lib/cameras";
import { startEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  startEngine();
  const { id } = await params;
  const camera = store.cameras.get(id) || getWorkingCameras().find((c) => c.id === id);
  if (!camera) {
    return NextResponse.json({ error: "Camera not found" }, { status: 404 });
  }

  try {
    const response = await fetch(camera.imageUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "SF-OSINT/1.0" },
    });
    if (!response.ok) {
      markCameraUnavailable(id);
      return NextResponse.json({ error: "Upstream error" }, { status: 502 });
    }
    const buffer = await response.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    markCameraUnavailable(id);
    return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
  }
}
