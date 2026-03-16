import { CameraInfo } from "./types";
import { execSync } from "child_process";
import fs from "fs";

// SF Downtown/SoMa bounding box - tighter focus near YC office
const SF_DOWNTOWN_BOUNDS = { minLat: 37.70, maxLat: 37.82, minLng: -122.45, maxLng: -122.38 };

// Wider Bay Area for fallback
const SF_BAY_BOUNDS = { minLat: 37.6, maxLat: 37.86, minLng: -122.55, maxLng: -122.3 };

// YC office location for distance sorting
const YC_OFFICE = { lat: 37.7604, lng: -122.3886 };

// Cameras known to have higher-res HLS streams (probed 2026-03-11)
const HD_STREAMS = new Set([
  "S101_NOF_84_Woodside_Rd",  // 1280x720
  "W580_Upper_Deck_Pier_47",  // 720x480
  "S101_at_Whipple_Av",       // 720x480
  "N101_at_Spencer_Av",       // 720x480
  "N101_at_Faith_St_POC",     // 720x480
  "W80_at_SAS_Tower",         // 655x480
  "W80_at_Fremont_St_Ofr",    // 640x480
]);

// ── Dynamic camera loading from Caltrans API ──

const CALTRANS_D4_URL = "https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json";

let _cameras: CameraInfo[] | null = null;
let _fetchPromise: Promise<CameraInfo[]> | null = null;
let _lastSortLogTs = 0;
let _lastSortLogCount = -1;
const SORT_LOG_INTERVAL_MS = 120000;

const SUPPLEMENTAL_CAMERAS: CameraInfo[] = [
  {
    id: "tvr20i580wofmainst",
    name: "I-580 : W of Main St (San Rafael)",
    lat: 37.9479,
    lng: -122.4951,
    imageUrl: "https://webapi.511.org/api-proxy/api/v1/traffic/image/tvr20i580wofmainst/tvr20i580wofmainst.jpg",
  },
  {
    id: "tvr45i580attollplaza",
    name: "TVR45 : I-580 : At Toll Plaza",
    lat: 37.931835,
    lng: -122.401274,
    imageUrl: "https://webapi.511.org/api-proxy/api/v1/traffic/image/tvr45i580attollplaza/tvr45i580attollplaza.jpg",
  },
  {
    id: "tvr44i580lowerdeckpier77",
    name: "TVR44 : I-580 : Lower Deck Pier 77",
    lat: 37.932233,
    lng: -122.40542,
    imageUrl: "https://webapi.511.org/api-proxy/api/v1/traffic/image/tvr44i580lowerdeckpier77/tvr44i580lowerdeckpier77.jpg",
  },
  {
    id: "tvr42i580lowerdeckpier59",
    name: "TVR42 : I-580 : Lower Deck Pier 59",
    lat: 37.932975,
    lng: -122.413297,
    imageUrl: "https://webapi.511.org/api-proxy/api/v1/traffic/image/tvr42i580lowerdeckpier59/tvr42i580lowerdeckpier59.jpg",
  },
  {
    id: "tvr41i580lowerdeckpier57",
    name: "TVR41 : I-580 : Lower Deck Pier 57",
    lat: 37.933106,
    lng: -122.415318,
    imageUrl: "https://webapi.511.org/api-proxy/api/v1/traffic/image/tvr41i580lowerdeckpier57/tvr41i580lowerdeckpier57.jpg",
  },
  {
    id: "tvr40i580lowerdeckpier54",
    name: "TVR40 : I-580 : Lower Deck Pier 54",
    lat: 37.933312,
    lng: -122.418339,
    imageUrl: "https://webapi.511.org/api-proxy/api/v1/traffic/image/tvr40i580lowerdeckpier54/tvr40i580lowerdeckpier54.jpg",
  },
  {
    id: "tvr02i580upperdeckpier48",
    name: "TVR02 : I-580 : Upper Deck Pier 48",
    lat: 37.93389,
    lng: -122.42528,
    imageUrl: "https://webapi.511.org/api-proxy/api/v1/traffic/image/tvr02i580upperdeckpier48/tvr02i580upperdeckpier48.jpg",
  },
];

const EXCLUDED_CAMERA_IDS = new Set([
  "tvd22i80sfobblowerdecksterlingonramp",
  "tvd36i80sfobbatincline",
  "tv301us101atoctaviast",
  "tv302us10117thstreet",
  "tv311us101athospitalcurve",
  "tv312us101atcesarchavezbl",
  "tv403us101justnorthoflagoonway",
  "tv320i280onmontereybl",
  "tv321i280atalemanybl",
  "tv323i280atsicklesav",
  "tv325i280justsouthofcesarchavez",
  "tv326i280justsouthofcesarchavez",
  "tv327i280johndalyblvd",
  "tv388sr1justsouthofpresidiotunnel",
  "tv407us101justnorthofi380",
  "tv409us101sanbrunoavenue",
  "tvb84i280serramonteblvdnorthboundonramp",
  "tvr46i580atmarinest",
  "tvr11i580eofmainst",
  "tvr43i580lowerdeckpier66",
  "tvr01i580upperdeckpier59",
  "tvr39i580lowerdeckpier52",
  "tvr38i580lowerdeckpier49",
  "tvr03i580upperdecktrusstowerpier48",
]);

const EXCLUDED_CAMERA_NAME_PARTS = [
  "i-80 : sfobb sterling onramp",
  "i-80 : sfobb at incline",
  "us-101 : octavia st",
  "us-101 : at octavia st",
  "us-101 : 17th street",
  "us-101 : at hospital curve",
  "us-101 : hospital curve",
  "us-101 : cesar chavez",
  "us-101 : at cesar chavez",
  "us-101 : n of lagoon way",
  "i-280 : monterey bl",
  "i-280 : alemany bl",
  "i-280 : at sickles av",
  "i-280 : sickles ave",
  "i-280 : just south of cesar chavez",
  "i-280 : s of cesar chavez",
  "i-280 : john daly bl",
  "sr-1 : presidio tunnel",
  "us-101 : just north of i-380",
  "us-101 : n of i-380",
  "us-101 : san bruno avenue",
  "us-101 : san bruno ave",
  "i-280 : serramonte blvd northbound onr",
  "i-280 : serramonte nb onramp",
];

function isExcludedCamera(id: string, name: string): boolean {
  if (EXCLUDED_CAMERA_IDS.has(id)) return true;
  const normalizedName = name.toLowerCase().trim();
  return EXCLUDED_CAMERA_NAME_PARTS.some((part) => normalizedName.includes(part));
}

function filterExcludedCameras(cameras: CameraInfo[]): CameraInfo[] {
  return cameras.filter((camera) => !isExcludedCamera(camera.id, camera.name));
}

function withDistanceToYC(camera: CameraInfo): CameraInfo & { distanceToYC: number } {
  return {
    ...camera,
    distanceToYC: haversineDistance(camera.lat, camera.lng, YC_OFFICE.lat, YC_OFFICE.lng),
  };
}

function sortCamerasByDistance(cameras: Array<CameraInfo & { distanceToYC?: number }>): CameraInfo[] {
  cameras.sort((a, b) => (a.distanceToYC || 999) - (b.distanceToYC || 999));
  const now = Date.now();
  if (
    cameras.length !== _lastSortLogCount ||
    now - _lastSortLogTs > SORT_LOG_INTERVAL_MS
  ) {
    console.log(
      `[Cameras] Sorted ${cameras.length} cameras by distance to YC. Closest: ${cameras[0]?.name} (${cameras[0]?.distanceToYC?.toFixed(2)} mi)`
    );
    _lastSortLogTs = now;
    _lastSortLogCount = cameras.length;
  }
  return cameras;
}

function mergeSupplementalCameras(cameras: CameraInfo[]): CameraInfo[] {
  const merged = new Map<string, CameraInfo & { distanceToYC?: number }>();

  for (const camera of cameras) {
    merged.set(camera.id, withDistanceToYC(camera));
  }

  for (const camera of SUPPLEMENTAL_CAMERAS) {
    if (!merged.has(camera.id)) {
      merged.set(camera.id, withDistanceToYC(camera));
    }
  }

  return sortCamerasByDistance(Array.from(merged.values()));
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function parseCaltransCameras(data: any): CameraInfo[] {
  const arr = Array.isArray(data.data || data) ? (data.data || data) : Object.values(data.data || data);
  const cameras: CameraInfo[] = [];

  for (const entry of arr) {
    const cc = entry.cctv;
    if (!cc || cc.inService !== "true") continue;

    const lat = parseFloat(cc.location?.latitude);
    const lng = parseFloat(cc.location?.longitude);
    if (isNaN(lat) || isNaN(lng)) continue;

    // Filter to Bay Area first
    if (lat < SF_BAY_BOUNDS.minLat || lat > SF_BAY_BOUNDS.maxLat || lng < SF_BAY_BOUNDS.minLng || lng > SF_BAY_BOUNDS.maxLng) continue;

    const imgUrl = cc.imageData?.static?.currentImageURL || "";
    const streamUrl = cc.imageData?.streamingVideoURL || "";
    if (!imgUrl) continue;

    const slug = imgUrl.match(/image\/([^/]+)/)?.[1] || "";
    const name = (cc.location?.locationName || "").replace(/^TV\w+ -- /, "");
    const id = slug || `cam_${cc.index}`;
    if (isExcludedCamera(id, name)) continue;
    cameras.push({
      id,
      name,
      lat,
      lng,
      imageUrl: imgUrl,
      streamUrl: streamUrl || undefined,
    });
  }

  return mergeSupplementalCameras(cameras);
}

// Track cameras that returned "temporarily unavailable" 
const unavailableCameras = new Set<string>();

export function markCameraUnavailable(cameraId: string): void {
  unavailableCameras.add(cameraId);
}

/** Check if camera image is valid (not a placeholder) */
async function validateCameraImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { 
      method: 'HEAD',
      signal: AbortSignal.timeout(5000) 
    });
    if (!res.ok) return false;

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const isImage = contentType.includes("image/");

    // 511 proxy images can be lower byte-size but still valid live frames.
    if (url.includes("webapi.511.org/api-proxy/api/v1/traffic/image/")) {
      return isImage || contentType.length === 0;
    }

    const contentLength = parseInt(res.headers.get('content-length') || '0');
    // Images < 20KB are "temporarily unavailable" placeholders
    return isImage && contentLength > 20000;
  } catch {
    return false;
  }
}

async function fetchCaltransCameras(): Promise<CameraInfo[]> {
  try {
    const res = await fetch(CALTRANS_D4_URL, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    const cameras = parseCaltransCameras(data);

    // Recompute unavailable state from scratch on each camera refresh.
    unavailableCameras.clear();

    // Validate all cameras so unavailable feeds never appear in the list.
    console.log(`[Cameras] Validating ${cameras.length} cameras...`);
    const validationResults = await Promise.allSettled(
      cameras.map(async (cam) => {
        const isValid = await validateCameraImage(cam.imageUrl);
        return { cam, isValid };
      })
    );
    
    const validCameras: CameraInfo[] = [];
    const invalidCount = { count: 0 };
    
    for (const result of validationResults) {
      if (result.status === 'fulfilled') {
        if (result.value.isValid) {
          validCameras.push(result.value.cam);
        } else {
          unavailableCameras.add(result.value.cam.id);
          invalidCount.count++;
        }
      }
    }

    console.log(`[Cameras] ${validCameras.length} valid, ${invalidCount.count} unavailable`);
    
    if (validCameras.length > 0) {
      return mergeSupplementalCameras(validCameras);
    }
  } catch (e) {
    console.warn("[Cameras] Caltrans API fetch failed, using hardcoded fallback:", e);
  }
  return mergeSupplementalCameras(filterExcludedCameras(FALLBACK_CAMERAS));
}

/** Get only cameras with working feeds */
export function getWorkingCameras(): CameraInfo[] {
  const all = getCameras();
  return all.filter(cam => !unavailableCameras.has(cam.id));
}

/** Initialize cameras — call once at startup */
export async function loadCameras(): Promise<CameraInfo[]> {
  if (_cameras) return _cameras;
  if (!_fetchPromise) {
    _fetchPromise = fetchCaltransCameras().then((cams) => {
      _cameras = cams;
      return cams;
    });
  }
  return _fetchPromise;
}

/** Get cameras synchronously (returns fallback if not yet loaded) */
export function getCameras(): CameraInfo[] {
  return _cameras || FALLBACK_SORTED_CAMERAS;
}

// Alias for backward compat (getter to avoid hoisting issue)
export function getSFCameras(): CameraInfo[] { return getCameras(); }

// ── Image fetching ──

/**
 * Grab a frame from the HLS video stream via ffmpeg (higher res than JPEG snapshots).
 * Falls back to the low-res JPEG snapshot if ffmpeg fails.
 */
export async function fetchCameraImage(camera: CameraInfo): Promise<string | null> {
  // Try HLS frame capture first (significantly higher resolution)
  if (camera.streamUrl) {
    try {
      const tmpFile = `/tmp/cam_frame_${camera.id}_${Date.now()}.jpg`;
      execSync(
        `ffmpeg -y -i "${camera.streamUrl}" -frames:v 1 -q:v 2 -update 1 "${tmpFile}" 2>/dev/null`,
        { timeout: 12000 }
      );
      if (fs.existsSync(tmpFile)) {
        const buffer = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);
        if (buffer.length > 1000) {
          return buffer.toString("base64");
        }
      }
    } catch {
      // ffmpeg failed, fall through to JPEG
    }
  }

  // Fallback: low-res JPEG snapshot
  try {
    const response = await fetch(camera.imageUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Camera] ${camera.id} fetch failed: ${msg}`);
    return null;
  }
}

/** Get cameras sorted by stream resolution (best first) for BOLO scanning */
export function getHDCamerasFirst(): CameraInfo[] {
  const all = getCameras();
  const hd: CameraInfo[] = [];
  const sd: CameraInfo[] = [];
  for (const cam of all) {
    const streamName = cam.streamUrl?.match(/D4\/([^.]+)\.stream/)?.[1];
    if (streamName && HD_STREAMS.has(streamName)) {
      hd.push(cam);
    } else {
      sd.push(cam);
    }
  }
  return [...hd, ...sd];
}

// ── Hardcoded fallback (subset, used if API fails) ──

function cam(id: string, name: string, lat: number, lng: number, slug: string, stream: string): CameraInfo {
  return {
    id, name, lat, lng,
    imageUrl: `https://cwwp2.dot.ca.gov/data/d4/cctv/image/${slug}/${slug}.jpg`,
    streamUrl: `https://wzmedia.dot.ca.gov/D4/${stream}.stream/playlist.m3u8`,
  };
}

const FALLBACK_CAMERAS: CameraInfo[] = [
  // I-80 / Bay Bridge
  cam("tv304i80us101",  "I-80 : US-101",                    37.7703, -122.4055, "tv304i80us101", "E80_at_JCT_101"),
  cam("tv316i806thstreet",  "I-80 : 6th Street",            37.7770, -122.4035, "tv316i806thstreet", "E80_at_6th_St"),
  cam("tvd01i80fremont",  "I-80 : Fremont",                 37.7854, -122.3924, "tvd01i80fremont", "W80_at_Fremont_St_Ofr"),
  cam("tvd22i80sfobblowerdecksterlingonramp",  "I-80 : SFOBB Sterling Onramp", 37.7843, -122.3934, "tvd22i80sfobblowerdecksterlingonramp", "E80_at_Lower_Deck_Bryant_St_OR"),
  cam("tvd32i80baybridgesastowereast",  "I-80 : Bay Bridge SAS Tower East", 37.8153, -122.3586, "tvd32i80baybridgesastowereast", "W80_at_SAS_Tower"),
  cam("tvd33i80baybridgesastowerwest",  "I-80 : Bay Bridge SAS Tower West", 37.8153, -122.3586, "tvd33i80baybridgesastowerwest", "E80_at_SAS_Tower"),
  cam("tvd36i80sfobbatincline",  "I-80 : SFOBB at Incline", 37.8222, -122.3252, "tvd36i80sfobbatincline", "W80_at_SFOBB_Incline"),
  // US-101 in SF
  cam("tv301us101atoctaviast",  "US-101 : Octavia St",      37.7715, -122.4232, "tv301us101atoctaviast", "S101_at_Octavia_St"),
  cam("tv302us10117thstreet",  "US-101 : 17th Street",      37.7643, -122.4052, "tv302us10117thstreet", "S101_at_17th_St"),
  cam("tv303us101s101atsvannessav",  "US-101 : S Van Ness",  37.7700, -122.4198, "tv303us101s101atsvannessav", "S101_at_S_Van_Ness_Av"),
  cam("tv310us101atfaithstpoc",  "US-101 : Faith St POC",   37.7438, -122.4056, "tv310us101atfaithstpoc", "N101_at_Faith_St_POC"),
  cam("tv311us101athospitalcurve",  "US-101 : Hospital Curve", 37.7594, -122.4068, "tv311us101athospitalcurve", "S101_at_Hospital_Curve"),
  cam("tv312us101atcesarchavezbl",  "US-101 : Cesar Chavez", 37.7482, -122.4043, "tv312us101atcesarchavezbl", "S101_at_Cesar_Chavez_Bl"),
  cam("tv313us101at23rdst",  "US-101 : 23rd St",            37.7546, -122.4026, "tv313us101at23rdst", "N101_at_23rd_St"),
  cam("tv305us101justnorthofcandlestickpark",  "US-101 : N of Candlestick", 37.7107, -122.3953, "tv305us101justnorthofcandlestickpark", "N101_at_Candlestick_Park"),
  cam("tv308us101atalemanybl",  "US-101 : Alemany Bl",      37.7384, -122.4083, "tv308us101atalemanybl", "S101_at_Alemany_Bl"),
  cam("tv380us101at280split",  "US-101 : 280 Split",        37.7278, -122.4029, "tv380us101at280split", "S101_at_280_Split"),
  cam("tv403us101justnorthoflagoonway",  "US-101 : N of Lagoon Way", 37.6816, -122.3886, "tv403us101justnorthoflagoonway", "N101_JNO_Lagoon_Way"),
  // I-280
  cam("tv314i280atindianast",  "I-280 : Indiana St",        37.7561, -122.3920, "tv314i280atindianast", "N280_at_Indiana_St"),
  cam("tv317i2806thstreetofframp",  "I-280 : 6th St Offramp", 37.7715, -122.3974, "tv317i2806thstreetofframp", "N280_at_6th"),
  cam("tv320i280onmontereybl",  "I-280 : Monterey Bl",      37.7313, -122.4359, "tv320i280onmontereybl", "S280_on_Monterey_Bl"),
  cam("tv321i280atalemanybl",  "I-280 : Alemany Bl",        37.7320, -122.4150, "tv321i280atalemanybl", "N280_at_Alemany_Bl"),
  cam("tv322i280us101",  "I-280 : US-101",                  37.7343, -122.4098, "tv322i280us101", "N280_at_JCT_101"),
  cam("tv323i280atsicklesav",  "I-280 : Sickles Ave",       37.7110, -122.4551, "tv323i280atsicklesav", "N280_at_Sickles_Av"),
  cam("tv325i280justsouthofcesarchavez",  "I-280 : S of Cesar Chavez", 37.7421, -122.3976, "tv325i280justsouthofcesarchavez", "N280_JSO_Cesar_Chavez"),
  cam("tv326i280justsouthofcesarchavez",  "I-280 : S of Cesar Chavez (2)", 37.7453, -122.3950, "tv326i280justsouthofcesarchavez", "S280_JSO_Cesar_Chavez"),
  cam("tv327i280johndalyblvd",  "I-280 : John Daly Bl",     37.7105, -122.4654, "tv327i280johndalyblvd", "S280_at_John_Daly_Bl"),
  // SR-1 / Presidio
  cam("tv388sr1justsouthofpresidiotunnel",  "SR-1 : Presidio Tunnel", 37.7914, -122.4697, "tv388sr1justsouthofpresidiotunnel", "N1_at_Presidio_Tunnel"),
  // Marin / Golden Gate
  cam("tve73us101spenceravenue",  "US-101 : Spencer Ave",   37.8508, -122.4898, "tve73us101spenceravenue", "N101_at_Spencer_Av"),
  // Peninsula
  cam("tv406us101atairportbl",  "US-101 : Airport Bl (SFO)", 37.6502, -122.4071, "tv406us101atairportbl", "S101_at_Airport_Bl"),
  cam("tv407us101justnorthofi380",  "US-101 : N of I-380",  37.6407, -122.4062, "tv407us101justnorthofi380", "S101_at_380"),
  cam("tv409us101sanbrunoavenue",  "US-101 : San Bruno Ave", 37.6311, -122.4030, "tv409us101sanbrunoavenue", "S101_JSO_San_Bruno_Av"),
  cam("tvb84i280serramonteblvdnorthboundonramp",  "I-280 : Serramonte NB Onramp", 37.6710, -122.4651, "tvb84i280serramonteblvdnorthboundonramp", "N280_at_Serramonte_NB_OR"),
];

const FALLBACK_SORTED_CAMERAS = mergeSupplementalCameras(filterExcludedCameras(FALLBACK_CAMERAS));

