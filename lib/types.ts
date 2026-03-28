export type IncidentType =
  | "accident"
  | "congestion"
  | "construction"
  | "fire"
  | "medical"
  | "hazard"
  | "police"
  | "road_closure"
  | "weather"
  | "other";

export type HypothesisState =
  | "candidate"
  | "corroborated"
  | "active"
  | "resolving"
  | "cleared";

export type Severity = "low" | "medium" | "high" | "critical";

export type TrafficDensity = "empty" | "light" | "moderate" | "heavy" | "gridlock";

export type EvidenceSource = "511" | "camera" | "scanner" | "dispatch";

export interface Evidence {
  source: EvidenceSource;
  sourceId: string;
  timestamp: string;
  weight: number;
  rawData: any;
  summary?: string;
}

export interface Hypothesis {
  id: string;
  state: HypothesisState;
  type: IncidentType;
  severity: Severity;
  confidence: number;
  lat: number;
  lng: number;
  locationLabel: string;
  description: string;
  evidence: Evidence[];
  detectedAt: string;
  lastUpdatedAt: string;
  decayRate: number;
}

export interface CameraInfo {
  id: string;
  name: string;
  lat: number;
  lng: number;
  imageUrl: string;
  streamUrl?: string;
  lastAnalysis?: CameraAnalysis;
  lastFetched?: string;
}

export interface CameraAnalysis {
  hasIncident: boolean;
  incidents: Array<{
    type: IncidentType;
    description: string;
    severity: Severity;
  }>;
  trafficDensity: TrafficDensity;
  weather?: string;
  timestamp: string;
}

export interface RoadSegment {
  id: string;
  name: string;
  polyline: [number, number][];
  freeFlowSpeed: number;
  currentSpeed: number;
  density: TrafficDensity;
  carCount: number;
}

export interface VesselTrack {
  id: string;
  name: string;
  lat: number;
  lng: number;
  heading: number;
  speedKts: number;
  updatedAt: string;
  source: "511_transit" | "swiftly";
}

export interface FlightTrack {
  id: string;
  callsign: string;
  lat: number;
  lng: number;
  heading: number;
  speedKts: number;
  altitudeM: number;
  updatedAt: string;
  source: "opensky";
}

export interface SSEMessage {
  event: string;
  data: any;
}

export interface FeedStatus {
  cameras: { active: number; total: number };
  fiveEleven: "ok" | "error" | "throttled";
  activeHypotheses: number;
}

export interface Bolo {
  id: string;
  description: string;
  color?: string;
  make?: string;
  model?: string;
  plate?: string;
  direction?: string;
  lastKnownLocation?: string;
  status: "active" | "candidate" | "confirmed" | "sighted" | "cleared" | "paused";
  createdAt: string;
  constraints?: BoloConstraints;
  latestScore?: number;
  sightings: BoloSighting[];
}

export type VehicleBodyType =
  | "sedan"
  | "suv"
  | "truck"
  | "van"
  | "coupe"
  | "hatchback"
  | "pickup"
  | "motorcycle"
  | "wagon"
  | "minivan"
  | "crossover"
  | "other";

export interface VehicleAttributes {
  bodyType?: VehicleBodyType;
  primaryColor?: string;
  secondaryColor?: string;
  make?: string;
  model?: string;
  plate?: string;
  confidenceByAttribute?: Partial<Record<"bodyType" | "primaryColor" | "secondaryColor" | "make" | "model" | "plate", number>>;
  source?: "detector" | "attribute-model" | "llm";
}

export interface BoloConstraint {
  value: string;
  weight: number;
  hard: boolean;
}

export interface BoloConstraints {
  color?: BoloConstraint[];
  make?: BoloConstraint[];
  model?: BoloConstraint[];
  plate?: BoloConstraint[];
  bodyType?: BoloConstraint[];
  direction?: BoloConstraint[];
}

export interface BoloProofMetadata {
  imageHash: string;
  cameraId: string;
  cameraName: string;
  frameCapturedAt: string;
  overlay: {
    bbox: [number, number, number, number];
    circle?: { cx: number; cy: number; radius: number };
    label: string;
    confidence: number;
  };
}

export interface BoloSighting {
  id: string;
  boloId: string;
  source: "camera" | "scanner";
  sourceId: string;
  location: string;
  lat: number;
  lng: number;
  timestamp: string;
  confidence: number;
  details: string;
  attributes?: VehicleAttributes;
  bbox?: [number, number, number, number];
  proofMetadata?: BoloProofMetadata;
  proofRawImageUrl?: string;
  proofAnnotatedImageUrl?: string;
  proofImageUrl?: string;
}
