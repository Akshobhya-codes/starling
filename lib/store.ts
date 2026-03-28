import { Hypothesis, CameraInfo, RoadSegment, FeedStatus, Bolo } from "./types";

export interface FeatureFlags {
  cameras: boolean;
  boloV2: boolean;
  feed511: boolean;
  feedDataSF: boolean;
  ships: boolean;
  flights: boolean;
}

class Store {
  hypotheses: Map<string, Hypothesis> = new Map();
  cameras: Map<string, CameraInfo> = new Map();
  roads: Map<string, RoadSegment> = new Map();
  bolos: Map<string, Bolo> = new Map();
  feedStatus: FeedStatus = {
    cameras: { active: 0, total: 0 },
    fiveEleven: "ok",
    activeHypotheses: 0,
  };
  features: FeatureFlags = {
    cameras: false,
    boloV2: true,
    feed511: false,
    feedDataSF: false,
    ships: false,
    flights: false,
  };

  getActiveHypotheses(): Hypothesis[] {
    return Array.from(this.hypotheses.values())
      .filter((h) => h.state !== "cleared")
      .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
  }

  getActiveBolos(): Bolo[] {
    return Array.from(this.bolos.values()).filter((b) => b.status !== "cleared" && b.status !== "paused");
  }

  updateFeedStatus() {
    this.feedStatus.activeHypotheses = this.getActiveHypotheses().length;
    this.feedStatus.cameras.active = Array.from(this.cameras.values()).filter(
      (c) => c.lastFetched && Date.now() - new Date(c.lastFetched).getTime() < 120000
    ).length;
    this.feedStatus.cameras.total = this.cameras.size;
  }
}

// Singleton — persist across Next.js hot reloads
const globalForStore = globalThis as unknown as { __sfStore?: Store };
if (!globalForStore.__sfStore) {
  globalForStore.__sfStore = new Store();
}
export const store = globalForStore.__sfStore;
