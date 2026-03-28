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

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  location: string;
}) {
  const strokeWidth = Math.max(3, Math.round(Math.min(args.width, args.height) * 0.006));
  const bracketLen = Math.max(8, Math.round(Math.min(args.rectW, args.rectH) * 0.3));

  // --- Top banner: "SUSPECT VEHICLE FOUND" ---
  const bannerHeight = Math.max(32, Math.round(args.height * 0.06));
  const bannerFontSize = Math.max(14, Math.round(bannerHeight * 0.45));

  // --- Label pill above bounding box ---
  const confText = `${(args.confidence * 100).toFixed(0)}% MATCH`;
  const confWidth = Math.max(90, Math.round(confText.length * 8));
  const confHeight = 20;
  let confX = Math.max(0, args.cx - confWidth / 2);
  if (confX + confWidth > args.width) confX = args.width - confWidth;
  let confY = args.rectY - confHeight - 8;
  if (confY < bannerHeight + 4) confY = args.rectY + args.rectH + 8;

  // --- Bottom bar: location/address ---
  const bottomBarHeight = Math.max(28, Math.round(args.height * 0.05));
  const bottomFontSize = Math.max(11, Math.round(bottomBarHeight * 0.42));
  const locationText = escapeXml(args.location || "Unknown Location");
  const timestampText = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

  return `
  <svg width="${args.width}" height="${args.height}" xmlns="http://www.w3.org/2000/svg">
    <!-- Top banner -->
    <rect x="0" y="0" width="${args.width}" height="${bannerHeight}" fill="#000000" opacity="0.85" />
    <rect x="0" y="0" width="6" height="${bannerHeight}" fill="#FFD600" />
    <text x="${16}" y="${bannerHeight * 0.65}" fill="#FFD600" font-size="${bannerFontSize}"
          font-weight="bold" font-family="Arial, sans-serif" letter-spacing="2">⚠ SUSPECT VEHICLE FOUND</text>
    <text x="${args.width - 10}" y="${bannerHeight * 0.65}" fill="#ffffff" font-size="${Math.round(bannerFontSize * 0.7)}"
          font-family="Arial, sans-serif" text-anchor="end" opacity="0.6">${(args.confidence * 100).toFixed(0)}% CONFIDENCE</text>

    <!-- Yellow bounding box -->
    <rect x="${args.rectX}" y="${args.rectY}" width="${args.rectW}" height="${args.rectH}"
          fill="none" stroke="#FFD600" stroke-width="${strokeWidth}" rx="2" />
    <!-- Glow effect -->
    <rect x="${args.rectX}" y="${args.rectY}" width="${args.rectW}" height="${args.rectH}"
          fill="none" stroke="#FFD600" stroke-width="${strokeWidth + 4}" rx="2" opacity="0.25" />

    <!-- Corner brackets -->
    <polyline points="${args.rectX},${args.rectY + bracketLen} ${args.rectX},${args.rectY} ${args.rectX + bracketLen},${args.rectY}"
              fill="none" stroke="#ffffff" stroke-width="${strokeWidth + 1}" />
    <polyline points="${args.rectX + args.rectW - bracketLen},${args.rectY} ${args.rectX + args.rectW},${args.rectY} ${args.rectX + args.rectW},${args.rectY + bracketLen}"
              fill="none" stroke="#ffffff" stroke-width="${strokeWidth + 1}" />
    <polyline points="${args.rectX + args.rectW},${args.rectY + args.rectH - bracketLen} ${args.rectX + args.rectW},${args.rectY + args.rectH} ${args.rectX + args.rectW - bracketLen},${args.rectY + args.rectH}"
              fill="none" stroke="#ffffff" stroke-width="${strokeWidth + 1}" />
    <polyline points="${args.rectX + bracketLen},${args.rectY + args.rectH} ${args.rectX},${args.rectY + args.rectH} ${args.rectX},${args.rectY + args.rectH - bracketLen}"
              fill="none" stroke="#ffffff" stroke-width="${strokeWidth + 1}" />

    <!-- Confidence pill above box -->
    <rect x="${confX}" y="${confY}" width="${confWidth}" height="${confHeight}"
          fill="#FFD600" rx="3" opacity="0.95" />
    <text x="${confX + confWidth / 2}" y="${confY + 14}" fill="#000000" font-size="11"
          font-weight="bold" font-family="Arial, sans-serif" text-anchor="middle">${confText}</text>

    <!-- Bottom bar with location -->
    <rect x="0" y="${args.height - bottomBarHeight}" width="${args.width}" height="${bottomBarHeight}" fill="#000000" opacity="0.85" />
    <rect x="0" y="${args.height - bottomBarHeight}" width="${args.width}" height="2" fill="#FFD600" opacity="0.8" />
    <text x="10" y="${args.height - bottomBarHeight + bottomBarHeight * 0.65}" fill="#FFD600" font-size="${bottomFontSize}"
          font-weight="bold" font-family="Arial, sans-serif">📍 ${locationText}</text>
    <text x="${args.width - 10}" y="${args.height - bottomBarHeight + bottomBarHeight * 0.65}" fill="#ffffff" font-size="${Math.round(bottomFontSize * 0.85)}"
          font-family="Arial, sans-serif" text-anchor="end" opacity="0.5">${timestampText}</text>
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
  const label = (searchParams.get("label") || "SUSPECT VEHICLE FOUND").slice(0, 40);
  const cameraId = searchParams.get("cameraId") || "unknown-camera";
  const cameraName = searchParams.get("cameraName") || "Unknown Camera";
  const location = searchParams.get("location") || cameraName;
  const frameCapturedAt = new Date().toISOString();

  const dir = proofsDir();
  const rawPath = id ? path.join(dir, `${id}-raw.jpg`) : null;
  const annotatedPath = id ? path.join(dir, `${id}-annotated.jpg`) : null;
  const metadataPath = id ? path.join(dir, `${id}.json`) : null;

  try {
    // Serve cached annotated image if it already exists (frozen proof)
    if (annotatedPath && fs.existsSync(annotatedPath) && mode !== "raw") {
      const cached = fs.readFileSync(annotatedPath);
      return imageResponse(cached);
    }

    if (mode === "raw" && rawPath && fs.existsSync(rawPath)) {
      const raw = fs.readFileSync(rawPath);
      return imageResponse(raw);
    }

    if (!imageUrl && !rawPath) {
      return NextResponse.json({ error: "Missing url or id parameter" }, { status: 400 });
    }

    // Also check for legacy {id}.jpg (no -raw suffix)
    const legacyPath = id ? path.join(dir, `${id}.jpg`) : null;

    let imageBuffer: Buffer;
    if (rawPath && fs.existsSync(rawPath)) {
      imageBuffer = fs.readFileSync(rawPath);
    } else if (legacyPath && fs.existsSync(legacyPath)) {
      imageBuffer = fs.readFileSync(legacyPath);
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
        location,
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
