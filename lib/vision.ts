import OpenAI from "openai";
import sharp from "sharp";
import { CameraAnalysis, Bolo, VehicleAttributes } from "./types";

// ── Vision provider: OpenAI (gpt-4o) ──
type VisionProvider = "openai";

const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

const VISION_MIN_INTERVAL_MS = 700;
const RATE_LIMIT_BACKOFF_MS = 8000;
const providerState: Record<VisionProvider, { nextSlotMs: number }> = {
  openai: { nextSlotMs: 0 },
};

interface ParsedCameraAnalysis {
  hasIncident?: boolean;
  incidents?: CameraAnalysis["incidents"];
  trafficDensity?: CameraAnalysis["trafficDensity"];
  weather?: string;
  boloMatches?: Array<{
    boloId?: string;
    confidence?: number;
    details?: string;
    bbox?: [number, number, number, number];
  }>;
}

interface ParsedVehicleDetection {
  vehicles?: Array<{
    confidence?: number;
    bbox?: [number, number, number, number];
    bodyType?: string;
    details?: string;
  }>;
}

interface ParsedVehicleAttributes {
  primaryColor?: string;
  secondaryColor?: string;
  make?: string;
  model?: string;
  bodyType?: string;
  plate?: string;
  confidenceByAttribute?: VehicleAttributes["confidenceByAttribute"];
}

interface ParsedBoloScanResponse {
  matches?: Array<{
    cameraName?: string;
    boloId?: string;
    confidence?: number;
    details?: string;
    bbox?: [number, number, number, number];
    attributes?: VehicleAttributes;
  }>;
}

function normalizeBboxValues(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  let vals = raw.map((v) => Number(v ?? 0));
  if (!vals.every(Number.isFinite)) return undefined;

  const maxVal = Math.max(...vals);
  if (maxVal > 100) {
    const scale = maxVal > 500 ? 1000 : maxVal > 100 ? maxVal : 100;
    vals = vals.map((v) => (v / scale) * 100);
  }

  vals = vals.map((v) => Math.max(0, Math.min(100, v)));
  let [ymin, xmin, ymax, xmax] = vals;
  if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
  if (xmin > xmax) [xmin, xmax] = [xmax, xmin];
  return [ymin, xmin, ymax, xmax];
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function getErrorStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: number }).status)
    : undefined;
}

function getProviderOrder(): VisionProvider[] {
  return ["openai"];
}

function providerEnabled(provider: VisionProvider): boolean {
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return false;
}

function getPrimaryEnabledProvider(): VisionProvider | null {
  return providerEnabled("openai") ? "openai" : null;
}

async function withRetry<T>(provider: VisionProvider, fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      const now = Date.now();
      if (now < providerState[provider].nextSlotMs) {
        await new Promise((resolve) => setTimeout(resolve, providerState[provider].nextSlotMs - now));
      }
      providerState[provider].nextSlotMs = Date.now() + VISION_MIN_INTERVAL_MS;
      return await fn();
    } catch (error: unknown) {
      const message = getErrorMessage(error).toLowerCase();
      const isRateLimit =
        getErrorStatus(error) === 429 ||
        message.includes("429") ||
        message.includes("quota") ||
        message.includes("rate");
      if (isRateLimit && i < retries) {
        const delay = (i + 1) * 10000;
        providerState[provider].nextSlotMs = Math.max(providerState[provider].nextSlotMs, Date.now() + RATE_LIMIT_BACKOFF_MS);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unreachable");
}

function normalizeBodyType(value?: string): VehicleAttributes["bodyType"] {
  const v = (value || "").toLowerCase().trim();
  if (!v) return undefined;
  if (v.includes("motor")) return "motorcycle";
  if (v.includes("pickup")) return "pickup";
  if (v.includes("suv")) return "suv";
  if (v.includes("truck")) return "truck";
  if (v.includes("van")) return "van";
  if (v.includes("coupe")) return "coupe";
  if (v.includes("hatch")) return "hatchback";
  if (v.includes("wagon")) return "wagon";
  if (v.includes("mini")) return "minivan";
  if (v.includes("cross")) return "crossover";
  if (v.includes("sedan")) return "sedan";
  return "other";
}

function normalizeColor(value?: string): string | undefined {
  const v = (value || "").toLowerCase().trim();
  if (!v) return undefined;
  if (v === "grey") return "gray";
  return v;
}

async function callVisionJson<T>(
  prompt: string,
  imageSource: string,
  options?: { isUrl?: boolean; maxTokens?: number }
): Promise<T | null> {
  let imageDataUrl: string;
  if (options?.isUrl) {
    // Download image and convert to base64 (OpenAI can't fetch Caltrans URLs directly)
    const imgBuffer = await getImageBuffer(imageSource, true);
    if (!imgBuffer) return null;
    imageDataUrl = `data:image/jpeg;base64,${imgBuffer.toString("base64")}`;
  } else {
    imageDataUrl = `data:image/jpeg;base64,${imageSource}`;
  }
  const providers = getProviderOrder();
  let lastError: unknown = null;

  for (const provider of providers) {
    if (!providerEnabled(provider)) continue;
    try {
      let text = "";

      if (provider === "openai") {
        const response = await withRetry("openai", () =>
          openaiClient.chat.completions.create({
            model: OPENAI_VISION_MODEL,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt + "\n\nRespond with raw JSON only. No markdown, no code fences." },
                  { type: "image_url", image_url: { url: imageDataUrl, detail: "low" } },
                ],
              },
            ],
            max_tokens: options?.maxTokens ?? 1024,
            temperature: 0.1,
          })
        );
        text = response.choices[0]?.message?.content ?? "";
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]) as T;
    } catch (error: unknown) {
      console.warn(`[Nemo Vision] ${provider} failed:`, getErrorMessage(error).slice(0, 200));
      lastError = error;
      continue;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("No vision provider configured. Set OPENAI_API_KEY.");
}

async function getImageBuffer(imageSource: string, isUrl: boolean): Promise<Buffer | null> {
  try {
    if (isUrl) {
      const response = await fetch(imageSource, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    }
    return Buffer.from(imageSource, "base64");
  } catch {
    return null;
  }
}

/**
 * Rejects placeholder/unavailable frames before BOLO matching.
 * Heuristic: mostly-white frame with very low edge/detail density.
 */
async function isLikelyUnavailableFrame(imageSource: string, isUrl: boolean): Promise<boolean> {
  const buffer = await getImageBuffer(imageSource, isUrl);
  if (!buffer || buffer.length < 8000) return true;

  try {
    const { data, info } = await sharp(buffer)
      .resize(64, 64, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    if (channels < 3) return false;

    let whiteCount = 0;
    let edgeCount = 0;
    const pixelCount = info.width * info.height;
    const luminance: number[] = new Array(pixelCount);

    for (let i = 0, p = 0; i < data.length; i += channels, p++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      luminance[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (r > 230 && g > 230 && b > 230) {
        whiteCount++;
      }
    }

    for (let y = 0; y < info.height - 1; y++) {
      for (let x = 0; x < info.width - 1; x++) {
        const idx = y * info.width + x;
        const dx = Math.abs(luminance[idx] - luminance[idx + 1]);
        const dy = Math.abs(luminance[idx] - luminance[idx + info.width]);
        if (dx + dy > 55) edgeCount++;
      }
    }

    const whiteRatio = whiteCount / pixelCount;
    const edgeRatio = edgeCount / ((info.width - 1) * (info.height - 1));
    return whiteRatio > 0.78 && edgeRatio < 0.09;
  } catch {
    return false;
  }
}

export interface BoloCandidate {
  bbox: [number, number, number, number];
  confidence: number;
  details?: string;
  attributes: VehicleAttributes;
}

export interface BoloVerificationResult {
  matched: boolean;
  confidence: number;
  details: string;
}

export async function vehicleDetect(
  imageSource: string,
  cameraName: string,
  isUrl: boolean = false
): Promise<BoloCandidate[]> {
  const prompt = [
    `Detect vehicles in camera frame "${cameraName}".`,
    "Return ONLY JSON:",
    '{"vehicles":[{"confidence":0.8,"bbox":[ymin,xmin,ymax,xmax],"bodyType":"sedan","details":"short note"}]}',
    "bbox uses percentages 0-100.",
    "Only include cars/trucks/suvs/vans/motorcycles with confidence >= 0.45.",
  ].join("\n");

  try {
    const parsed = await callVisionJson<ParsedVehicleDetection>(prompt, imageSource, {
      isUrl,
      maxTokens: 320,
    });
    const vehicles = parsed?.vehicles || [];
    return vehicles
      .filter((v) => Array.isArray(v.bbox) && v.bbox.length === 4)
      .map((v) => ({
        bbox: normalizeBboxValues(v.bbox) || v.bbox as [number, number, number, number],
        confidence: Math.max(0, Math.min(1, v.confidence ?? 0.5)),
        details: v.details || "Vehicle candidate",
        attributes: {
          bodyType: normalizeBodyType(v.bodyType),
          confidenceByAttribute: { bodyType: v.confidence ?? 0.5 },
          source: "detector",
        },
      }));
  } catch (error: unknown) {
    console.warn(`[Nemo Vision] vehicleDetect failed for ${cameraName}:`, getErrorMessage(error));
    return [];
  }
}

export async function vehicleAttributes(
  imageSource: string,
  cameraName: string,
  bbox: [number, number, number, number],
  isUrl: boolean = false
): Promise<VehicleAttributes> {
  const prompt = [
    `Infer vehicle attributes in camera frame "${cameraName}" for bbox ${bbox.join(",")}.`,
    "Return ONLY JSON:",
    '{"primaryColor":"white","secondaryColor":"black","make":"toyota","model":"camry","bodyType":"sedan","plate":"optional","confidenceByAttribute":{"primaryColor":0.8,"make":0.6,"model":0.4,"bodyType":0.8,"plate":0.2}}',
    "Use null/omit when unknown. Be conservative.",
  ].join("\n");

  try {
    const parsed = await callVisionJson<ParsedVehicleAttributes>(prompt, imageSource, {
      isUrl,
      maxTokens: 256,
    });
    return {
      primaryColor: normalizeColor(parsed?.primaryColor),
      secondaryColor: normalizeColor(parsed?.secondaryColor),
      make: parsed?.make?.toLowerCase(),
      model: parsed?.model?.toLowerCase(),
      bodyType: normalizeBodyType(parsed?.bodyType),
      plate: parsed?.plate?.toUpperCase(),
      confidenceByAttribute: parsed?.confidenceByAttribute || {},
      source: "attribute-model",
    };
  } catch (error: unknown) {
    console.warn(`[Nemo Vision] vehicleAttributes failed for ${cameraName}:`, getErrorMessage(error));
    return { source: "attribute-model", confidenceByAttribute: {} };
  }
}

export function scoreBoloCandidate(bolo: Bolo, attrs: VehicleAttributes): number {
  let score = 0;
  const constraints = bolo.constraints;

  const plateConstraint = constraints?.plate?.[0]?.value || bolo.plate;
  if (plateConstraint && attrs.plate) {
    score += attrs.plate.toUpperCase() === plateConstraint.toUpperCase() ? 1 : -0.8;
  }

  const makeConstraint = constraints?.make?.[0]?.value || bolo.make;
  if (makeConstraint && attrs.make) {
    score += attrs.make.includes(makeConstraint.toLowerCase()) ? 0.35 : -0.15;
  }

  const modelConstraint = constraints?.model?.[0]?.value || bolo.model;
  if (modelConstraint && attrs.model) {
    score += attrs.model.includes(modelConstraint.toLowerCase()) ? 0.25 : -0.1;
  }

  const colorConstraint = constraints?.color?.[0]?.value || bolo.color;
  if (colorConstraint && attrs.primaryColor) {
    score += attrs.primaryColor === normalizeColor(colorConstraint) ? 0.25 : -0.08;
  }

  const bodyTypeConstraint = constraints?.bodyType?.[0]?.value;
  if (bodyTypeConstraint && attrs.bodyType) {
    score += attrs.bodyType === normalizeBodyType(bodyTypeConstraint) ? 0.15 : -0.05;
  }

  return Math.max(0, Math.min(1, score));
}

export async function verifyBoloCandidate(
  imageSource: string,
  cameraName: string,
  bolo: Bolo,
  candidate: BoloCandidate,
  isUrl: boolean = false
): Promise<BoloVerificationResult> {
  const prompt = [
    `Verify if bbox ${candidate.bbox.join(",")} in "${cameraName}" matches this BOLO.`,
    `BOLO: ${bolo.description}`,
    `Known attrs: color=${bolo.color || "unknown"}, make=${bolo.make || "unknown"}, model=${bolo.model || "unknown"}, plate=${bolo.plate || "unknown"}`,
    `Candidate attrs: ${JSON.stringify(candidate.attributes)}`,
    "Return ONLY JSON:",
    '{"matched":true,"confidence":0.8,"details":"short explanation"}',
  ].join("\n");

  try {
    const parsed = await callVisionJson<{ matched?: boolean; confidence?: number; details?: string }>(
      prompt,
      imageSource,
      { isUrl, maxTokens: 192 }
    );
    return {
      matched: Boolean(parsed?.matched),
      confidence: Math.max(0, Math.min(1, parsed?.confidence ?? 0.5)),
      details: parsed?.details || "Nemo vision verification",
    };
  } catch (error: unknown) {
    console.warn(`[Nemo Vision] verifyBoloCandidate failed for ${cameraName}:`, getErrorMessage(error));
    return { matched: false, confidence: 0, details: "Vision verification failed" };
  }
}

export async function analyzeCamera(
  imageSource: string,
  cameraName: string,
  activeBolos?: Bolo[],
  isUrl: boolean = false
): Promise<CameraAnalysis> {
  if (await isLikelyUnavailableFrame(imageSource, isUrl)) {
    return {
      hasIncident: false,
      incidents: [],
      trafficDensity: "moderate",
      timestamp: new Date().toISOString(),
    };
  }

  let boloSection = "";
  if (activeBolos && activeBolos.length > 0) {
    const boloDescriptions = activeBolos
      .map(function (bolo) {
        const parts = [];
        if (bolo.color) parts.push(bolo.color);
        if (bolo.make) parts.push(bolo.make);
        if (bolo.model) parts.push(bolo.model);
        if (bolo.plate) parts.push("plate: " + bolo.plate);
        return "- BOLO #" + bolo.id + ": " + parts.join(" ") + " (" + bolo.description + ")";
      })
      .join("\n");
    boloSection =
      "\n\nACTIVE BOLO ALERTS:\n" +
      boloDescriptions +
      "\n\nCheck every vehicle for BOLO matches. Add any match to boloMatches array.";
  }

  const prompt = `Analyze this traffic camera from "${cameraName}". Return ONLY JSON:
{"hasIncident":false,"incidents":[],"trafficDensity":"moderate","vehicleCount":0,"boloMatches":[]}
For boloMatches: [{"boloId":"id","confidence":0.8,"details":"what matched","bbox":[ymin,xmin,ymax,xmax]}] where bbox is [ymin,xmin,ymax,xmax] percentages (0-100).${boloSection}`;

  try {
    const parsed = await callVisionJson<ParsedCameraAnalysis>(prompt, imageSource, {
      isUrl,
      maxTokens: 512,
    });
    if (!parsed) {
      return {
        hasIncident: false,
        incidents: [],
        trafficDensity: "moderate",
        timestamp: new Date().toISOString(),
      };
    }

    const result: CameraAnalysis & {
      boloMatches?: Array<{
        boloId?: string;
        confidence?: number;
        details?: string;
        bbox?: [number, number, number, number];
      }>;
    } = {
      hasIncident: parsed.hasIncident ?? false,
      incidents: parsed.incidents ?? [],
      trafficDensity: parsed.trafficDensity ?? "moderate",
      weather: parsed.weather,
      timestamp: new Date().toISOString(),
    };
    if (Array.isArray(parsed.boloMatches)) {
      result.boloMatches = parsed.boloMatches;
    }
    return result;
  } catch (error: unknown) {
    console.error("[Nemo Vision] analysis error:", getErrorMessage(error));
    return {
      hasIncident: false,
      incidents: [],
      trafficDensity: "moderate",
      timestamp: new Date().toISOString(),
    };
  }
}

export interface BoloScanResult {
  matches: Array<{
    cameraName: string;
    boloId: string;
    confidence: number;
    details: string;
    bbox?: [number, number, number, number];
    cx?: number;
    cy?: number;
    attributes?: VehicleAttributes;
  }>;
}

const GEMINI_BOLO_MODEL = process.env.GEMINI_BOLO_MODEL || "gemini-2.0-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ── OpenAI RPM tracker: use OpenAI first, overflow to Gemini ──
const OPENAI_RPM_LIMIT = 500;
const openaiCallLog: number[] = [];

function canUseOpenAI(): boolean {
  if (!process.env.OPENAI_API_KEY) return false;
  const now = Date.now();
  // Remove calls older than 60s
  while (openaiCallLog.length > 0 && openaiCallLog[0] < now - 60000) {
    openaiCallLog.shift();
  }
  return openaiCallLog.length < OPENAI_RPM_LIMIT;
}

function recordOpenAICall(): void {
  openaiCallLog.push(Date.now());
}

function buildBoloPrompt(camName: string, boloDescriptions: string): string {
  return `BOLO VEHICLE SCAN - Camera: "${camName}"

Active BOLO targets:
${boloDescriptions}

STRICT RULES — READ CAREFULLY:
1. ONLY report a vehicle if its COLOR actually matches the BOLO. A white car is NOT red. A silver car is NOT black. Be very strict about color matching.
2. The boloId MUST be the EXACT full ID from the list above — copy it exactly, do NOT shorten or modify it
3. bbox must cover the ENTIRE matching vehicle bumper-to-bumper [ymin,xmin,ymax,xmax] as percentages 0-100
4. cx, cy = center of vehicle as percentage from top-left
5. confidence 0.85+ ONLY — do not report uncertain matches
6. If you cannot clearly confirm the color matches, return empty matches
7. FALSE POSITIVES ARE UNACCEPTABLE — only report if you are highly confident the color and vehicle type match

Return ONLY raw JSON, no markdown, no code fences:
{"matches":[{"boloId":"EXACT_FULL_ID","confidence":0.9,"details":"red sedan in center lane heading east","bbox":[40,25,65,45],"cx":35.0,"cy":52.0}]}
Empty: {"matches":[]}`;
}

async function scanWithOpenAI(prompt: string, imgBase64: string): Promise<string> {
  recordOpenAICall();
  const response = await openaiClient.chat.completions.create({
    model: OPENAI_VISION_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imgBase64}`, detail: "low" } },
      ],
    }],
    max_tokens: 512,
    temperature: 0.1,
  });
  return response.choices[0]?.message?.content ?? "";
}

async function scanWithGemini(prompt: string, imgBase64: string): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("No GEMINI_API_KEY");
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_BOLO_MODEL)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/jpeg", data: imgBase64 } },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
  }
  const geminiResponse = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return geminiResponse.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
}

export async function batchBoloScan(
  cameras: Array<{ name: string; imageUrl: string }>,
  activeBolos: Bolo[]
): Promise<BoloScanResult> {
  if (cameras.length === 0 || activeBolos.length === 0) {
    return { matches: [] };
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[BOLO] No OPENAI_API_KEY — BOLO scanning disabled");
    return { matches: [] };
  }

  const boloDescriptions = activeBolos.map((b) => {
    const parts: string[] = [];
    if (b.color) parts.push(b.color);
    if (b.make) parts.push(b.make);
    if (b.model) parts.push(b.model);
    if (b.plate) parts.push("plate: " + b.plate);
    return "BOLO " + b.id + ": " + parts.join(" ") + " (" + b.description + ")";
  }).join("\n");

  const allMatches: BoloScanResult["matches"] = [];

  for (const cam of cameras) {
    try {
      const imgBuffer = await getImageBuffer(cam.imageUrl, true);
      if (!imgBuffer) {
        console.log(`[BOLO] ${cam.name} skipped (could not download image)`);
        continue;
      }
      const imgBase64 = imgBuffer.toString("base64");
      const prompt = buildBoloPrompt(cam.name, boloDescriptions);

      console.log(`[BOLO] Scanning ${cam.name} via OpenAI...`);
      const text = await scanWithOpenAI(prompt, imgBase64);
      console.log(`[BOLO] ${cam.name} response: ${text.slice(0, 200)}`);

      // Strip markdown code fences if present (OpenAI sometimes wraps JSON in ```json ... ```)
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "");
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log(`[BOLO] ${cam.name} no JSON in response`);
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.matches && parsed.matches.length > 0) {
        for (const m of parsed.matches) {
          const bbox = normalizeBboxValues(m.bbox);
          const cx = typeof m.cx === "number" ? m.cx : bbox ? (bbox[1] + bbox[3]) / 2 : undefined;
          const cy = typeof m.cy === "number" ? m.cy : bbox ? (bbox[0] + bbox[2]) / 2 : undefined;
          allMatches.push({
            cameraName: cam.name,
            boloId: m.boloId || "",
            confidence: m.confidence || 0.5,
            details: m.details || "Visual match",
            bbox,
            cx,
            cy,
          });
          console.log(`[BOLO] *** MATCH *** ${cam.name}: ${m.boloId} conf=${m.confidence} details="${m.details}"`);
        }
      } else {
        console.log(`[BOLO] ${cam.name} no matches found`);
      }
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      if (msg.includes("429") || msg.includes("rate")) {
        console.log(`[BOLO] Rate limited — pausing scan cycle`);
        break; // Stop this cycle, will resume next tick
      }
      console.warn(`[BOLO] ${cam.name} scan failed:`, msg.slice(0, 150));
    }
  }

  return { matches: allMatches };
}
