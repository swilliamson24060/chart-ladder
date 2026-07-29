import { Tile } from "./types";

const MOST_RECENT_DECADE = 2020;

/**
 * 2020s = 1, 2010s = 2, 2000s = 3, ... 1950s = 8, and so on further back.
 * Clamped to a minimum of 1 so a hypothetical future decade never scores
 * below the current one.
 */
export function decadePoints(year: number): number {
  const decade = Math.floor(year / 10) * 10;
  return Math.max(1, (MOST_RECENT_DECADE - decade) / 10 + 1);
}

/**
 * The tile's own point value, added to the score whenever it's placed (on
 * top of whatever connection score it earns). A tile that spans multiple
 * decades - an artist with a long chart history, or a song whose debut and
 * peak fall in different decades - takes the lower of the values, i.e.
 * whichever decade it touches is most recent. Wildcards and connector
 * tiles carry no year data and are worth 0.
 */
export function tileValue(tile: Tile): number {
  if (tile.kind === "WILDCARD" || tile.kind === "CONNECTOR") return 0;
  // The ladder dataset carries no chart-year data, so it can't earn a
  // decade-based bonus - the ladder game scores with flat points instead.
  if (tile.kind === "LADDER_SONG") return 0;
  if (tile.kind === "SONG") {
    return Math.min(decadePoints(tile.debutYear), decadePoints(tile.peakYear));
  }
  if (tile.years.length === 0) return 1;
  return tile.years.reduce((min, y) => Math.min(min, decadePoints(y)), Infinity);
}
