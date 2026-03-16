import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { startEngine } from "@/lib/engine";
import { createBolo } from "@/lib/bolo";
import { store } from "@/lib/store";
import { sseBroker } from "@/lib/sse";

export const dynamic = "force-dynamic";

const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY || "" });
const GROQ_MODEL_QUERY = "llama-3.3-70b-versatile";

type ThreatLevel = "low" | "moderate" | "elevated" | "high" | "critical";

interface QueryResult {
  answer: string;
  flyTo: { lat: number; lng: number } | null;
  highlightIds: string[];
  filterType: string | null;
  threatLevel: ThreatLevel;
  recommendations: string[];
  bolo?: unknown;
}

function fallbackResult(answer: string): QueryResult {
  return {
    answer,
    flyTo: null,
    highlightIds: [],
    filterType: null,
    threatLevel: "low",
    recommendations: [],
  };
}

function buildStatusResult(): QueryResult {
  const activeBolos = store.getActiveBolos();
  const hypotheses = store.getActiveHypotheses();
  return {
    answer: `System status:\n• ${hypotheses.length} active incident(s)\n• ${activeBolos.length} active BOLO(s)\n• ${store.cameras.size} cameras available`,
    flyTo: null,
    highlightIds: [],
    filterType: null,
    threatLevel: activeBolos.length > 0 ? "elevated" : hypotheses.some((hyp) => hyp.severity === "critical") ? "high" : "low",
    recommendations: activeBolos.map((bolo) => `${bolo.description}: ${bolo.sightings.length} sighting(s)`).slice(0, 3),
  };
}

function buildHelpResult(): QueryResult {
  return {
    answer: "Commands:\n• /bolo <description>\n• /track <description>\n• /find <description>\n• /clear <bolo_id | all>\n• /status\n• /help",
    flyTo: null,
    highlightIds: [],
    filterType: null,
    threatLevel: "low",
    recommendations: [],
  };
}

function buildBoloResult(command: string): QueryResult {
  const bolo = createBolo(command);
  return {
    answer: `BOLO issued for ${bolo.description}. Camera analysis will watch for matches and sightings will appear in the BOLO panel.`,
    flyTo: null,
    highlightIds: [],
    filterType: null,
    threatLevel: "elevated",
    recommendations: [
      `Tracking ${bolo.description}`,
      "Watch the BOLO tab for sightings",
    ],
    bolo,
  };
}

function clearBolo(target: string): QueryResult {
  if (target === "all") {
    for (const bolo of store.bolos.values()) {
      bolo.status = "cleared";
      store.bolos.set(bolo.id, bolo);
      sseBroker.broadcast("bolo:cleared", bolo);
    }
    return fallbackResult("All BOLOs cleared.");
  }

  const bolo = store.bolos.get(target);
  if (!bolo) {
    return fallbackResult(`No BOLO found for "${target}".`);
  }

  bolo.status = "cleared";
  store.bolos.set(bolo.id, bolo);
  sseBroker.broadcast("bolo:cleared", bolo);
  return fallbackResult(`BOLO "${bolo.description}" cleared.`);
}

function maybeParseJson(text: string): QueryResult | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<QueryResult>;
    return {
      answer: parsed.answer || "No answer available.",
      flyTo: parsed.flyTo || null,
      highlightIds: Array.isArray(parsed.highlightIds) ? parsed.highlightIds : [],
      filterType: parsed.filterType || null,
      threatLevel: (parsed.threatLevel as ThreatLevel) || "low",
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  startEngine();

  const { query } = await request.json();
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  const trimmedQuery = query.trim();
  const lowerQuery = trimmedQuery.toLowerCase();

  if (lowerQuery.startsWith("/bolo ")) {
    return NextResponse.json(buildBoloResult(trimmedQuery.slice(6).trim()));
  }
  if (lowerQuery.startsWith("/track ")) {
    return NextResponse.json(buildBoloResult(trimmedQuery.slice(7).trim()));
  }
  if (lowerQuery.startsWith("/find ")) {
    return NextResponse.json(buildBoloResult(trimmedQuery.slice(6).trim()));
  }
  if (lowerQuery.startsWith("/clear ")) {
    return NextResponse.json(clearBolo(lowerQuery.slice(7).trim()));
  }
  if (lowerQuery === "/status" || lowerQuery === "/bolos") {
    return NextResponse.json(buildStatusResult());
  }
  if (lowerQuery === "/help" || lowerQuery === "/?") {
    return NextResponse.json(buildHelpResult());
  }

  const hasTrackVerb = /\b(track|bolo|find|locate|watch for|look for|lookout|search for|spot|flag|alert|monitor)\b/.test(lowerQuery);
  const hasVehicle = /\b(car|vehicle|truck|van|suv|sedan|coupe|hatchback|pickup|motorcycle|bike|waymo|cruise|zoox|autonomous|self.?driving|nissan|toyota|honda|ford|chevy|chevrolet|bmw|tesla|audi|mercedes|lexus|hyundai|kia|subaru|mazda|jeep|dodge|ram|gmc|cadillac|volvo|porsche|plate|license)\b/i.test(lowerQuery);
  const hasColor = /\b(red|blue|black|white|silver|gray|grey|green|yellow|orange|brown|tan|gold|maroon|beige|purple)\b/.test(lowerQuery);
  const isBoloIntent = hasTrackVerb && (hasVehicle || hasColor);
  if (isBoloIntent) {
    return NextResponse.json(buildBoloResult(trimmedQuery));
  }

  const hypotheses = store.getActiveHypotheses();
  const activeBolos = store.getActiveBolos();

  const hypothesesSummary = hypotheses.map((hyp) => ({
    id: hyp.id,
    type: hyp.type,
    severity: hyp.severity,
    confidence: hyp.confidence,
    state: hyp.state,
    location: hyp.locationLabel,
    lat: hyp.lat,
    lng: hyp.lng,
    description: hyp.description,
    sources: [...new Set(hyp.evidence.map((e) => e.source))],
    evidenceCount: hyp.evidence.length,
    detectedAt: hyp.detectedAt,
  }));

  const boloSummary = activeBolos.map((bolo) => ({
    id: bolo.id,
    description: bolo.description,
    color: bolo.color,
    make: bolo.make,
    model: bolo.model,
    plate: bolo.plate,
    status: bolo.status,
    sightings: bolo.sightings.length,
    lastSighting: bolo.sightings.length > 0 ? bolo.sightings[bolo.sightings.length - 1] : null,
  }));

  const prompt = [
    "You are an analyst for an SF operations map. Answer questions concisely and tactically using only the provided data.",
    "Return ONLY valid JSON in this format:",
    '{"answer":"string","flyTo":{"lat":number,"lng":number}|null,"highlightIds":["id"],"filterType":"accident"|"fire"|"congestion"|"construction"|"medical"|"hazard"|"police"|"road_closure"|null,"threatLevel":"low"|"moderate"|"elevated"|"high"|"critical","recommendations":["string"]}',
    "Rules:",
    "- Do not invent incidents or locations.",
    "- Only set flyTo when the user explicitly asks to show, zoom, go, fly, or navigate to an incident already in the data.",
    "- highlightIds should contain relevant incident ids when applicable.",
    "- recommendations should be 0-3 short actions.",
    "- threatLevel should reflect the most serious current situation.",
    "",
    "Active incidents:",
    JSON.stringify(hypothesesSummary, null, 2),
    "",
    "Active BOLOs:",
    JSON.stringify(boloSummary, null, 2),
    "",
    `User query: ${trimmedQuery}`,
  ].join("\n");

  try {
    const response = await groqClient.chat.completions.create({
      model: GROQ_MODEL_QUERY,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });

    const text = response.choices[0]?.message?.content ?? "";
    const parsed = maybeParseJson(text);
    if (parsed) {
      return NextResponse.json(parsed);
    }
  } catch (error) {
    console.error("[Query] Error:", error);
  }

  return NextResponse.json(fallbackResult("I could not process that request from the current incident data."));
}
