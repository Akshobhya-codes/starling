// Geocoder for SF locations using Nominatim (OSM) + Google Geocoding
// Bbox-constrained to San Francisco

const SF_BBOX = {
  minLat: 37.7,
  maxLat: 37.82,
  minLng: -122.52,
  maxLng: -122.35,
};

// Cache to avoid re-geocoding the same locations
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

// Common SF location shortcuts
const KNOWN_LOCATIONS: Record<string, { lat: number; lng: number }> = {
  "market street": { lat: 37.7749, lng: -122.4194 },
  "market and 5th": { lat: 37.7837, lng: -122.4074 },
  "market and 2nd": { lat: 37.7901, lng: -122.4010 },
  "market and van ness": { lat: 37.7752, lng: -122.4194 },
  "mission and 16th": { lat: 37.7649, lng: -122.4194 },
  "mission and 24th": { lat: 37.7523, lng: -122.4183 },
  "mission and 22nd": { lat: 37.7554, lng: -122.4189 },
  "mission and 23rd": { lat: 37.7538, lng: -122.4185 },
  "mission and 2nd": { lat: 37.7878, lng: -122.3946 },
  "mission street": { lat: 37.7599, lng: -122.4148 },
  "valencia and 16th": { lat: 37.7649, lng: -122.4215 },
  "valencia and 24th": { lat: 37.7523, lng: -122.4204 },
  "van ness and lombard": { lat: 37.7989, lng: -122.4233 },
  "van ness and geary": { lat: 37.7862, lng: -122.4219 },
  "hayes street": { lat: 37.7763, lng: -122.4222 },
  "us-101 cesar chavez": { lat: 37.7500, lng: -122.4020 },
  "van ness": { lat: 37.7873, lng: -122.4216 },
  "golden gate bridge": { lat: 37.8199, lng: -122.4783 },
  "bay bridge": { lat: 37.7983, lng: -122.3778 },
  "tenderloin": { lat: 37.7847, lng: -122.4141 },
  "soma": { lat: 37.7785, lng: -122.3950 },
  "downtown": { lat: 37.7879, lng: -122.4074 },
  "civic center": { lat: 37.7793, lng: -122.4193 },
  "union square": { lat: 37.7879, lng: -122.4074 },
  "embarcadero": { lat: 37.7936, lng: -122.3930 },
  "fishermans wharf": { lat: 37.8080, lng: -122.4177 },
  "chinatown": { lat: 37.7941, lng: -122.4078 },
  "north beach": { lat: 37.8060, lng: -122.4103 },
  "haight": { lat: 37.7692, lng: -122.4481 },
  "haight and ashbury": { lat: 37.7699, lng: -122.4469 },
  "castro": { lat: 37.7609, lng: -122.4350 },
  "sunset": { lat: 37.7527, lng: -122.4934 },
  "richmond": { lat: 37.7800, lng: -122.4769 },
  "bayview": { lat: 37.7305, lng: -122.3880 },
  "hunters point": { lat: 37.7295, lng: -122.3817 },
  "potrero hill": { lat: 37.7600, lng: -122.3924 },
  "nob hill": { lat: 37.7930, lng: -122.4161 },
  "russian hill": { lat: 37.8011, lng: -122.4183 },
  "pacific heights": { lat: 37.7925, lng: -122.4355 },
  "marina": { lat: 37.8025, lng: -122.4362 },
  "excelsior": { lat: 37.7250, lng: -122.4250 },
  "outer mission": { lat: 37.7200, lng: -122.4430 },
  "ingleside": { lat: 37.7235, lng: -122.4475 },
  "visitacion valley": { lat: 37.7135, lng: -122.4065 },
  "dogpatch": { lat: 37.7580, lng: -122.3870 },
  "south beach": { lat: 37.7832, lng: -122.3882 },
  "cal-pac": { lat: 37.7905, lng: -122.4210 },
  "sf general": { lat: 37.7555, lng: -122.4044 },
  "zuckerberg general": { lat: 37.7555, lng: -122.4044 },
  "ucsf": { lat: 37.7631, lng: -122.4586 },
  "us-101": { lat: 37.7400, lng: -122.4020 },
  "i-80": { lat: 37.7850, lng: -122.3900 },
  "i-280": { lat: 37.7500, lng: -122.4100 },
  "19th avenue": { lat: 37.7500, lng: -122.4750 },
  "geary": { lat: 37.7814, lng: -122.4460 },
  "divisadero": { lat: 37.7750, lng: -122.4373 },
  "folsom": { lat: 37.7850, lng: -122.3952 },
  "howard": { lat: 37.7830, lng: -122.3970 },
  "3rd street": { lat: 37.7430, lng: -122.3878 },
  "ocean avenue": { lat: 37.7235, lng: -122.4530 },
  "geneva avenue": { lat: 37.7190, lng: -122.4400 },
  "cesar chavez": { lat: 37.7485, lng: -122.4130 },
  "army street": { lat: 37.7485, lng: -122.4130 },
  "turk": { lat: 37.7815, lng: -122.4175 },
  "eddy": { lat: 37.7835, lng: -122.4155 },
  "golden gate avenue": { lat: 37.7810, lng: -122.4190 },
  "6th street": { lat: 37.7810, lng: -122.4082 },
  "7th street": { lat: 37.7790, lng: -122.4095 },
  "8th street": { lat: 37.7770, lng: -122.4110 },
  "polk street": { lat: 37.7870, lng: -122.4200 },
  "larkin": { lat: 37.7860, lng: -122.4180 },
  "hyde": { lat: 37.7870, lng: -122.4170 },
  "jones": { lat: 37.7870, lng: -122.4140 },
  "leavenworth": { lat: 37.7860, lng: -122.4145 },
  "taylor": { lat: 37.7870, lng: -122.4115 },
  "powell": { lat: 37.7865, lng: -122.4083 },
  "stockton": { lat: 37.7890, lng: -122.4065 },
  "grant": { lat: 37.7905, lng: -122.4055 },
  "kearny": { lat: 37.7920, lng: -122.4040 },
  "montgomery": { lat: 37.7930, lng: -122.4020 },
  "columbus": { lat: 37.7975, lng: -122.4075 },
  "broadway": { lat: 37.7978, lng: -122.4095 },
};

// Normalize location text for matching
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bst\b/g, "street")
    .replace(/\bave\b/g, "avenue")
    .replace(/\bblvd\b/g, "boulevard")
    .replace(/\bdr\b/g, "drive")
    .replace(/\brd\b/g, "road")
    .replace(/\bct\b/g, "court")
    .replace(/\bpl\b/g, "place")
    .replace(/\s+&\s+/g, " and ")
    .replace(/\s+at\s+/g, " and ")
    .replace(/\//g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function geocodeLocation(
  locationText: string
): Promise<{ lat: number; lng: number } | null> {
  const lower = normalize(locationText);

  // Check cache
  if (geocodeCache.has(lower)) return geocodeCache.get(lower)!;

  // Check known locations
  for (const [key, coords] of Object.entries(KNOWN_LOCATIONS)) {
    if (lower.includes(key)) {
      geocodeCache.set(lower, coords);
      return coords;
    }
  }

  // Try Google Geocoding API (more reliable for street addresses)
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    try {
      const params = new URLSearchParams({
        address: `${locationText}, San Francisco, CA`,
        key: googleKey,
        bounds: `${SF_BBOX.minLat},${SF_BBOX.minLng}|${SF_BBOX.maxLat},${SF_BBOX.maxLng}`,
      });
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const data = await res.json();
      if (data.results?.length > 0) {
        const loc = data.results[0].geometry.location;
        // Verify within SF bbox
        if (loc.lat >= SF_BBOX.minLat && loc.lat <= SF_BBOX.maxLat &&
            loc.lng >= SF_BBOX.minLng && loc.lng <= SF_BBOX.maxLng) {
          const result = { lat: loc.lat, lng: loc.lng };
          geocodeCache.set(lower, result);
          return result;
        }
      }
    } catch {
      // Fall through to Nominatim
    }
  }

  // Try Nominatim as fallback
  try {
    const params = new URLSearchParams({
      q: `${locationText}, San Francisco, CA`,
      format: "json",
      limit: "1",
      viewbox: `${SF_BBOX.minLng},${SF_BBOX.maxLat},${SF_BBOX.maxLng},${SF_BBOX.minLat}`,
      bounded: "1",
    });

    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      {
        headers: { "User-Agent": "SF-OSINT-Hackathon/1.0" },
        signal: AbortSignal.timeout(5000),
      }
    );

    const data = await res.json();
    if (data.length > 0) {
      const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      geocodeCache.set(lower, result);
      return result;
    }
  } catch {
    // Fall through
  }

  geocodeCache.set(lower, null);
  return null;
}
