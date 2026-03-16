import Groq from "groq-sdk";
import sharp from "sharp";
import { CameraAnalysis, Bolo, VehicleAttributes } from "./types";

type VisionProvider = "gemini" | "together" | "groq";

const GROQ_MODEL_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";
const GEMINI_MODEL_VISION = process.env.VISION_MODEL_GEMINI || "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TOGETHER_MODEL_VISION = process.env.VISION_MODEL_TOGETHER || "Qwen/Qwen2.5-VL-72B-Instruct";
const TOGETHER_API_URL = "https://api.together.xyz/v1/chat/completions";

const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY || "" });
const VISION_MIN_INTERVAL_MS = 700;
const RATE_LIMIT_BACKOFF_MS = 8000;
const providerState: Record<VisionProvider, { nextSlotMs: number }> = {
  gemini: { nextSlotMs: 0 },
  together: { nextSlotMs: 0 },
  groq: { nextSlotMs: 0 },
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
  const configured = (process.env.VISION_PROVIDER_ORDER || "gemini,groq,together")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const order = configured.filter(
    (p): p is VisionProvider => p === "gemini" || p === "together" || p === "groq"
  );
  return order.length > 0 ? order : ["gemini", "groq", "together"];
}

function providerEnabled(provider: VisionProvider): boolean {
  if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  if (provider === "together") return Boolean(process.env.TOGETHER_API_KEY);
  return Boolean(process.env.GROQ_API_KEY);
}

function getPrimaryEnabledProvider(): VisionProvider | null {
  const provider = getProviderOrder().find((p) => providerEnabled(p));
  return provider || null;
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
  const imageUrl = options?.isUrl ? imageSource : `data:image/jpeg;base64,${imageSource}`;
  const providers = getProviderOrder();
  let imageBase64: string | null = null;
  let lastError: unknown = null;

  for (const provider of providers) {
    if (!providerEnabled(provider)) continue;
    try {
      let text = "";
      if (provider === "gemini") {
        if (!imageBase64) {
          const imageBuffer = await getImageBuffer(imageSource, Boolean(options?.isUrl));
          imageBase64 = imageBuffer ? imageBuffer.toString("base64") : null;
        }
        if (!imageBase64) {
          throw new Error("Unable to prepare image payload for Gemini");
        }
        const response = await withRetry("gemini", async () => {
          const url = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL_VISION)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY || "")}`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: prompt },
                    {
                      inline_data: {
                        mime_type: "image/jpeg",
                        data: imageBase64,
                      },
                    },
                  ],
                },
              ],
              generationConfig: {
                maxOutputTokens: Math.max(2048, options?.maxTokens ?? 2048),
                temperature: 0.1,
                responseMimeType: "application/json",
              },
            }),
          });
          if (!res.ok) {
            const bodyText = await res.text();
            throw { status: res.status, message: bodyText || `Gemini API error ${res.status}` };
          }
          return res.json() as Promise<{
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          }>;
        });
        text = response.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") || "";
      } else if (provider === "together") {
        const response = await withRetry("together", async () => {
          const res = await fetch(TOGETHER_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
            },
            body: JSON.stringify({
              model: TOGETHER_MODEL_VISION,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: imageUrl } },
                  ],
                },
              ],
              max_tokens: options?.maxTokens ?? 256,
            }),
          });
          if (!res.ok) {
            const bodyText = await res.text();
            throw { status: res.status, message: bodyText || `Together API error ${res.status}` };
          }
          return res.json() as Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
        });
        text = response.choices?.[0]?.message?.content ?? "";
      } else {
        const response = await withRetry("groq", () =>
          groqClient.chat.completions.create({
            model: GROQ_MODEL_VISION,
            messages: [
              {
                role: "system",
                content: "You are a JSON-only API. Output raw JSON with no explanation, no markdown, no code fences.",
              },
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: imageUrl } },
                ],
              },
            ],
            max_tokens: options?.maxTokens ?? 256,
            response_format: { type: "json_object" },
          })
        );
        text = response.choices[0]?.message?.content ?? "";
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]) as T;
    } catch (error: unknown) {
      console.warn(`[Vision] ${provider} failed:`, getErrorMessage(error).slice(0, 200));
      lastError = error;
      continue;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("No vision provider configured. Set GEMINI_API_KEY, GROQ_API_KEY, or TOGETHER_API_KEY.");
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
    console.warn(`[Vision] vehicleDetect failed for ${cameraName}:`, getErrorMessage(error));
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
    console.warn(`[Vision] vehicleAttributes failed for ${cameraName}:`, getErrorMessage(error));
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
      details: parsed?.details || "Vision verification",
    };
  } catch (error: unknown) {
    console.warn(`[Vision] verifyBoloCandidate failed for ${cameraName}:`, getErrorMessage(error));
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
    console.error("Vision analysis error:", getErrorMessage(error));
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
    attributes?: VehicleAttributes;
  }>;
}

async function geminiBatchBoloScan(
  cameras: Array<{ name: string; imageUrl: string }>,
  activeBolos: Bolo[]
): Promise<BoloScanResult["matches"]> {
  const buffers = await Promise.all(
    cameras.map(async (camera) => ({
      camera,
      buffer: await getImageBuffer(camera.imageUrl, true),
    }))
  );
  const valid = buffers.filter((entry) => entry.buffer !== null);
  console.log(`[BOLO Gemini] ${valid.length}/${cameras.length} cameras have valid images`);
  if (valid.length === 0) return [];

  const boloDescription = activeBolos
    .map((b) => {
      const attrs = [b.color, b.make, b.model, b.plate ? `plate=${b.plate}` : null].filter(Boolean).join(" ");
      return `- ${b.id}: ${b.description}${attrs ? ` [${attrs}]` : ""}`;
    })
    .join("\n");

  const cIndexToName = new Map<string, string>();
  for (let i = 0; i < valid.length; i++) {
    cIndexToName.set(`C${i + 1}`, valid[i].camera.name);
    cIndexToName.set(`c${i + 1}`, valid[i].camera.name);
  }

  const cameraLines = valid
    .map((entry, idx) => `- Image ${idx + 1} = "${entry.camera.name}"`)
    .join("\n");

  const prompt = [
    "Scan traffic cameras for BOLO vehicle matches. Report the BEST match per camera (max 1 per camera).",
    "Return JSON (use exact camera name string):",
    '{"matches":[{"cameraName":"exact camera name","boloId":"id","confidence":0.0,"details":"brief","bbox":[ymin,xmin,ymax,xmax],"attributes":{"primaryColor":"color","bodyType":"type"}}]}',
    "bbox=percentage 0-100. If none: {\"matches\":[]}.",
    "BOLOs:", boloDescription,
    "Cameras:", cameraLines,
    'Car=sedan. White/silver/gray/beige count as "white" match.',
  ].join("\n");

  const response = await withRetry("gemini", async () => {
    const url = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL_VISION)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY || "")}`;
    const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [{ text: prompt }];
    for (let i = 0; i < valid.length; i++) {
      parts.push({ text: `CAMERA C${i + 1}: ${valid[i].camera.name}` });
      parts.push({
        inline_data: {
          mime_type: "image/jpeg",
          data: valid[i].buffer!.toString("base64"),
        },
      });
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text();
      throw { status: res.status, message: bodyText || `Gemini API error ${res.status}` };
    }
    return res.json() as Promise<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>;
  });

  const text = response.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") || "";
  console.log(`[BOLO Gemini] raw response (${text.length} chars): ${text.slice(0, 500)}`);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log("[BOLO Gemini] no JSON found in response");
    return [];
  }

  let parsed: ParsedBoloScanResponse | null = null;
  try {
    parsed = JSON.parse(jsonMatch[0]) as ParsedBoloScanResponse;
  } catch (e) {
    console.warn("[BOLO Gemini] JSON parse failed:", (e as Error).message);
    return [];
  }

  const cameraNames = new Set(cameras.map((c) => c.name));
  const boloIds = new Set(activeBolos.map((b) => b.id));

  const resolveCameraName = (raw?: string): string | null => {
    if (!raw) return null;
    if (cameraNames.has(raw)) return raw;
    if (cIndexToName.has(raw)) return cIndexToName.get(raw)!;
    const stripped = raw.replace(/^C\d+:\s*/, "").replace(/^Image\s+\d+\s*[:=]\s*"?/i, "").replace(/"$/, "");
    if (cameraNames.has(stripped)) return stripped;
    for (const name of cameraNames) {
      if (raw.includes(name) || name.includes(stripped)) return name;
    }
    return null;
  };

  const matches = (parsed.matches || [])
    .filter((m) => {
      const resolved = resolveCameraName(m.cameraName);
      return resolved && m.boloId && boloIds.has(m.boloId);
    })
    .map((m) => ({
      cameraName: resolveCameraName(m.cameraName) as string,
      boloId: m.boloId as string,
      confidence: Math.max(0, Math.min(1, m.confidence ?? 0.5)),
      details: m.details || "Batch visual match",
      bbox: normalizeBboxValues(m.bbox),
      attributes: m.attributes,
    }));

  return matches;
}

export async function batchBoloScan(
  cameras: Array<{ name: string; imageUrl: string }>,
  activeBolos: Bolo[]
): Promise<BoloScanResult> {
  if (cameras.length === 0 || activeBolos.length === 0) {
    return { matches: [] };
  }

  const allMatches: BoloScanResult["matches"] = [];
  const primaryProvider = getPrimaryEnabledProvider();

  if (primaryProvider === "gemini") {
    const batchSize = Number.parseInt(process.env.VISION_GEMINI_CAMERA_BATCH_SIZE || "6", 10);
    const safeBatchSize = Number.isFinite(batchSize) ? Math.max(2, Math.min(10, batchSize)) : 6;
    let allBatchesFailed = true;
    for (let i = 0; i < cameras.length; i += safeBatchSize) {
      const slice = cameras.slice(i, i + safeBatchSize);
      try {
        const matches = await geminiBatchBoloScan(slice, activeBolos);
        allMatches.push(...matches);
        allBatchesFailed = false;
      } catch (error: unknown) {
        console.warn("[BOLO] Gemini batch scan failed:", getErrorMessage(error));
      }
    }
    if (!allBatchesFailed) {
      return { matches: allMatches };
    }
    console.log("[BOLO] All Gemini batches failed, falling back to per-camera scan via secondary providers");
  }

  const boloDescription = activeBolos
    .map((b) => {
      const attrs = [b.color, b.make, b.model, b.plate ? `plate=${b.plate}` : null].filter(Boolean).join(" ");
      return `- ${b.id}: ${b.description}${attrs ? ` [${attrs}]` : ""}`;
    })
    .join("\n");

  for (let ci = 0; ci < cameras.length; ci++) {
    const camera = cameras[ci];
    try {
      console.log(`[BOLO] scanning camera ${ci + 1}/${cameras.length}: ${camera.name}`);
      const unavailable = await isLikelyUnavailableFrame(camera.imageUrl, true);
      if (unavailable) {
        console.log(`[BOLO] ${camera.name} skipped (unavailable frame)`);
        continue;
      }

      const prompt = [
        "You are a vehicle detection system scanning traffic cameras for BOLO alerts.",
        "You MUST check EVERY visible vehicle and report ANY that could possibly match. Be aggressive - false positives are OK, missed detections are NOT.",
        `Camera: "${camera.name}". Return JSON:`,
        '{"matches":[{"boloId":"string","confidence":0.0,"details":"short reason","bbox":[ymin,xmin,ymax,xmax],"attributes":{"primaryColor":"string","make":"string","model":"string","bodyType":"string"}}]}',
        "bbox is percentage 0-100. If truly no match: {\"matches\":[]}.",
        "BOLOs:", boloDescription,
        'A regular car counts as sedan. Light colored vehicles (white, silver, gray, beige) are potential matches for "white". Report with appropriate confidence.',
      ].join("\n");

      const parsed = await callVisionJson<ParsedBoloScanResponse>(prompt, camera.imageUrl, {
        isUrl: true,
        maxTokens: 400,
      });

      const boloIds = new Set(activeBolos.map((b) => b.id));
      for (const m of parsed?.matches || []) {
        if (!m.boloId || !boloIds.has(m.boloId)) continue;
        allMatches.push({
          cameraName: camera.name,
          boloId: m.boloId,
          confidence: Math.max(0, Math.min(1, m.confidence ?? 0.5)),
          details: m.details || "Visual match",
          bbox: normalizeBboxValues(m.bbox),
          attributes: m.attributes,
        });
      }
    } catch (error: unknown) {
      console.warn(`[BOLO] ${camera.name} scan failed:`, getErrorMessage(error));
    }
  }

  return { matches: allMatches };
}
