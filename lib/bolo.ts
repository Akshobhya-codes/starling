import { store } from "./store";
import { sseBroker } from "./sse";
import { Bolo, BoloConstraints } from "./types";

const COLORS = ["red", "blue", "black", "white", "silver", "gray", "grey", "green", "yellow", "orange", "brown", "tan", "gold", "maroon", "beige", "purple"];
const MAKES = ["waymo", "cruise", "zoox", "nissan", "toyota", "honda", "ford", "chevy", "chevrolet", "bmw", "tesla", "audi", "mercedes", "lexus", "hyundai", "kia", "subaru", "mazda", "jeep", "dodge", "ram", "gmc", "cadillac", "volvo", "porsche", "volkswagen", "vw"];
const VEHICLE_MODELS = ["sedan", "suv", "truck", "van", "coupe", "hatchback", "pickup", "motorcycle", "bike", "convertible", "wagon", "minivan", "crossover", "roadster", "autonomous", "self-driving"];

let boloCounter = 0;

function buildConstraints(details: ReturnType<typeof parseBoloCommand>): BoloConstraints {
  const constraints: BoloConstraints = {};
  if (details.color) constraints.color = [{ value: details.color, weight: 0.25, hard: false }];
  if (details.make) constraints.make = [{ value: details.make, weight: 0.3, hard: false }];
  if (details.model) constraints.model = [{ value: details.model, weight: 0.2, hard: false }];
  if (details.plate) constraints.plate = [{ value: details.plate.toUpperCase(), weight: 1, hard: true }];
  if (details.direction) constraints.direction = [{ value: details.direction, weight: 0.1, hard: false }];
  return constraints;
}

export function parseBoloCommand(command: string) {
  const normalized = command.trim();
  const lower = normalized.toLowerCase();
  const words = lower.split(/\s+/);

  const color = COLORS.find((value) => words.includes(value));
  const make = MAKES.find((value) => words.includes(value));
  const model = VEHICLE_MODELS.find((value) => words.includes(value));
  const plateMatch = normalized.match(/\b(\d[A-Z]{2,3}\d{3,4}|[A-Z]{1,3}\d{3,4})\b/i);
  const directionMatch = lower.match(/\b(heading|toward|towards|going)\s+([a-z0-9 -]+)\b/);
  const direction = directionMatch ? `${directionMatch[1]} ${directionMatch[2]}` : undefined;

  let description = [color, make, model].filter(Boolean).join(" ").trim();
  if (!description) {
    description = normalized
      .replace(/^(track|find|locate|watch for|look for|search for|bolo)\s*/i, "")
      .trim();
  }

  return {
    color,
    make,
    model,
    plate: plateMatch ? plateMatch[1] : undefined,
    direction,
    lastKnownLocation: undefined,
    description: description || normalized,
  };
}

export function createBolo(command: string): Bolo {
  const details = parseBoloCommand(command);
  const constraints = buildConstraints(details);
  const bolo: Bolo = {
    id: "bolo_" + Date.now() + "_" + (++boloCounter),
    description: details.description || command,
    color: details.color || undefined,
    make: details.make || undefined,
    model: details.model || undefined,
    plate: details.plate || undefined,
    direction: details.direction || undefined,
    lastKnownLocation: details.lastKnownLocation || undefined,
    status: "candidate",
    createdAt: new Date().toISOString(),
    constraints,
    sightings: [],
  };

  store.bolos.set(bolo.id, bolo);
  sseBroker.broadcast("bolo:new", bolo);
  return bolo;
}
