import {
  candidatesFromOverpass,
  lookupQuery,
  LakeLookupError,
  type OverpassData,
  type LakeSelection,
} from "./lake-selection";
import type { Coord } from "./geometry";
// Public read-only service. Measurements are never sent.
// Alternative public instances: https://wiki.openstreetmap.org/wiki/Overpass_API
const ENDPOINT = "https://overpass-api.de/api/interpreter";
const LIMIT = 12 * 1024 * 1024;
async function query(point: Coord, nearby: boolean, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: lookupQuery(point, nearby) }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(32000)])
        : AbortSignal.timeout(32000),
    });
  } catch {
    throw new LakeLookupError(
      "Could not reach the shoreline service. Check your connection and retry.",
    );
  }
  if (!response.ok)
    throw new LakeLookupError(
      response.status === 429
        ? "Shoreline service is busy. Wait a moment and retry."
        : `Shoreline lookup failed (HTTP ${response.status}). Please retry later.`,
    );
  const reader = response.body?.getReader();
  if (!reader)
    throw new LakeLookupError("The shoreline service returned no data.");
  let bytes = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIMIT) {
        await reader.cancel();
        throw new LakeLookupError(
          "This lake exceeds the supported geometry size. No project was created.",
          422,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return candidatesFromOverpass(JSON.parse(text) as OverpassData, point);
  } catch (e) {
    if (e instanceof LakeLookupError) throw e;
    throw new LakeLookupError("Incomplete shoreline response. Please retry.");
  }
}
export async function resolveLake(
  point: Coord,
  signal?: AbortSignal,
): Promise<LakeSelection> {
  let candidates = await query(point, false, signal);
  // Small, unnamed water bodies may not have an Overpass area. Retrieve full nearby features, then test exact containment.
  if (!candidates.length) candidates = await query(point, true, signal);
  if (!candidates.length)
    throw new LakeLookupError(
      "No mapped lake contains this point. Click the water or try again later.",
      404,
    );
  if (candidates.length > 1)
    throw new LakeLookupError(
      "Overlapping lake boundaries found. Try another point in the lake.",
      409,
    );
  return candidates[0];
}
