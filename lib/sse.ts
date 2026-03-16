type SSEClient = {
  id: string;
  controller: ReadableStreamDefaultController;
};

class SSEBroker {
  private clients: Map<string, SSEClient> = new Map();

  addClient(id: string, controller: ReadableStreamDefaultController) {
    this.clients.set(id, { id, controller });
  }

  removeClient(id: string) {
    this.clients.delete(id);
  }

  broadcast(event: string, data: any) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const encoder = new TextEncoder();
    const encoded = encoder.encode(message);

    for (const [id, client] of this.clients) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  get clientCount() {
    return this.clients.size;
  }
}

// Singleton — persist across Next.js hot reloads
const globalForSSE = globalThis as unknown as { __sseBroker?: SSEBroker };
if (!globalForSSE.__sseBroker) {
  globalForSSE.__sseBroker = new SSEBroker();
}
export const sseBroker = globalForSSE.__sseBroker;
