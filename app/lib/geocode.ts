const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'hawaii-gallery-family-app/1.0 (personal, low-volume use)';
const MIN_REQUEST_INTERVAL_MS = 1100;

interface NominatimAddress {
  tourism?: string;
  leisure?: string;
  amenity?: string;
  building?: string;
  neighbourhood?: string;
  suburb?: string;
  town?: string;
  city?: string;
  village?: string;
}

interface NominatimResponse {
  name?: string;
  address?: NominatimAddress;
}

let lastRequestTime = 0;
// Nearby shots (bursts, a stationary stretch of a walk) share ~the same
// coordinates; round to ~11m and cache so a batch import doesn't re-query
// Nominatim for every single frame.
const cache = new Map<string, string | null>();

function cacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

// Nominatim's usage policy caps anonymous use at ~1 request/second.
async function throttle() {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

/** Reverse-geocodes GPS coordinates to a short place name (e.g. "Waikiki Beach"), or null if unavailable. */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  const key = cacheKey(latitude, longitude);
  if (cache.has(key)) return cache.get(key)!;

  const result = await reverseGeocodeUncached(latitude, longitude);
  cache.set(key, result);
  return result;
}

async function reverseGeocodeUncached(latitude: number, longitude: number): Promise<string | null> {
  try {
    await throttle();
    const url = `${NOMINATIM_URL}?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=17&addressdetails=1`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return null;
    const data = (await response.json()) as NominatimResponse;
    const addr = data.address || {};
    return (
      data.name ||
      addr.tourism ||
      addr.leisure ||
      addr.amenity ||
      addr.building ||
      addr.neighbourhood ||
      addr.suburb ||
      addr.town ||
      addr.city ||
      addr.village ||
      null
    );
  } catch {
    return null;
  }
}
