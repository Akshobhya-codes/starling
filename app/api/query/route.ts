import { NextResponse } from "next/server";
import OpenAI from "openai";
import { startEngine, toggleFeature } from "@/lib/engine";
import { createBolo } from "@/lib/bolo";
import { store } from "@/lib/store";
import { sseBroker } from "@/lib/sse";

export const dynamic = "force-dynamic";

// OpenAI — Nemo's reasoning brain
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});
const OPENAI_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4o";

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
    answer: `Nemo status report:\n• ${hypotheses.length} active incident(s)\n• ${activeBolos.length} active BOLO(s)\n• ${store.cameras.size} cameras online\n\nAll systems operational. Standing by for orders.`,
    flyTo: null,
    highlightIds: [],
    filterType: null,
    threatLevel: activeBolos.length > 0 ? "elevated" : hypotheses.some((hyp) => hyp.severity === "critical") ? "high" : "low",
    recommendations: activeBolos.map((bolo) => `${bolo.description}: ${bolo.sightings.length} sighting(s)`).slice(0, 3),
  };
}

function buildHelpResult(): QueryResult {
  return {
    answer: "Nemo command reference:\n• /bolo <description> — Issue a vehicle BOLO alert\n• /track <description> — Track a vehicle\n• /find <description> — Search for a vehicle\n• /clear <bolo_id | all> — Clear BOLO alert(s)\n• /status — System status report\n• /help — Show this help\n\nYou can also ask me anything in natural language. I'll analyze the situation and take appropriate action.",
    flyTo: null,
    highlightIds: [],
    filterType: null,
    threatLevel: "low",
    recommendations: [],
  };
}

function buildBoloResult(command: string): QueryResult {
  const bolo = createBolo(command);

  // Auto-enable cameras so the BOLO scan loop starts immediately
  if (!store.features.cameras) {
    toggleFeature("cameras", true);
  }

  return {
    answer: `BOLO issued. I'm now actively scanning ${store.cameras.size} camera feeds for: ${bolo.description}.\n\nCameras are ONLINE. I'll alert you immediately when a match is detected with annotated proof images showing the suspect vehicle highlighted.`,
    flyTo: null,
    highlightIds: [],
    filterType: null,
    threatLevel: "elevated",
    recommendations: [
      `Tracking: ${bolo.description}`,
      "Monitor the BOLO tab for sightings with proof images",
      `${store.cameras.size} cameras actively scanning`,
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
    return fallbackResult("All BOLOs cleared. Camera scanning will return to normal operations.");
  }

  const bolo = store.bolos.get(target);
  if (!bolo) {
    return fallbackResult(`No BOLO found for "${target}". Use /status to see active BOLOs.`);
  }

  bolo.status = "cleared";
  store.bolos.set(bolo.id, bolo);
  sseBroker.broadcast("bolo:cleared", bolo);
  return fallbackResult(`BOLO cleared: "${bolo.description}". Scanning stopped for this target.`);
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

  // ── OpenAI reasoning: Nemo agent processes the query ──

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

  const systemPrompt = [
    "You are Nemo, an AI operations analyst for the Starling crime analysis and operations platform.",
    "You assist law enforcement and public safety operators in San Francisco.",
    "You are tactical, concise, and decisive. You think like an analyst, not a chatbot.",
    "When operators ask questions, you reason about the situation using the available data and provide actionable intelligence.",
    "",
    "Your capabilities:",
    "- Analyze active incidents and their severity/confidence",
    "- Track vehicles via the BOLO system",
    "- Navigate the operator to locations on the map",
    "- Assess threat levels and recommend actions",
    "- Summarize the current operational picture",
    "",
    "Return ONLY valid JSON in this format:",
    '{"answer":"string","flyTo":{"lat":number,"lng":number}|null,"highlightIds":["id"],"filterType":"accident"|"fire"|"congestion"|"construction"|"medical"|"hazard"|"police"|"road_closure"|null,"threatLevel":"low"|"moderate"|"elevated"|"high"|"critical","recommendations":["string"]}',
    "",
    "Rules:",
    "- Do not invent incidents or locations not in the data.",
    "- Only set flyTo when the operator explicitly asks to navigate/show/zoom to a location.",
    "- highlightIds should contain relevant incident ids when applicable.",
    "- recommendations should be 0-3 short tactical actions.",
    "- threatLevel should reflect the most serious current situation.",
    "- Speak like a professional operations analyst. Be direct and helpful.",
  ].join("\n");

  const userMessage = [
    "Active incidents:",
    JSON.stringify(hypothesesSummary, null, 2),
    "",
    "Active BOLOs:",
    JSON.stringify(boloSummary, null, 2),
    "",
    `Operator query: ${trimmedQuery}`,
  ].join("\n");

  try {
    const response = await openaiClient.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    });

    const text = response.choices[0]?.message?.content ?? "";
    const parsed = maybeParseJson(text);
    if (parsed) {
      return NextResponse.json(parsed);
    }
  } catch (error) {
    console.error("[Nemo] OpenAI query error:", error);
  }

  return NextResponse.json(fallbackResult("Nemo could not process that request from the current operational data. Try rephrasing or use /help for available commands."));
}
