import { Hypothesis, Evidence, IncidentType, Severity, HypothesisState } from "./types";
import { store } from "./store";
import { sseBroker } from "./sse";

let idCounter = 0;

function generateId(): string {
  return `hyp_${Date.now()}_${++idCounter}`;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function determineSeverity(type: IncidentType, confidence: number): Severity {
  if (type === "fire" || type === "accident") {
    if (confidence > 0.8) return "critical";
    if (confidence > 0.5) return "high";
    return "medium";
  }
  if (type === "congestion" || type === "construction") {
    if (confidence > 0.8) return "high";
    return "medium";
  }
  if (confidence > 0.7) return "medium";
  return "low";
}

function computeConfidence(evidence: Evidence[]): number {
  if (evidence.length === 0) return 0;
  // Weighted combination with corroboration bonus
  const maxWeight = Math.max(...evidence.map((e) => e.weight));
  const uniqueSources = new Set(evidence.map((e) => e.source)).size;
  const corroborationBonus = Math.min((uniqueSources - 1) * 0.1, 0.2);
  return Math.min(maxWeight + corroborationBonus, 1.0);
}

export function addEvidence(
  type: IncidentType,
  lat: number,
  lng: number,
  locationLabel: string,
  description: string,
  evidence: Evidence
): Hypothesis {
  // Check for nearby existing hypothesis of same type
  const MERGE_RADIUS_MILES = 0.3; // ~500m
  let existing: Hypothesis | undefined;

  for (const hyp of store.hypotheses.values()) {
    if (hyp.state === "cleared") continue;
    if (hyp.type !== type) continue;
    const dist = haversineDistance(hyp.lat, hyp.lng, lat, lng);
    if (dist < MERGE_RADIUS_MILES) {
      existing = hyp;
      break;
    }
  }

  if (existing) {
    existing.evidence.push(evidence);
    existing.confidence = computeConfidence(existing.evidence);
    existing.severity = determineSeverity(existing.type, existing.confidence);
    existing.lastUpdatedAt = new Date().toISOString();
    if (existing.description.length < description.length) {
      existing.description = description;
    }

    // State transitions
    const sources = new Set(existing.evidence.map((e) => e.source));
    if (sources.size >= 2 && existing.state === "candidate") {
      existing.state = "corroborated";
    }
    if (existing.confidence >= 0.75 && existing.state !== "active") {
      existing.state = "active";
    }

    store.hypotheses.set(existing.id, existing);
    sseBroker.broadcast("hypothesis:update", existing);
    return existing;
  }

  // Create new hypothesis
  const confidence = computeConfidence([evidence]);
  const hyp: Hypothesis = {
    id: generateId(),
    state: "candidate",
    type,
    severity: determineSeverity(type, confidence),
    confidence,
    lat,
    lng,
    locationLabel,
    description,
    evidence: [evidence],
    detectedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    decayRate: 0.05,
  };

  // High-weight sources start as active
  if (evidence.weight >= 0.85) {
    hyp.state = "active";
  }

  store.hypotheses.set(hyp.id, hyp);
  sseBroker.broadcast("hypothesis:new", hyp);
  return hyp;
}

export function runDecayCycle() {
  const now = Date.now();
  for (const [id, hyp] of store.hypotheses) {
    if (hyp.state === "cleared") continue;

    const elapsed = (now - new Date(hyp.lastUpdatedAt).getTime()) / 60000; // minutes
    const decayPeriods = Math.floor(elapsed / 10);
    if (decayPeriods > 0) {
      hyp.confidence = Math.max(0, hyp.confidence - hyp.decayRate * decayPeriods);
      hyp.lastUpdatedAt = new Date().toISOString();

      if (hyp.confidence < 0.1) {
        hyp.state = "cleared";
        sseBroker.broadcast("hypothesis:cleared", hyp);
      } else if (hyp.confidence < 0.3 && hyp.state === "active") {
        hyp.state = "resolving";
        sseBroker.broadcast("hypothesis:update", hyp);
      }
    }
  }
  store.updateFeedStatus();
}
