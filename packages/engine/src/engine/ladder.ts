import { createEmptyBoard, END_ANCHOR_POS, STARTER_POS } from "./board";
import { createRng, pickRandom, randomInt } from "./rng";
import { Board, LadderSongTile } from "./types";

export const GUIDED_PATH_LENGTH = 5;
export const GUIDED_TILE_POINTS = 25;
export const GUIDED_CONNECTION_BONUS = 10;

export const GUIDED_PATH_POSITIONS = [
  STARTER_POS,
  { row: 5, col: 1 },
  { row: 4, col: 2 },
  { row: 3, col: 3 },
  { row: 2, col: 4 },
  { row: 1, col: 5 },
  END_ANCHOR_POS,
] as const;

// --- Dataset -----------------------------------------------------------

export interface LadderSong {
  id: number;
  title: string;
  performer: string;
  peakPos: number;
  maxWksOnChart: number;
  /**
   * 0-100 recognisability score from the data pipeline
   * (scripts/connections_generator.py), percentile-ranked within the song's
   * own debut decade so every era contributes its own best-known material.
   *
   * Never surfaced to the player - it only decides which songs a round is
   * allowed to draw from (see minFame). Showing it, or any of its inputs,
   * would turn the game into number-matching instead of music reasoning.
   */
  fame: number;
}

/** Every attribute-grouping the data pipeline (scripts/connections_generator.py) produces. */
export type LadderConnectionType =
  | "same_performer"
  | "same_title"
  | "top_40"
  | "outside_top_40"
  | "long_run"
  | "short_run"
  | "same_artist_genre"
  | "same_label"
  | "band_membership"
  | "same_artist_identity"
  | "collaboration"
  | "same_song_genre"
  | "same_writer"
  | "same_producer"
  | "same_award"
  | "chart_longevity"
  | "shared_title_word"
  | "one_hit_wonder_flag";

export interface LadderRawData {
  song_fields: string[];
  /** [title, performer, peak_pos, max_wks_on_chart, fame] - fame is absent in datasets built before fame scoring landed. */
  songs: Array<[string, string, number, number, number?]>;
  connections: Partial<Record<LadderConnectionType, Record<string, number[]>>>;
}

export interface LadderDataset {
  songs: LadderSong[];
  connections: Partial<Record<LadderConnectionType, Record<string, number[]>>>;
  /**
   * False for a dataset generated before fame scoring existed (every song
   * scores 0). Every fame floor is ignored in that case rather than
   * filtering the entire pool away - connections.json is a generated file
   * that's regenerated on postinstall, so a stale copy in someone's working
   * tree should degrade to the old uniform behaviour, not crash the game.
   */
  hasFameScores: boolean;
}

export function buildLadderDataset(raw: LadderRawData): LadderDataset {
  const songs: LadderSong[] = raw.songs.map(([title, performer, peakPos, maxWksOnChart, fame], id) => ({
    id,
    title,
    performer,
    peakPos,
    maxWksOnChart,
    fame: fame ?? 0,
  }));
  return {
    songs,
    connections: raw.connections,
    hasFameScores: songs.some((s) => s.fame > 0),
  };
}

// --- Difficulty (how deep into the chart catalogue a round may draw) ------

/**
 * Minimum fame a song needs to appear in a round. The single knob that
 * decides whether players are asked about songs they've plausibly heard of
 * or about the deep catalogue - a floor of 0 restores the original
 * draw-from-everything behaviour.
 *
 * Pool sizes at each floor (of 32,649 scored songs): 80 -> 1,356 (4%),
 * 70 -> 4,704 (14%), 60 -> 8,588 (26%), 0 -> everything. Floors above ~70
 * get thin for the narrower categories (Lightning Strikes Twice has only
 * ~95 songs at 80), which starts to repeat songs across rounds.
 */
export interface LadderDifficultyDef {
  id: LadderDifficultyId;
  name: string;
  description: string;
  minFame: number;
}

export type LadderDifficultyId = "casual" | "standard" | "deep-cuts";

export const LADDER_DIFFICULTIES: LadderDifficultyDef[] = [
  { id: "casual", name: "Casual", description: "Only widely recognised hits.", minFame: 70 },
  { id: "standard", name: "Standard", description: "Hits and solid chart staples.", minFame: 60 },
  { id: "deep-cuts", name: "Deep Cuts", description: "The entire chart history, obscurities included.", minFame: 0 },
];

export const DEFAULT_MIN_FAME = 60;

/**
 * Floors to try in order when a round can't be built at the requested one.
 * Only reachable for a pathologically narrow category/floor combination -
 * failing to start a round would be far worse than quietly serving a
 * slightly deeper cut than asked for.
 */
function fameFallbacks(minFame: number): number[] {
  if (minFame <= 0) return [0];
  return [...new Set([minFame, Math.floor(minFame / 2), 0])];
}

// --- Guessable connection tiles ------------------------------------------

/**
 * The connection types a player can actually pick during a round - each
 * maps to one or two of the data pipeline's raw connection types (see
 * scripts/round_selector.py, the reference design this mirrors). SAME_YEAR
 * isn't here: the ladder dataset has no year data at all.
 */
export type LadderTileKey =
  | "same_artist"
  | "band_collab"
  | "same_genre"
  | "same_award"
  | "top_40"
  | "outside_top_40"
  | "long_run"
  | "short_run";

export const LADDER_TILE_KEYS: LadderTileKey[] = [
  "same_artist",
  "band_collab",
  "same_genre",
  "same_award",
  "top_40",
  "outside_top_40",
  "long_run",
  "short_run",
];

/**
 * The four chart-tier keys are properties of each song on its own rather
 * than relationships between the pair, so they can be checked exactly from
 * the tiles themselves (see tierConnectionHolds). That matters for scoring:
 * the generator caps every connection group at a sample of the songs that
 * qualify, so group membership alone would reject a player who correctly
 * said "both were Top 40 hits" about a pair that simply wasn't sampled into
 * the group.
 */
const TIER_TILE_KEYS: LadderTileKey[] = ["top_40", "outside_top_40", "long_run", "short_run"];

/**
 * The two complementary tier pairs. Each song sits on exactly one side, so
 * if a pair shares a side the opposite key isn't merely false, it's
 * *provably* false from the very same fact - offering it as a decoy would
 * be offering an answer the player can eliminate for free.
 *
 * This matters more than it looks, because fame is computed from peak
 * position and weeks on chart, so a fame floor correlates strongly with
 * these tiers: only ~107 of the 18,186 songs outside the Top 40 reach fame
 * 60. Without this rule, BOTH MISSED TOP 40 and BOTH UNDER 3 MONTHS are
 * near-permanent wrong answers at the default difficulty, and a player who
 * notices goes from a 1-in-3 guess to roughly 1-in-2.
 */
const TIER_COMPLEMENTS: Array<[LadderTileKey, LadderTileKey]> = [
  ["top_40", "outside_top_40"],
  ["long_run", "short_run"],
];

export const TOP_40_CUTOFF = 40;
export const LONG_RUN_CUTOFF_WEEKS = 13; // ~3 months

function songMatchesTier(song: { peakPos: number; maxWksOnChart: number }, tileKey: LadderTileKey): boolean {
  switch (tileKey) {
    case "top_40":
      return song.peakPos <= TOP_40_CUTOFF;
    case "outside_top_40":
      return song.peakPos > TOP_40_CUTOFF;
    case "long_run":
      return song.maxWksOnChart >= LONG_RUN_CUTOFF_WEEKS;
    case "short_run":
      return song.maxWksOnChart < LONG_RUN_CUTOFF_WEEKS;
    default:
      return false;
  }
}

/** Whether a tier tile key is genuinely true of both songs, independent of connection-group sampling. */
function tierConnectionHolds(
  a: { peakPos: number; maxWksOnChart: number },
  b: { peakPos: number; maxWksOnChart: number },
  tileKey: LadderTileKey,
): boolean {
  if (!TIER_TILE_KEYS.includes(tileKey)) return false;
  return songMatchesTier(a, tileKey) && songMatchesTier(b, tileKey);
}

/**
 * Any tile key can have a large, common group that would otherwise
 * dominate a round if left fully random (e.g. band_collab, which has no
 * "same artist"-style natural variety to compete with it). Rather than a
 * hard "once per round" cap, every tile key rolls its own per-round usage
 * limit - 1 time (55% chance), 2 times (30%), or 3 times (15%) - across
 * the whole chain (the 5 guided steps plus the automatic anchor link).
 */
function rollUsageCap(rng: () => number): number {
  const roll = rng();
  if (roll < 0.55) return 1;
  if (roll < 0.85) return 2;
  return 3;
}

export const LADDER_TILE_LABELS: Record<LadderTileKey, string> = {
  same_artist: "SAME ARTIST",
  band_collab: "BAND / COLLAB",
  same_genre: "SAME GENRE",
  same_award: "SAME AWARD",
  top_40: "BOTH TOP 40",
  outside_top_40: "BOTH MISSED TOP 40",
  long_run: "BOTH 3+ MONTHS ON CHART",
  short_run: "BOTH UNDER 3 MONTHS",
};

const LADDER_TILE_CONNECTION_TYPES: Record<LadderTileKey, LadderConnectionType[]> = {
  same_artist: ["same_performer", "same_artist_identity"],
  band_collab: ["collaboration", "band_membership"],
  same_genre: ["same_song_genre"],
  same_award: ["same_award"],
  top_40: ["top_40"],
  outside_top_40: ["outside_top_40"],
  long_run: ["long_run"],
  short_run: ["short_run"],
};

// --- Categories (extensible - add an entry here for a new category) ------

export type LadderCategoryId = "one-hit-wonders" | "lightning-strikes-twice" | "number-one-hits" | "top-tier";

export interface LadderCategoryContext {
  performerSongCounts: Map<string, number>;
}

export interface LadderCategoryDef {
  id: LadderCategoryId;
  name: string;
  description: string;
  isEligible: (song: LadderSong, ctx: LadderCategoryContext) => boolean;
  /**
   * Tile keys that should never be offered - as the correct answer or a
   * decoy - for this category, because the category's own eligibility
   * rule makes that connection meaningless (e.g. every song in "We're
   * Number 1!" already peaks at #1, so top_40 would trivially match any two
   * songs) or impossible (e.g. same_artist for One Hit Wonders, where every
   * performer has exactly one song, or outside_top_40 for "We're Number
   * 1!", which no eligible song can satisfy).
   */
  excludedTileKeys?: LadderTileKey[];
}

export const LADDER_CATEGORIES: LadderCategoryDef[] = [
  {
    id: "one-hit-wonders",
    name: "One Hit Wonders",
    description: "Artists with exactly one Hot 100 hit.",
    isEligible: (song, ctx) => ctx.performerSongCounts.get(song.performer) === 1,
    excludedTileKeys: ["same_artist"],
  },
  {
    id: "lightning-strikes-twice",
    name: "Lightning Strikes Twice",
    description: "Artists with exactly two Hot 100 hits.",
    isEligible: (song, ctx) => ctx.performerSongCounts.get(song.performer) === 2,
  },
  {
    id: "number-one-hits",
    name: "We're Number 1!",
    description: "Songs that reached the top of the Hot 100.",
    isEligible: (song) => song.peakPos === 1,
    excludedTileKeys: ["top_40", "outside_top_40"],
  },
  {
    id: "top-tier",
    name: "The Top Tier",
    description: "Every song in the chart history.",
    isEligible: () => true,
  },
];

function categoryById(id: LadderCategoryId): LadderCategoryDef {
  const category = LADDER_CATEGORIES.find((c) => c.id === id);
  if (!category) throw new Error(`Unknown ladder category "${id}".`);
  return category;
}

/** The tile keys actually usable for a category - LADDER_TILE_KEYS minus its excludedTileKeys, if any. */
function usableTileKeys(category: LadderCategoryDef): LadderTileKey[] {
  if (!category.excludedTileKeys || category.excludedTileKeys.length === 0) return LADDER_TILE_KEYS;
  const excluded = category.excludedTileKeys;
  return LADDER_TILE_KEYS.filter((key) => !excluded.includes(key));
}

/**
 * The connection types a given category can actually produce. UI that lists
 * the possible connections to the player should use this rather than
 * LADDER_TILE_KEYS, which would name types that can never come up (Same
 * Artist in One Hit Wonders, Same Peak Position in "We're Number 1!").
 */
export function ladderTileKeysForCategory(categoryId: LadderCategoryId): LadderTileKey[] {
  return usableTileKeys(categoryById(categoryId));
}

function buildCategoryContext(dataset: LadderDataset): LadderCategoryContext {
  const performerSongCounts = new Map<string, number>();
  for (const song of dataset.songs) {
    performerSongCounts.set(song.performer, (performerSongCounts.get(song.performer) ?? 0) + 1);
  }
  return { performerSongCounts };
}

// --- Membership index (which tile keys does each song have neighbors on) -

interface Membership {
  connType: LadderConnectionType;
  groupKey: string;
}

interface LadderIndex {
  memberships: Map<number, Map<LadderTileKey, Membership[]>>;
  categoryContext: LadderCategoryContext;
}

const ladderIndexCache = new WeakMap<LadderDataset, LadderIndex>();

function buildMemberships(dataset: LadderDataset): Map<number, Map<LadderTileKey, Membership[]>> {
  const memberships = new Map<number, Map<LadderTileKey, Membership[]>>();
  for (const tileKey of LADDER_TILE_KEYS) {
    for (const connType of LADDER_TILE_CONNECTION_TYPES[tileKey]) {
      const groupMap = dataset.connections[connType];
      if (!groupMap) continue;
      for (const [groupKey, ids] of Object.entries(groupMap)) {
        if (ids.length < 2) continue;
        for (const id of ids) {
          let bySong = memberships.get(id);
          if (!bySong) {
            bySong = new Map();
            memberships.set(id, bySong);
          }
          let list = bySong.get(tileKey);
          if (!list) {
            list = [];
            bySong.set(tileKey, list);
          }
          list.push({ connType, groupKey });
        }
      }
    }
  }
  return memberships;
}

function ladderIndex(dataset: LadderDataset): LadderIndex {
  const cached = ladderIndexCache.get(dataset);
  if (cached) return cached;
  const result: LadderIndex = {
    memberships: buildMemberships(dataset),
    categoryContext: buildCategoryContext(dataset),
  };
  ladderIndexCache.set(dataset, result);
  return result;
}

/** True when a song clears the fame floor, or when the dataset carries no fame scores at all. */
function meetsFame(dataset: LadderDataset, song: LadderSong, minFame: number): boolean {
  if (minFame <= 0 || !dataset.hasFameScores) return true;
  return song.fame >= minFame;
}

function eligibleNeighborIds(
  songId: number,
  tileKey: LadderTileKey,
  dataset: LadderDataset,
  index: LadderIndex,
  category: LadderCategoryDef,
  usedIds: Set<number>,
  minFame: number,
): number[] {
  const groups = index.memberships.get(songId)?.get(tileKey);
  if (!groups) return [];
  const candidates = new Set<number>();
  for (const { connType, groupKey } of groups) {
    const ids = dataset.connections[connType]?.[groupKey] ?? [];
    for (const id of ids) {
      if (id === songId || usedIds.has(id)) continue;
      const song = dataset.songs[id];
      if (!meetsFame(dataset, song, minFame)) continue;
      if (category.isEligible(song, index.categoryContext)) candidates.add(id);
    }
  }
  return [...candidates];
}

/**
 * The tile key connecting `previous` to `candidate` - a pure connectivity
 * check on the pair, analogous to the free-play engine's
 * bestConnectionReason(). Exposed for UI code that needs to know why a
 * given pair connects without reaching into engine internals.
 *
 * Pass `categoryId` to restrict the answer to the connection types that
 * category can actually produce. Without it, every tile key is considered,
 * which is rarely what a caller wants: in "We're Number 1!" *every* pair of
 * songs shares a peak position, so an unrestricted check reports a
 * connection for literally any two songs - including the decoys, which are
 * only ever guaranteed to be unconnected through the category's own usable
 * keys.
 *
 * This is not a way to find which of a round's choices is correct - use
 * GuidedGameEngine.peekCorrectChoiceIndex() for that, which reads the
 * route directly instead of inferring it.
 */
export function ladderConnectionReason(
  previous: LadderSongTile,
  candidate: LadderSongTile,
  dataset: LadderDataset,
  categoryId?: LadderCategoryId,
): LadderTileKey | null {
  const index = ladderIndex(dataset);
  const previousId = Number(previous.id);
  const candidateId = Number(candidate.id);
  const groups = index.memberships.get(previousId);
  if (!groups) return null;
  const allowed = categoryId ? usableTileKeys(categoryById(categoryId)) : LADDER_TILE_KEYS;
  for (const tileKey of allowed) {
    for (const { connType, groupKey } of groups.get(tileKey) ?? []) {
      if ((dataset.connections[connType]?.[groupKey] ?? []).includes(candidateId)) return tileKey;
    }
  }
  return null;
}

/**
 * Every tile key the category permits that is genuinely true of this pair -
 * not just the one the route happened to commit to.
 *
 * A pair very often satisfies several at once (two Smashing Pumpkins songs
 * are SAME ARTIST *and* BAND / COLLAB, and may well both be Top 40). The
 * engine scores against this set rather than a single committed answer, so
 * a player naming a real connection is never marked wrong for picking a
 * different true one.
 */
export function ladderTrueConnections(
  previous: LadderSongTile,
  candidate: LadderSongTile,
  dataset: LadderDataset,
  categoryId: LadderCategoryId,
): LadderTileKey[] {
  const index = ladderIndex(dataset);
  const previousId = Number(previous.id);
  const candidateId = Number(candidate.id);
  const groups = index.memberships.get(previousId);
  const found: LadderTileKey[] = [];
  for (const tileKey of usableTileKeys(categoryById(categoryId))) {
    // Tier keys are exact properties of the two songs, so they're checked
    // directly - group membership would under-report them, since the
    // generator samples oversized groups down to a fixed cap.
    if (TIER_TILE_KEYS.includes(tileKey)) {
      if (tierConnectionHolds(previous, candidate, tileKey)) found.push(tileKey);
      continue;
    }
    for (const { connType, groupKey } of groups?.get(tileKey) ?? []) {
      if ((dataset.connections[connType]?.[groupKey] ?? []).includes(candidateId)) {
        found.push(tileKey);
        break;
      }
    }
  }
  return found;
}

/** Every song id that connects to `songId` through any tile key the category allows, ignoring fame and usage. */
function allConnectedIds(
  songId: number,
  dataset: LadderDataset,
  index: LadderIndex,
  category: LadderCategoryDef,
): Set<number> {
  const connected = new Set<number>();
  for (const tileKey of usableTileKeys(category)) {
    // minFame 0 deliberately: this set is used to *exclude* candidates from
    // becoming decoys, so it has to be a superset. Filtering it by the fame
    // floor could let a genuinely-connected song slip through as a decoy
    // and give a step two correct answers.
    for (const id of eligibleNeighborIds(songId, tileKey, dataset, index, category, new Set(), 0)) {
      connected.add(id);
    }
  }
  return connected;
}

/**
 * A short, human-readable detail for a specific connection - e.g. the two
 * performer credits for a same_artist/band_collab link, the shared peak
 * position, or the matching genre/award name. Used by UI that lists out a
 * completed chain (the round-complete chain review, the tutorial's final
 * summary) so each link shows *what* it actually connects on, not just the
 * connection type. For same_genre/same_award the underlying group key
 * (e.g. "pop rock", "Grammy Award for Record of the Year") already reads
 * fine as-is; the other raw group keys (numeric ids, UUIDs) don't, so
 * those types are derived from the tiles' own fields instead.
 */
export function ladderConnectionDetail(
  fromTile: LadderSongTile,
  toTile: LadderSongTile,
  reason: LadderTileKey,
  dataset: LadderDataset,
): string {
  switch (reason) {
    case "same_artist":
      return fromTile.performer === toTile.performer
        ? fromTile.performer
        : `${fromTile.performer}; ${toTile.performer}`;
    case "band_collab":
      return `${fromTile.performer}; ${toTile.performer}`;
    case "top_40":
    case "outside_top_40":
      return `#${fromTile.peakPos}; #${toTile.peakPos}`;
    case "long_run":
    case "short_run":
      return `${fromTile.maxWksOnChart} wks; ${toTile.maxWksOnChart} wks`;
    case "same_genre":
    case "same_award": {
      const index = ladderIndex(dataset);
      const fromId = Number(fromTile.id);
      const toId = Number(toTile.id);
      const groups = index.memberships.get(fromId)?.get(reason) ?? [];
      for (const { connType, groupKey } of groups) {
        if ((dataset.connections[connType]?.[groupKey] ?? []).includes(toId)) return groupKey;
      }
      return "";
    }
  }
}

function availableTileKeys(
  songId: number,
  dataset: LadderDataset,
  index: LadderIndex,
  category: LadderCategoryDef,
  usedIds: Set<number>,
  minFame: number,
): LadderTileKey[] {
  return usableTileKeys(category).filter(
    (tileKey) => eligibleNeighborIds(songId, tileKey, dataset, index, category, usedIds, minFame).length > 0,
  );
}

// --- Route (the prepared chain a round walks through) --------------------

interface LadderRoute {
  starter: LadderSong;
  anchor: LadderSong;
  tiles: LadderSong[];
  reasons: LadderTileKey[];
  anchorReason: LadderTileKey;
}

/**
 * Prefers a tile key that hasn't hit its rolled usage cap yet. If every
 * available key is already at its cap (a dead-end step with no other
 * option), falls back to the least-used available key rather than a
 * uniform-random one - this keeps any single connection type from running
 * away further over its cap than the dead end strictly requires.
 */
function pickTileKeyRespectingCaps(
  available: LadderTileKey[],
  rng: () => number,
  usageCaps: ReadonlyMap<LadderTileKey, number>,
  usageCounts: Map<LadderTileKey, number>,
): LadderTileKey {
  const withinCap = available.filter((key) => {
    const cap = usageCaps.get(key);
    return cap === undefined || (usageCounts.get(key) ?? 0) < cap;
  });
  let tileKey: LadderTileKey;
  if (withinCap.length > 0) {
    tileKey = pickRandom(rng, withinCap);
  } else {
    const minCount = Math.min(...available.map((key) => usageCounts.get(key) ?? 0));
    const leastUsed = available.filter((key) => (usageCounts.get(key) ?? 0) === minCount);
    tileKey = pickRandom(rng, leastUsed);
  }
  usageCounts.set(tileKey, (usageCounts.get(tileKey) ?? 0) + 1);
  return tileKey;
}

function buildLadderRoute(
  dataset: LadderDataset,
  categoryId: LadderCategoryId,
  rng: () => number,
  minFame: number,
): LadderRoute {
  for (const floor of fameFallbacks(minFame)) {
    const route = tryBuildLadderRoute(dataset, categoryId, rng, floor);
    if (route) return route;
  }
  throw new Error(`Unable to prepare a five-song chain for category "${categoryId}".`);
}

function tryBuildLadderRoute(
  dataset: LadderDataset,
  categoryId: LadderCategoryId,
  rng: () => number,
  minFame: number,
): LadderRoute | null {
  const index = ladderIndex(dataset);
  const category = categoryById(categoryId);
  const eligibleSongs = dataset.songs.filter(
    (song) =>
      category.isEligible(song, index.categoryContext) &&
      index.memberships.has(song.id) &&
      meetsFame(dataset, song, minFame),
  );
  if (eligibleSongs.length === 0) return null;

  // A route where no single connection type is used more than this many
  // times is accepted immediately. If 200 attempts never find one (a
  // dead-end-heavy category where some type is unavoidably dominant), the
  // least-dominated route seen is used instead - this keeps "never fail to
  // build a route" as an invariant while still strongly preferring variety.
  const MAX_ACCEPTABLE_TYPE_COUNT = 3;
  let bestRoute: LadderRoute | null = null;
  let bestMaxTypeCount = Infinity;

  for (let attempt = 0; attempt < 200; attempt++) {
    const starter = pickRandom(rng, eligibleSongs);
    const usedIds = new Set<number>([starter.id]);
    const tiles: LadderSong[] = [];
    const reasons: LadderTileKey[] = [];
    const usageCaps = new Map<LadderTileKey, number>(
      usableTileKeys(category).map((key) => [key, rollUsageCap(rng)]),
    );
    const usageCounts = new Map<LadderTileKey, number>();
    let current = starter;
    let failed = false;

    for (let step = 0; step < GUIDED_PATH_LENGTH; step++) {
      const available = availableTileKeys(current.id, dataset, index, category, usedIds, minFame);
      if (available.length === 0) {
        failed = true;
        break;
      }
      const tileKey = pickTileKeyRespectingCaps(available, rng, usageCaps, usageCounts);
      const neighborIds = eligibleNeighborIds(current.id, tileKey, dataset, index, category, usedIds, minFame);
      const next = dataset.songs[pickRandom(rng, neighborIds)];
      tiles.push(next);
      reasons.push(tileKey);
      usedIds.add(next.id);
      current = next;
    }
    if (failed) continue;

    const anchorAvailable = availableTileKeys(current.id, dataset, index, category, usedIds, minFame);
    if (anchorAvailable.length === 0) continue;
    const anchorTileKey = pickTileKeyRespectingCaps(anchorAvailable, rng, usageCaps, usageCounts);
    const anchorNeighbors = eligibleNeighborIds(current.id, anchorTileKey, dataset, index, category, usedIds, minFame);
    const anchor = dataset.songs[pickRandom(rng, anchorNeighbors)];

    const route: LadderRoute = { starter, anchor, tiles, reasons, anchorReason: anchorTileKey };
    const maxTypeCount = Math.max(...usageCounts.values());
    if (maxTypeCount <= MAX_ACCEPTABLE_TYPE_COUNT) return route;
    if (maxTypeCount < bestMaxTypeCount) {
      bestRoute = route;
      bestMaxTypeCount = maxTypeCount;
    }
  }
  return bestRoute;
}

function toTile(song: LadderSong): LadderSongTile {
  return {
    kind: "LADDER_SONG",
    id: String(song.id),
    title: song.title,
    performer: song.performer,
    peakPos: song.peakPos,
    maxWksOnChart: song.maxWksOnChart,
  };
}

function shuffled<T>(rng: () => number, items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 1 correct + up to 2 decoys, drawn from the tile keys the category
 * actually allows (see LadderCategoryDef.excludedTileKeys) - a key that can
 * never be the true connection for this category (e.g. same_artist for One
 * Hit Wonders, where every performer has exactly one song) would just be a
 * free giveaway as a decoy, so it's excluded from the pool entirely.
 *
 * `alsoTrue` lists the other connections that genuinely hold for this pair.
 * They're kept out of the decoy pool so the offered three still have
 * exactly one right answer - without this, accepting any true connection
 * would regularly hand the player two correct options out of three. If
 * there aren't enough false keys left to fill both slots (a pair that
 * satisfies nearly everything), the also-true ones are used rather than
 * offering fewer than three choices; scoring accepts them, so it costs
 * difficulty, not fairness.
 */
function pickConnectionChoices(
  rng: () => number,
  correct: LadderTileKey,
  categoryId: LadderCategoryId,
  alsoTrue: LadderTileKey[],
): LadderTileKey[] {
  const category = categoryById(categoryId);
  const pool = usableTileKeys(category).filter((key) => key !== correct);
  // Drop the far side of any tier pair the players' songs already share -
  // see TIER_COMPLEMENTS for why a free-to-eliminate decoy is worse than a
  // smaller pool.
  const trivial = new Set<LadderTileKey>();
  for (const [a, b] of TIER_COMPLEMENTS) {
    const aHolds = correct === a || alsoTrue.includes(a);
    const bHolds = correct === b || alsoTrue.includes(b);
    if (aHolds) trivial.add(b);
    if (bHolds) trivial.add(a);
  }
  const falseKeys = pool.filter((key) => !alsoTrue.includes(key) && !trivial.has(key));
  const decoys = shuffled(rng, falseKeys).slice(0, 2);
  if (decoys.length < 2) {
    for (const key of shuffled(rng, pool.filter((k) => !decoys.includes(k)))) {
      if (decoys.length >= 2) break;
      decoys.push(key);
    }
  }
  return shuffled(rng, [correct, ...decoys]);
}

// --- Public game state / result types -------------------------------------

export type GuidedGameStatus = "playing" | "path-complete" | "game-over";

export interface GuidedSessionProgress {
  score: number;
  misses: number;
  roundsCompleted: number;
}

export interface GuidedPathConnection {
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
  reason: LadderTileKey;
}

export interface GuidedGameState {
  board: Board;
  choices: LadderSongTile[];
  connectionChoices: LadderTileKey[];
  step: number;
  score: number;
  misses: number;
  roundsCompleted: number;
  status: GuidedGameStatus;
  awaitingConnectionGuess: boolean;
  completedConnections: GuidedPathConnection[];
  missedCorrectTile: LadderSongTile | null;
}

export interface GuidedTileChoiceResult {
  correct: boolean;
  missed: boolean;
  needsConnectionGuess: boolean;
  correctTile: LadderSongTile;
  pointsAwarded: number;
  misses: number;
  status: GuidedGameStatus;
}

export interface GuidedConnectionGuessResult {
  correct: boolean;
  correctReason: LadderTileKey;
  pointsAwarded: number;
  status: GuidedGameStatus;
}

// --- Engine ----------------------------------------------------------------

export class GuidedGameEngine {
  private dataset: LadderDataset;
  private categoryId: LadderCategoryId;
  private rng: () => number;
  private route: LadderRoute;
  private board: Board;
  private choices: LadderSong[] = [];
  private connectionChoices: LadderTileKey[] = [];
  private step = 0;
  private score = 0;
  private misses = 0;
  private roundsCompleted = 0;
  private status: GuidedGameStatus = "playing";
  private awaitingConnectionGuess = false;
  private completedConnections: GuidedPathConnection[] = [];
  private missedCorrectTile: LadderSong | null = null;
  private pendingBasePoints = 0;
  private currentTilePlaced = false;
  private minFame: number;
  /**
   * Every connection that genuinely holds for the current step's pair, any
   * of which is scored as correct. Populated in chooseTile(); the route's
   * own reason is always a member.
   */
  private acceptedReasons = new Set<LadderTileKey>();

  constructor(
    dataset: LadderDataset,
    categoryId: LadderCategoryId,
    seed = Date.now(),
    progress?: GuidedSessionProgress,
    minFame: number = DEFAULT_MIN_FAME,
  ) {
    this.dataset = dataset;
    this.categoryId = categoryId;
    this.rng = createRng(seed);
    this.minFame = minFame;
    if (progress) {
      this.score = progress.score;
      this.misses = progress.misses;
      this.roundsCompleted = progress.roundsCompleted;
    }
    this.route = buildLadderRoute(dataset, categoryId, this.rng, minFame);
    this.board = createEmptyBoard();
    this.placeStarterAndAnchor();
    this.prepareChoices();
  }

  private placeStarterAndAnchor(): void {
    const starterCell = this.board[STARTER_POS.row][STARTER_POS.col];
    starterCell.tile = toTile(this.route.starter);
    starterCell.role = "STARTER";
    const anchorCell = this.board[END_ANCHOR_POS.row][END_ANCHOR_POS.col];
    anchorCell.tile = toTile(this.route.anchor);
    anchorCell.role = "END_ANCHOR";
  }

  /**
   * The three songs offered this step: the route's correct next song plus
   * two decoys that connect to `previous` through nothing at all.
   *
   * Decoys are drawn from the same fame band as the answer, which is not
   * optional. Fame-weighting the route while leaving decoys uniform over
   * the full catalogue would make "the one I've actually heard of" a
   * near-perfect heuristic - the step would become answerable with no music
   * knowledge whatsoever, which is a far worse game than the hard one.
   */
  private prepareChoices(): void {
    const correct = this.route.tiles[this.step];
    const previous = this.step === 0 ? this.route.starter : this.route.tiles[this.step - 1];
    const index = ladderIndex(this.dataset);
    const category = categoryById(this.categoryId);
    const usedIds = new Set(this.usedSongIds());
    const connectedIds = allConnectedIds(previous.id, this.dataset, index, category);

    // Relax the floor only if the banded pool genuinely can't supply two
    // decoys (very narrow category at a very high floor); a step with one
    // choice would be worse than a slightly obscure decoy.
    for (const floor of fameFallbacks(this.minFame)) {
      const decoys: LadderSong[] = [];
      for (let attempts = 0; attempts < 5000 && decoys.length < 2; attempts++) {
        const candidate = pickRandom(this.rng, this.dataset.songs);
        if (candidate.id === correct.id) continue;
        if (usedIds.has(candidate.id)) continue;
        if (connectedIds.has(candidate.id)) continue;
        if (!meetsFame(this.dataset, candidate, floor)) continue;
        if (!category.isEligible(candidate, index.categoryContext)) continue;
        if (decoys.some((d) => d.id === candidate.id)) continue;
        decoys.push(candidate);
      }
      if (decoys.length === 2) {
        this.choices = shuffled(this.rng, [correct, ...decoys]);
        return;
      }
    }
    throw new Error("Unable to prepare two incorrect choices for this path.");
  }

  private usedSongIds(): number[] {
    const ids = [this.route.starter.id, this.route.anchor.id, ...this.route.tiles.map((t) => t.id)];
    return ids;
  }

  private basePointsForCurrentStep(): number {
    return GUIDED_TILE_POINTS;
  }

  private placeCurrentTile(): void {
    if (this.currentTilePlaced) return;
    const tile = this.route.tiles[this.step];
    const currentPosition = GUIDED_PATH_POSITIONS[this.step + 1];
    const previousPosition = GUIDED_PATH_POSITIONS[this.step];
    this.board[currentPosition.row][currentPosition.col].tile = toTile(tile);
    this.completedConnections.push({
      fromRow: previousPosition.row,
      fromCol: previousPosition.col,
      toRow: currentPosition.row,
      toCol: currentPosition.col,
      reason: this.route.reasons[this.step],
    });
    this.currentTilePlaced = true;
  }

  private completeStep(withBonus: boolean): number {
    this.placeCurrentTile();
    const currentPosition = GUIDED_PATH_POSITIONS[this.step + 1];
    const points = this.pendingBasePoints + (withBonus ? GUIDED_CONNECTION_BONUS : 0);
    this.score += points;
    this.step++;
    this.awaitingConnectionGuess = false;
    this.connectionChoices = [];
    this.pendingBasePoints = 0;
    this.currentTilePlaced = false;

    if (this.step === GUIDED_PATH_LENGTH) {
      const anchorPosition = GUIDED_PATH_POSITIONS[GUIDED_PATH_POSITIONS.length - 1];
      this.completedConnections.push({
        fromRow: currentPosition.row,
        fromCol: currentPosition.col,
        toRow: anchorPosition.row,
        toCol: anchorPosition.col,
        reason: this.route.anchorReason,
      });
      this.choices = [];
      this.roundsCompleted++;
      this.status = "path-complete";
    } else {
      this.prepareChoices();
    }
    return points;
  }

  getState(): GuidedGameState {
    return {
      board: this.board.map((row) => row.map((cell) => ({ ...cell }))),
      choices: this.choices.map(toTile),
      connectionChoices: [...this.connectionChoices],
      step: this.step,
      score: this.score,
      misses: this.misses,
      roundsCompleted: this.roundsCompleted,
      status: this.status,
      awaitingConnectionGuess: this.awaitingConnectionGuess,
      completedConnections: [...this.completedConnections],
      missedCorrectTile: this.missedCorrectTile ? toTile(this.missedCorrectTile) : null,
    };
  }

  /**
   * The current step's actual correct connection reason, without revealing
   * it to the player. A song pair can legitimately connect through more
   * than one tile type at once (e.g. same genre AND same peak position);
   * this is the one the route actually committed to, needed by callers
   * (tests, the tutorial) that can't otherwise tell which of several valid
   * answers the engine expects.
   */
  peekCurrentReason(): LadderTileKey | null {
    if (this.status !== "playing") return null;
    return this.route.reasons[this.step];
  }

  /**
   * The index into getState().choices of the song that actually continues
   * the route - the companion to peekCurrentReason(), and like it, never
   * exposed through getState().
   *
   * Anything that needs to *drive* a correct playthrough (the tutorial,
   * tests) must use this rather than re-deriving connectivity from the
   * dataset. A decoy is only guaranteed not to connect through the tile
   * keys the category permits, so an independent check that ignores
   * LadderCategoryDef.excludedTileKeys can legitimately flag a decoy as
   * "connecting" - in "We're Number 1!" every pair of songs trivially
   * shares a peak position, and in One Hit Wonders two separately-credited
   * one-hit performers can still share an artist identity.
   */
  peekCorrectChoiceIndex(): number {
    if (this.status !== "playing") return -1;
    const correct = this.route.tiles[this.step];
    return this.choices.findIndex((choice) => choice.id === correct.id);
  }

  chooseTile(index: number): GuidedTileChoiceResult {
    if (this.status !== "playing" || this.awaitingConnectionGuess) {
      throw new Error("A tile cannot be selected right now.");
    }
    const selected = this.choices[index];
    if (!selected) throw new Error("Invalid tile choice.");
    const correctTile = this.route.tiles[this.step];
    const missed = selected.id !== correctTile.id;
    if (missed) {
      this.misses++;
      this.missedCorrectTile = correctTile;
      this.pendingBasePoints = 0;
    } else {
      this.missedCorrectTile = null;
      this.pendingBasePoints = this.basePointsForCurrentStep();
    }
    this.placeCurrentTile();

    if (this.misses >= GUIDED_PATH_LENGTH) {
      this.status = "game-over";
      this.choices = [];
      return {
        correct: !missed,
        missed,
        needsConnectionGuess: false,
        correctTile: toTile(correctTile),
        pointsAwarded: 0,
        misses: this.misses,
        status: this.status,
      };
    }

    this.awaitingConnectionGuess = true;
    const routeReason = this.route.reasons[this.step];
    const previous = this.step === 0 ? this.route.starter : this.route.tiles[this.step - 1];
    this.acceptedReasons = new Set(
      ladderTrueConnections(toTile(previous), toTile(correctTile), this.dataset, this.categoryId),
    );
    this.acceptedReasons.add(routeReason); // the route's own choice always counts
    this.connectionChoices = pickConnectionChoices(
      this.rng,
      routeReason,
      this.categoryId,
      [...this.acceptedReasons].filter((key) => key !== routeReason),
    );
    return {
      correct: !missed,
      missed,
      needsConnectionGuess: true,
      correctTile: toTile(correctTile),
      pointsAwarded: 0,
      misses: this.misses,
      status: this.status,
    };
  }

  /**
   * Any connection that genuinely holds for this pair scores the bonus, not
   * only the one the route committed to. Two songs by the same band are
   * SAME ARTIST *and* BAND / COLLAB; marking the player wrong for naming
   * the one the route didn't pick was punishing them for being right.
   *
   * correctReason still reports the route's own answer, so a genuinely
   * wrong guess reveals the canonical link rather than an arbitrary
   * alternative.
   */
  guessConnection(reason: LadderTileKey): GuidedConnectionGuessResult {
    if (this.status !== "playing" || !this.awaitingConnectionGuess) {
      throw new Error("A connection cannot be guessed right now.");
    }
    const correctReason = this.route.reasons[this.step];
    const correct = this.acceptedReasons.has(reason);
    const pointsAwarded = this.completeStep(correct);
    return { correct, correctReason, pointsAwarded, status: this.status };
  }

  getProgress(): GuidedSessionProgress {
    return { score: this.score, misses: this.misses, roundsCompleted: this.roundsCompleted };
  }

  startNextRound(): void {
    if (this.status !== "path-complete") {
      throw new Error("A new round can only start after completing the current path.");
    }
    this.route = buildLadderRoute(this.dataset, this.categoryId, this.rng, this.minFame);
    this.board = createEmptyBoard();
    this.placeStarterAndAnchor();
    this.choices = [];
    this.connectionChoices = [];
    this.step = 0;
    this.status = "playing";
    this.awaitingConnectionGuess = false;
    this.completedConnections = [];
    this.missedCorrectTile = null;
    this.pendingBasePoints = 0;
    this.currentTilePlaced = false;
    this.prepareChoices();
  }

  endSession(): void {
    if (this.status !== "path-complete") {
      throw new Error("The session can only be ended after completing a path.");
    }
    this.status = "game-over";
  }
}
