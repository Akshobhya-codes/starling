import { SF_ROADS } from "./roads";
import { store } from "./store";
import { TrafficDensity, RoadSegment } from "./types";

const DENSITY_TO_SPEED_FACTOR: Record<TrafficDensity, number> = {
  empty: 1.0,
  light: 0.85,
  moderate: 0.6,
  heavy: 0.35,
  gridlock: 0.1,
};

const DENSITY_TO_CARS: Record<TrafficDensity, number> = {
  empty: 3,
  light: 6,
  moderate: 10,
  heavy: 16,
  gridlock: 22,
};

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function initializeRoads() {
  for (const road of SF_ROADS) {
    store.roads.set(road.id, { ...road });
  }
}

export function updateTrafficFromIncidents() {
  const hypotheses = store.getActiveHypotheses();

  for (const [id, road] of store.roads) {
    let nearestIncidentDist = Infinity;
    let incidentSeverityFactor = 1.0;

    // Check each point on the road against active incidents
    for (const point of road.polyline) {
      for (const hyp of hypotheses) {
        if (hyp.state === "cleared") continue;
        const dist = haversineDistance(point[1], point[0], hyp.lat, hyp.lng);
        if (dist < nearestIncidentDist) {
          nearestIncidentDist = dist;
          // Scale impact by severity
          const sevMap = { low: 0.8, medium: 0.6, high: 0.35, critical: 0.15 };
          incidentSeverityFactor = sevMap[hyp.severity] || 0.5;
        }
      }
    }

    // Apply incident impact (decays with distance)
    let speedFactor = DENSITY_TO_SPEED_FACTOR[road.density];
    if (nearestIncidentDist < 0.5) {
      // Within ~800m of incident
      const proximityFactor = Math.max(0.1, nearestIncidentDist / 0.5);
      speedFactor = Math.min(speedFactor, incidentSeverityFactor * proximityFactor);
      // Increase car density near incidents (cars bunching)
      road.density = speedFactor < 0.2 ? "gridlock" : speedFactor < 0.4 ? "heavy" : "moderate";
    }

    road.currentSpeed = Math.max(2, road.freeFlowSpeed * speedFactor);
    road.carCount = DENSITY_TO_CARS[road.density];
    store.roads.set(id, road);
  }
}

export function getRoadSegments(): RoadSegment[] {
  return Array.from(store.roads.values());
}
