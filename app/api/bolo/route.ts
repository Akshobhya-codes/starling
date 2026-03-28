import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { sseBroker } from "@/lib/sse";
import { startEngine } from "@/lib/engine";
import { createBolo } from "@/lib/bolo";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  startEngine();

  const body = await request.json();
  const command = typeof body.command === "string" ? body.command : body.description;
  if (!command || typeof command !== "string") {
    return NextResponse.json({ error: "Missing command" }, { status: 400 });
  }

  try {
    const bolo = createBolo(command);
    console.log("[BOLO] Created:", bolo.description);

    return NextResponse.json({ bolo });
  } catch (e) {
    console.error("[BOLO] Error:", e);
    return NextResponse.json({ error: "Failed to create BOLO" }, { status: 500 });
  }
}

export async function GET() {
  startEngine();
  const bolos = Array.from(store.bolos.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return NextResponse.json({ bolos });
}

export async function DELETE(request: Request) {
  const { id } = await request.json();
  const bolo = store.bolos.get(id);
  if (bolo) {
    bolo.status = "cleared";
    store.bolos.set(id, bolo);
    sseBroker.broadcast("bolo:cleared", bolo);
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const { id, status } = await request.json();
  const bolo = store.bolos.get(id);
  if (!bolo) {
    return NextResponse.json({ error: "BOLO not found" }, { status: 404 });
  }
  if (!["candidate", "active", "confirmed", "cleared", "paused", "sighted"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  bolo.status = status;
  store.bolos.set(id, bolo);
  sseBroker.broadcast("bolo:update", bolo);
  return NextResponse.json({ bolo });
}
