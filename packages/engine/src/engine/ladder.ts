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
}

/** Every attribute-grouping the data pipeline (scripts/connections_generator.py) produces. */
export type LadderConnectionType =
  | "same_performer"
  | "same_title"
  | "same_peak_position"
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
  songs: Array<[string, string, number, number]>;
  connections: Partial<Record<LadderConnectionType, Record<string, number[]>>>;
}

export interface LadderDataset {
  songs: LadderSong[];
  connections: Partial<Record<LadderConnectionType, Record<string, number[]>>>;
}

export function buildLadderDataset(raw: LadderRawData): LadderDataset {
  return {
    songs: raw.songs.map(([title, performer, peakPos, maxWksOnChart], id) => ({
      id,
      title,
      performer,
      peakPos,
      maxWksOnChart,
    })),
    connections: raw.connections,
  };
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
  | "same_peak_pos"
  | "same_award"
  | "weeks_on_chart";

export const LADDER_TILE_KEYS: LadderTileKey[] = [
  "same_artist",
  "band_collab",
  "same_genre",
  "same_peak_pos",
  "same_award",
  "weeks_on_chart",
];

/**
 * These three tile keys have large, common groups that would otherwise
 * dominate a round if left fully random. Rather than a hard "once per
 * round" cap, each round rolls a per-key usage limit - 1 time (55%
 * chance), 2 times (30%), or 3 times (15%) - across the whole chain (the 5
 * guided steps plus the automatic anchor link).
 */
const DISTRIBUTION_CONTROLLED_KEYS: readonly LadderTileKey[] = ["same_artist", "same_peak_pos", "same_genre"];

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
  same_peak_pos: "SAME PEAK POSITION",
  same_award: "SAME AWARD",
  weeks_on_chart: "WEEKS ON CHART",
};

const LADDER_TILE_CONNECTION_TYPES: Record<LadderTileKey, LadderConnectionType[]> = {
  same_artist: ["same_performer", "same_artist_identity"],
  band_collab: ["collaboration", "band_membership"],
  same_genre: ["same_song_genre"],
  same_peak_pos: ["same_peak_position"],
  same_award: ["same_award"],
  weeks_on_chart: ["chart_longevity"],
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
   * Number 1!" already peaks at #1, so same_peak_pos would trivially match
   * any two songs) or impossible (e.g. same_artist for One Hit Wonders,
   * where every performer has exactly one song).
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
    excludedTileKeys: ["same_peak_pos"],
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

function eligibleNeighborIds(
  songId: number,
  tileKey: LadderTileKey,
  dataset: LadderDataset,
  index: LadderIndex,
  category: LadderCategoryDef,
  usedIds: Set<number>,
): number[] {
  const groups = index.memberships.get(songId)?.get(tileKey);
  if (!groups) return [];
  const candidates = new Set<number>();
  for (const { connType, groupKey } of groups) {
    const ids = dataset.connections[connType]?.[groupKey] ?? [];
    for (const id of ids) {
      if (id === songId || usedIds.has(id)) continue;
      if (category.isEligible(dataset.songs[id], index.categoryContext)) candidates.add(id);
    }
  }
  return [...candidates];
}

/**
 * The tile key connecting `previous` to `candidate`, ignoring category
 * eligibility - a pure connectivity check, analogous to the free-play
 * engine's bestConnectionReason(). Exposed for UI code (e.g. the tutorial)
 * that needs to know why a given pair connects without reaching into engine
 * internals.
 */
export function ladderConnectionReason(
  previous: LadderSongTile,
  candidate: LadderSongTile,
  dataset: LadderDataset,
): LadderTileKey | null {
  const index = ladderIndex(dataset);
  const previousId = Number(previous.id);
  const candidateId = Number(candidate.id);
  const groups = index.memberships.get(previousId);
  if (!groups) return null;
  for (const tileKey of LADDER_TILE_KEYS) {
    for (const { connType, groupKey } of groups.get(tileKey) ?? []) {
      if ((dataset.connections[connType]?.[groupKey] ?? []).includes(candidateId)) return tileKey;
    }
  }
  return null;
}

function availableTileKeys(
  songId: number,
  dataset: LadderDataset,
  index: LadderIndex,
  category: LadderCategoryDef,
  usedIds: Set<number>,
): LadderTileKey[] {
  return usableTileKeys(category).filter(
    (tileKey) => eligibleNeighborIds(songId, tileKey, dataset, index, category, usedIds).length > 0,
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

/** Prefers a tile key that hasn't hit its rolled usage cap yet, falling back to any available key if that would leave no options. */
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
  const tileKey = pickRandom(rng, withinCap.length > 0 ? withinCap : available);
  usageCounts.set(tileKey, (usageCounts.get(tileKey) ?? 0) + 1);
  return tileKey;
}

function buildLadderRoute(dataset: LadderDataset, categoryId: LadderCategoryId, rng: () => number): LadderRoute {
  const index = ladderIndex(dataset);
  const category = categoryById(categoryId);
  const eligibleSongs = dataset.songs.filter(
    (song) => category.isEligible(song, index.categoryContext) && index.memberships.has(song.id),
  );
  if (eligibleSongs.length === 0) {
    throw new Error(`No connected songs available for category "${categoryId}".`);
  }

  for (let attempt = 0; attempt < 200; attempt++) {
    const starter = pickRandom(rng, eligibleSongs);
    const usedIds = new Set<number>([starter.id]);
    const tiles: LadderSong[] = [];
    const reasons: LadderTileKey[] = [];
    const usageCaps = new Map<LadderTileKey, number>(
      DISTRIBUTION_CONTROLLED_KEYS.map((key) => [key, rollUsageCap(rng)]),
    );
    const usageCounts = new Map<LadderTileKey, number>();
    let current = starter;
    let failed = false;

    for (let step = 0; step < GUIDED_PATH_LENGTH; step++) {
      const available = availableTileKeys(current.id, dataset, index, category, usedIds);
      if (available.length === 0) {
        failed = true;
        break;
      }
      const tileKey = pickTileKeyRespectingCaps(available, rng, usageCaps, usageCounts);
      const neighborIds = eligibleNeighborIds(current.id, tileKey, dataset, index, category, usedIds);
      const next = dataset.songs[pickRandom(rng, neighborIds)];
      tiles.push(next);
      reasons.push(tileKey);
      usedIds.add(next.id);
      current = next;
    }
    if (failed) continue;

    const anchorAvailable = availableTileKeys(current.id, dataset, index, category, usedIds);
    if (anchorAvailable.length === 0) continue;
    const anchorTileKey = pickTileKeyRespectingCaps(anchorAvailable, rng, usageCaps, usageCounts);
    const anchorNeighbors = eligibleNeighborIds(current.id, anchorTileKey, dataset, index, category, usedIds);
    const anchor = dataset.songs[pickRandom(rng, anchorNeighbors)];

    return { starter, anchor, tiles, reasons, anchorReason: anchorTileKey };
  }
  throw new Error(`Unable to prepare a five-song chain for category "${categoryId}".`);
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
 * 1 correct + up to 2 random decoys, drawn from the tile keys the category
 * actually allows (see LadderCategoryDef.excludedTileKeys) - a key that can
 * never be the true connection for this category (e.g. same_artist for One
 * Hit Wonders, where every performer has exactly one song) would just be a
 * free giveaway as a decoy, so it's excluded from the pool entirely.
 */
function pickConnectionChoices(
  rng: () => number,
  correct: LadderTileKey,
  categoryId: LadderCategoryId,
): LadderTileKey[] {
  const category = categoryById(categoryId);
  const decoyPool = usableTileKeys(category).filter((key) => key !== correct);
  const decoys = shuffled(rng, decoyPool).slice(0, 2);
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

  constructor(dataset: LadderDataset, categoryId: LadderCategoryId, seed = Date.now(), progress?: GuidedSessionProgress) {
    this.dataset = dataset;
    this.categoryId = categoryId;
    this.rng = createRng(seed);
    if (progress) {
      this.score = progress.score;
      this.misses = progress.misses;
      this.roundsCompleted = progress.roundsCompleted;
    }
    this.route = buildLadderRoute(dataset, categoryId, this.rng);
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

  private prepareChoices(): void {
    const correct = this.route.tiles[this.step];
    const previous = this.step === 0 ? this.route.starter : this.route.tiles[this.step - 1];
    const index = ladderIndex(this.dataset);
    const category = categoryById(this.categoryId);
    const usedIds = new Set(this.usedSongIds());
    const connectedIds = new Set<number>();
    for (const tileKey of usableTileKeys(category)) {
      for (const id of eligibleNeighborIds(previous.id, tileKey, this.dataset, index, category, new Set())) {
        connectedIds.add(id);
      }
    }
    const decoys: LadderSong[] = [];
    for (let attempts = 0; attempts < 5000 && decoys.length < 2; attempts++) {
      const candidate = pickRandom(this.rng, this.dataset.songs);
      if (candidate.id === correct.id) continue;
      if (usedIds.has(candidate.id)) continue;
      if (connectedIds.has(candidate.id)) continue;
      if (!category.isEligible(candidate, index.categoryContext)) continue;
      if (decoys.some((d) => d.id === candidate.id)) continue;
      decoys.push(candidate);
    }
    if (decoys.length < 2) {
      throw new Error("Unable to prepare two incorrect choices for this path.");
    }
    this.choices = shuffled(this.rng, [correct, ...decoys]);
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
    this.connectionChoices = pickConnectionChoices(this.rng, this.route.reasons[this.step], this.categoryId);
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

  guessConnection(reason: LadderTileKey): GuidedConnectionGuessResult {
    if (this.status !== "playing" || !this.awaitingConnectionGuess) {
      throw new Error("A connection cannot be guessed right now.");
    }
    const correctReason = this.route.reasons[this.step];
    const correct = reason === correctReason;
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
    this.route = buildLadderRoute(this.dataset, this.categoryId, this.rng);
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
