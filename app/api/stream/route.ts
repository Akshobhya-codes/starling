import { startEngine } from "@/lib/engine";
import { sseBroker } from "@/lib/sse";
import { store } from "@/lib/store";
import { getServerLogs } from "@/lib/server-logs";

export const dynamic = "force-dynamic";

export async function GET() {
  startEngine();

  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const stream = new ReadableStream({
    start(controller) {
      sseBroker.addClient(clientId, controller);

      // Send initial state
      const encoder = new TextEncoder();
      const initData = {
        hypotheses: store.getActiveHypotheses(),
        feedStatus: store.feedStatus,
        bolos: Array.from(store.bolos.values()),
        serverLogs: getServerLogs(),
      };
      controller.enqueue(
        encoder.encode(`event: init\ndata: ${JSON.stringify(initData)}\n\n`)
      );
    },
    cancel() {
      sseBroker.removeClient(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
