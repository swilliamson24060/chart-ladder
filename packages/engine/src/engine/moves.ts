import { ConnectionReason, MatchableTile, REASON_POINTS, Tile } from "./types";

/** Every exact chart year represented by a tile, deduped and sorted ascending. */
export function tileYears(tile: MatchableTile): number[] {
  const years = tile.kind === "SONG" ? [tile.peakYear] : tile.years;
  return [...new Set(years)].sort((a, b) => a - b);
}

function tileDecadesRaw(tile: MatchableTile): number[] {
  return tileYears(tile).map((y) => Math.floor(y / 10) * 10);
}

/** Every decade a tile charted in - a single one for a SONG, one per distinct decade across a career for an ARTIST - deduped and sorted ascending. */
export function tileDecades(tile: MatchableTile): number[] {
  return [...new Set(tileDecadesRaw(tile))].sort((a, b) => a - b);
}

function intersects<T>(a: T[], b: T[]): boolean {
  const set = new Set(a);
  return b.some((v) => set.has(v));
}

/** ARTIST-ARTIST only: two artists who worked together, per collaboratorIds. */
function isCollab(a: MatchableTile, b: MatchableTile): boolean {
  if (a.kind === "ARTIST" && b.kind === "ARTIST") {
    return a.collaboratorIds.includes(b.id);
  }
  return false;
}

/**
 * Shared performer: two songs performed by the same artist, or a song and
 * the artist who performed it. Does not apply ARTIST-ARTIST - that's COLLAB.
 */
function isSameArtist(a: MatchableTile, b: MatchableTile): boolean {
  if (a.kind === "SONG" && b.kind === "SONG") {
    return intersects(a.performerIds, b.performerIds);
  }
  if (a.kind === "ARTIST" && b.kind === "SONG") {
    return b.performerIds.includes(a.id);
  }
  if (a.kind === "SONG" && b.kind === "ARTIST") {
    return a.performerIds.includes(b.id);
  }
  return false;
}

function isSameYear(a: MatchableTile, b: MatchableTile): boolean {
  return intersects(tileYears(a), tileYears(b));
}

/**
 * The single best-scoring reason two tiles may legally connect, or null if
 * no rule matches. Only the strongest applicable tier is awarded per edge,
 * they are not summed.
 *
 * A placed wildcard or connector tile is inert for this check - it never
 * counts as a match for a *new* placement, even though it already links its
 * own two original neighbors (see GameEngine.useWildcardConnector() /
 * completeWildRescue(), which construct that link directly rather than
 * through this function). Otherwise a single bought wild connector could
 * keep chaining into unlimited free placements instead of being spent once
 * per purchase.
 */
export function bestConnectionReason(a: Tile, b: Tile): ConnectionReason | null {
  if (
    a.kind === "WILDCARD" ||
    b.kind === "WILDCARD" ||
    a.kind === "CONNECTOR" ||
    b.kind === "CONNECTOR" ||
    a.kind === "LADDER_SONG" ||
    b.kind === "LADDER_SONG"
  ) {
    return null;
  }
  if (isCollab(a, b)) return "COLLAB";
  if (isSameArtist(a, b)) return "ARTIST";
  if (isSameYear(a, b)) return "SAME_YEAR";
  return null;
}

export function connectionPoints(reason: ConnectionReason): number {
  return REASON_POINTS[reason];
}
