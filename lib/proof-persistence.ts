import sharp from "sharp";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { BoloProofMetadata } from "./types";

export function proofsDir(): string {
  const dir = path.join(process.cwd(), "proofs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function parseBboxFromParams(
  bbox: [number, number, number, number] | undefined,
  width: number,
  height: number
): { rectX: number; rectY: number; rectW: number; rectH: number; cx: number; cy: number; radius: number } {
  if (!bbox || bbox.length !== 4) {
    return { rectX: 0, rectY: 0, rectW: 0, rectH: 0, cx: 0, cy: 0, radius: 12 };
  }
  const rectX = Math.round((bbox[1] / 100) * width);
  const rectY = Math.round((bbox[0] / 100) * height);
  const rectW = Math.max(1, Math.round(((bbox[3] - bbox[1]) / 100) * width));
  const rectH = Math.max(1, Math.round(((bbox[2] - bbox[0]) / 100) * height));
  const cx = rectX + rectW / 2;
  const cy = rectY + rectH / 2;
  const radius = Math.max(12, Math.round(Math.max(rectW, rectH) / 2 * 1.15));
  return { rectX, rectY, rectW, rectH, cx, cy, radius };
}

function buildOverlaySvg(args: {
  width: number;
  height: number;
  rectX: number;
  rectY: number;
  rectW: number;
  rectH: number;
  cx: number;
  cy: number;
  radius: number;
  label: string;
  confidence: number;
}): string {
  const strokeWidth = Math.max(2, Math.round(Math.min(args.width, args.height) * 0.005));
  const labelText = `${args.label} ${(args.confidence * 100).toFixed(0)}%`;
  const labelWidth = Math.max(130, Math.round(labelText.length * 8));
  const labelHeight = 22;
  let labelX = Math.max(0, args.cx - labelWidth / 2);
  if (labelX + labelWidth > args.width) labelX = args.width - labelWidth;
  let labelY = args.rectY - labelHeight - 6;
  if (labelY < 0) labelY = args.rectY + args.rectH + 6;
  const bracketLen = Math.max(6, Math.round(Math.min(args.rectW, args.rectH) * 0.3));
  return `
  <svg width="${args.width}" height="${args.height}">
    <rect x="${args.rectX}" y="${args.rectY}" width="${args.rectW}" height="${args.rectH}"
          fill="none" stroke="#ff3333" stroke-width="${strokeWidth}" rx="2" />
    <polyline points="${args.rectX},${args.rectY + bracketLen} ${args.rectX},${args.rectY} ${args.rectX + bracketLen},${args.rectY}"
              fill="none" stroke="#ffcc00" stroke-width="${strokeWidth + 1}" />
    <polyline points="${args.rectX + args.rectW - bracketLen},${args.rectY} ${args.rectX + args.rectW},${args.rectY} ${args.rectX + args.rectW},${args.rectY + bracketLen}"
              fill="none" stroke="#ffcc00" stroke-width="${strokeWidth + 1}" />
    <polyline points="${args.rectX + args.rectW},${args.rectY + args.rectH - bracketLen} ${args.rectX + args.rectW},${args.rectY + args.rectH} ${args.rectX + args.rectW - bracketLen},${args.rectY + args.rectH}"
              fill="none" stroke="#ffcc00" stroke-width="${strokeWidth + 1}" />
    <polyline points="${args.rectX + bracketLen},${args.rectY + args.rectH} ${args.rectX},${args.rectY + args.rectH} ${args.rectX},${args.rectY + args.rectH - bracketLen}"
              fill="none" stroke="#ffcc00" stroke-width="${strokeWidth + 1}" />
    <rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}"
          fill="#ff3333" rx="3" opacity="0.92" />
    <text x="${labelX + labelWidth / 2}" y="${labelY + 15}" fill="white" font-size="11"
          font-weight="bold" font-family="Arial, sans-serif" text-anchor="middle">${labelText}</text>
  </svg>`;
}

export interface PersistProofParams {
  sightingId: string;
  imageUrl?: string;
  imageBuffer?: Buffer;
  cameraId: string;
  cameraName: string;
  confidence: number;
  label?: string;
  bbox?: [number, number, number, number];
  frameCapturedAt?: string;
}

/**
 * Persist BOLO proof screenshot to disk (raw, annotated, metadata).
 * Call this immediately when recording a sighting to capture the exact frame.
 */
export async function persistProof(params: PersistProofParams): Promise<boolean> {
  const {
    sightingId,
    imageUrl,
    imageBuffer,
    cameraId,
    cameraName,
    confidence,
    label = "BOLO MATCH",
    bbox,
    frameCapturedAt = new Date().toISOString(),
  } = params;

  const dir = proofsDir();
  const rawPath = path.join(dir, `${sightingId}-raw.jpg`);
  const annotatedPath = path.join(dir, `${sightingId}-annotated.jpg`);
  const metadataPath = path.join(dir, `${sightingId}.json`);

  try {
    let buffer: Buffer;
    if (imageBuffer && imageBuffer.length >= 10000) {
      buffer = imageBuffer;
    } else if (imageUrl) {
      const response = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        console.warn("[Proof] Failed to fetch image for persistence:", response.status);
        return false;
      }
      buffer = Buffer.from(await response.arrayBuffer());
    } else {
      console.warn("[Proof] No image source for persistence");
      return false;
    }

    if (buffer.length < 10000) {
      console.warn("[Proof] Image too small to persist:", buffer.length);
      return false;
    }

    fs.writeFileSync(rawPath, buffer);

    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 640;
    const height = metadata.height || 480;
    const { rectX, rectY, rectW, rectH, cx, cy, radius } = parseBboxFromParams(bbox, width, height);

    const hasBbox = rectW > 0 && rectH > 0;
    let annotated: Buffer;
    if (hasBbox) {
      const overlaySvg = buildOverlaySvg({
        width,
        height,
        rectX,
        rectY,
        rectW,
        rectH,
        cx,
        cy,
        radius,
        label: label.slice(0, 40),
        confidence,
      });
      annotated = await sharp(buffer)
        .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
        .jpeg({ quality: 88 })
        .toBuffer();
    } else {
      annotated = await sharp(buffer).jpeg({ quality: 88 }).toBuffer();
    }

    const imageHash = crypto.createHash("sha256").update(buffer).digest("hex");
    const proofMetadata: BoloProofMetadata = {
      imageHash,
      cameraId,
      cameraName,
      frameCapturedAt,
      overlay: {
        bbox: bbox || [0, 0, 0, 0],
        circle: {
          cx: Number(((cx / width) * 100).toFixed(2)),
          cy: Number(((cy / height) * 100).toFixed(2)),
          radius: Number(((radius / Math.min(width, height)) * 100).toFixed(2)),
        },
        label: label.slice(0, 40),
        confidence,
      },
    };

    fs.writeFileSync(annotatedPath, annotated);
    fs.writeFileSync(metadataPath, JSON.stringify(proofMetadata, null, 2), "utf8");
    console.log(`[Proof] Persisted sighting ${sightingId} to ${dir}`);
    return true;
  } catch (err) {
    console.error("[Proof] Persistence failed:", err);
    return false;
  }
}
