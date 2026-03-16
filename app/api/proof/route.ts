import { NextResponse } from "next/server";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { BoloProofMetadata } from "@/lib/types";

export const dynamic = "force-dynamic";

function proofsDir(): string {
  const dir = path.join(process.cwd(), "proofs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function parseBbox(params: URLSearchParams, width: number, height: number): {
  bbox?: [number, number, number, number];
  rectX: number;
  rectY: number;
  rectW: number;
  rectH: number;
  cx: number;
  cy: number;
  radius: number;
} {
  const bboxParam = params.get("bbox");
  const xParam = params.get("x");
  const yParam = params.get("y");
  let bbox: [number, number, number, number] | undefined;
  let rectX = 0;
  let rectY = 0;
  let rectW = 0;
  let rectH = 0;

  if (bboxParam) {
    const parts = bboxParam.split(",").map((p) => Number.parseFloat(p));
    if (parts.length === 4 && parts.every((p) => Number.isFinite(p))) {
      bbox = [parts[0], parts[1], parts[2], parts[3]];
      rectX = Math.round((parts[1] / 100) * width);
      rectY = Math.round((parts[0] / 100) * height);
      rectW = Math.max(1, Math.round(((parts[3] - parts[1]) / 100) * width));
      rectH = Math.max(1, Math.round(((parts[2] - parts[0]) / 100) * height));
    }
  } else if (xParam && yParam) {
    const x = Number.parseFloat(xParam);
    const y = Number.parseFloat(yParam);
    const fallbackRadius = 10;
    bbox = [y - fallbackRadius, x - fallbackRadius, y + fallbackRadius, x + fallbackRadius];
    rectX = Math.round(((x - fallbackRadius) / 100) * width);
    rectY = Math.round(((y - fallbackRadius) / 100) * height);
    rectW = Math.max(1, Math.round(((fallbackRadius * 2) / 100) * width));
    rectH = Math.max(1, Math.round(((fallbackRadius * 2) / 100) * height));
  }

  // Derive circle from bbox — fits tightly around the detection
  const cx = rectX + rectW / 2;
  const cy = rectY + rectH / 2;
  const radius = Math.max(12, Math.round(Math.max(rectW, rectH) / 2 * 1.15));

  return { bbox, rectX, rectY, rectW, rectH, cx, cy, radius };
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
}) {
  const strokeWidth = Math.max(2, Math.round(Math.min(args.width, args.height) * 0.005));
  const labelText = `${args.label} ${(args.confidence * 100).toFixed(0)}%`;
  const labelWidth = Math.max(130, Math.round(labelText.length * 8));
  const labelHeight = 22;

  // Position label above the rect, but keep it on screen
  let labelX = Math.max(0, args.cx - labelWidth / 2);
  if (labelX + labelWidth > args.width) labelX = args.width - labelWidth;
  let labelY = args.rectY - labelHeight - 6;
  if (labelY < 0) labelY = args.rectY + args.rectH + 6;

  // Corner bracket length (proportional to rect size)
  const bracketLen = Math.max(6, Math.round(Math.min(args.rectW, args.rectH) * 0.3));

  return `
  <svg width="${args.width}" height="${args.height}">
    <!-- Detection rectangle -->
    <rect x="${args.rectX}" y="${args.rectY}" width="${args.rectW}" height="${args.rectH}"
          fill="none" stroke="#ff3333" stroke-width="${strokeWidth}" rx="2" />

    <!-- Corner brackets for emphasis -->
    <polyline points="${args.rectX},${args.rectY + bracketLen} ${args.rectX},${args.rectY} ${args.rectX + bracketLen},${args.rectY}"
              fill="none" stroke="#ffcc00" stroke-width="${strokeWidth + 1}" />
    <polyline points="${args.rectX + args.rectW - bracketLen},${args.rectY} ${args.rectX + args.rectW},${args.rectY} ${args.rectX + args.rectW},${args.rectY + bracketLen}"
              fill="none" stroke="#ffcc00" stroke-width="${strokeWidth + 1}" />
    <polyline points="${args.rectX + args.rectW},${args.rectY + args.rectH - bracketLen} ${args.rectX + args.rectW},${args.rectY + args.rectH} ${args.rectX + args.rectW - bracketLen},${args.rectY + args.rectH}"
              fill="none" stroke="#ffcc00" stroke-width="${strokeWidth + 1}" />
    <polyline points="${args.rectX + bracketLen},${args.rectY + args.rectH} ${args.rectX},${args.rectY + args.rectH} ${args.rectX},${args.rectY + args.rectH - bracketLen}"
              fill="none" stroke="#ffcc00" stroke-width="${strokeWidth + 1}" />

    <!-- Label pill -->
    <rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}"
          fill="#ff3333" rx="3" opacity="0.92" />
    <text x="${labelX + labelWidth / 2}" y="${labelY + 15}" fill="white" font-size="11"
          font-weight="bold" font-family="Arial, sans-serif" text-anchor="middle">${labelText}</text>
  </svg>`;
}

function imageResponse(imageBuffer: Buffer) {
  return new NextResponse(new Uint8Array(imageBuffer), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-cache",
    },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const mode = searchParams.get("mode");
  const imageUrl = searchParams.get("url");
  const confidence = Math.max(0, Math.min(1, Number.parseFloat(searchParams.get("confidence") || "0.5")));
  const label = (searchParams.get("label") || "BOLO MATCH").slice(0, 40);
  const cameraId = searchParams.get("cameraId") || "unknown-camera";
  const cameraName = searchParams.get("cameraName") || "Unknown Camera";
  const frameCapturedAt = new Date().toISOString();

  const dir = proofsDir();
  const rawPath = id ? path.join(dir, `${id}-raw.jpg`) : null;
  const annotatedPath = id ? path.join(dir, `${id}-annotated.jpg`) : null;
  const metadataPath = id ? path.join(dir, `${id}.json`) : null;

  try {
    if (mode === "raw" && rawPath && fs.existsSync(rawPath)) {
      const raw = fs.readFileSync(rawPath);
      return imageResponse(raw);
    }

    if (!imageUrl && !rawPath) {
      return NextResponse.json({ error: "Missing url or id parameter" }, { status: 400 });
    }

    let imageBuffer: Buffer;
    if (rawPath && fs.existsSync(rawPath)) {
      imageBuffer = fs.readFileSync(rawPath);
    } else if (imageUrl) {
      const response = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 });
      }
      imageBuffer = Buffer.from(await response.arrayBuffer());
      if (rawPath) {
        fs.writeFileSync(rawPath, imageBuffer);
      }
    } else {
      return NextResponse.json({ error: "Proof image not found" }, { status: 404 });
    }

    if (imageBuffer.length < 10000) {
      return NextResponse.json({ error: "Image unavailable" }, { status: 404 });
    }

    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 640;
    const height = metadata.height || 480;
    const { bbox, rectX, rectY, rectW, rectH, cx, cy, radius } = parseBbox(searchParams, width, height);

    let annotated: Buffer;
    const hasBbox = rectW > 0 && rectH > 0;
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
        label,
        confidence,
      });
      annotated = await sharp(imageBuffer)
        .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
        .jpeg({ quality: 88 })
        .toBuffer();
    } else {
      annotated = await sharp(imageBuffer).jpeg({ quality: 88 }).toBuffer();
    }

    const imageHash = crypto.createHash("sha256").update(imageBuffer).digest("hex");
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
        label,
        confidence,
      },
    };

    if (annotatedPath) {
      fs.writeFileSync(annotatedPath, annotated);
    }
    if (metadataPath) {
      fs.writeFileSync(metadataPath, JSON.stringify(proofMetadata, null, 2), "utf8");
    }

    return imageResponse(annotated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Proof] Error:", message);
    return NextResponse.json({ error: "Failed to process image" }, { status: 500 });
  }
}
