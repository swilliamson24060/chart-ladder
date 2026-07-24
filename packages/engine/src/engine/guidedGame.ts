import { createEmptyBoard, END_ANCHOR_POS, placeStarterAndAnchor, STARTER_POS } from "./board";
import { buildDataIndex, DataIndex, findArtistCandidatesFor, findCollabCandidatesFor } from "./dataIndex";
import { bestConnectionReason, tileYears } from "./moves";
import { createRng, pickRandom, randomInt } from "./rng";
import { tileValue } from "./tileValue";
import {
  ArtistTile,
  Board,
  ConnectionCategory,
  CONNECTION_CATEGORIES,
  Dataset,
  MatchableTile,
} from "./types";

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
  reason: ConnectionCategory;
}

export interface GuidedGameState {
  board: Board;
  choices: MatchableTile[];
  step: number;
  score: number;
  misses: number;
  roundsCompleted: number;
  status: GuidedGameStatus;
  awaitingConnectionGuess: boolean;
  hintReason: ConnectionCategory | null;
  completedConnections: GuidedPathConnection[];
  missedCorrectTile: MatchableTile | null;
}

export interface GuidedTileChoiceResult {
  correct: boolean;
  missed: boolean;
  needsConnectionGuess: boolean;
  correctTile: MatchableTile;
  pointsAwarded: number;
  misses: number;
  status: GuidedGameStatus;
}

export interface GuidedConnectionGuessResult {
  correct: boolean;
  correctReason: ConnectionCategory;
  pointsAwarded: number;
  status: GuidedGameStatus;
}

interface Route {
  starter: ArtistTile;
  anchor: ArtistTile;
  tiles: MatchableTile[];
  reasons: ConnectionCategory[];
  anchorReason: ConnectionCategory;
}

interface RouteIndex {
  dataIndex: DataIndex;
  allTiles: MatchableTile[];
  byYear: Map<number, MatchableTile[]>;
}

const routeIndexCache = new WeakMap<Dataset, RouteIndex>();

function tileKey(tile: MatchableTile): string {
  return `${tile.kind}:${tile.id}`;
}

function performerIds(tile: MatchableTile): string[] {
  return tile.kind === "ARTIST" ? [tile.id] : tile.performerIds;
}

/**
 * A guided edge must connect two distinct musical identities. An artist
 * cannot lead to their own song, and two songs by the same performer cannot
 * be used as successive answers, even though the legacy free-play rules
 * classify those pairs as an ARTIST connection.
 */
export function isSelfReferentialGuidedConnection(
  a: MatchableTile,
  b: MatchableTile,
): boolean {
  const identities = new Set(performerIds(a));
  return performerIds(b).some((id) => identities.has(id));
}

function shuffled<T>(rng: () => number, items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function routeIndex(dataset: Dataset): RouteIndex {
  const cached = routeIndexCache.get(dataset);
  if (cached) return cached;

  const allTiles: MatchableTile[] = [...dataset.artists, ...dataset.songs];
  const byYear = new Map<number, MatchableTile[]>();
  for (const tile of allTiles) {
    for (const year of tileYears(tile)) {
      const bucket = byYear.get(year) ?? [];
      bucket.push(tile);
      byYear.set(year, bucket);
    }
  }

  const result = { dataIndex: buildDataIndex(dataset), allTiles, byYear };
  routeIndexCache.set(dataset, result);
  return result;
}

function relatedCandidates(
  tile: MatchableTile,
  dataset: Dataset,
  index: RouteIndex,
): Record<ConnectionCategory, MatchableTile[]> {
  const collab = findCollabCandidatesFor(tile, dataset) as MatchableTile[];
  const artist = [...findArtistCandidatesFor(tile, dataset, index.dataIndex)] as MatchableTile[];
  const sameYearMap = new Map<string, MatchableTile>();
  for (const year of tileYears(tile)) {
    for (const candidate of index.byYear.get(year) ?? []) {
      if (bestConnectionReason(tile, candidate) === "SAME_YEAR") {
        sameYearMap.set(tileKey(candidate), candidate);
      }
    }
  }
  return { COLLAB: collab, ARTIST: artist, SAME_YEAR: [...sameYearMap.values()] };
}

function chooseRelated(
  tile: MatchableTile,
  dataset: Dataset,
  index: RouteIndex,
  used: Set<string>,
  rng: () => number,
  artistsOnly = false,
): { tile: MatchableTile; reason: ConnectionCategory } | null {
  const groups = relatedCandidates(tile, dataset, index);
  const available = shuffled(rng, CONNECTION_CATEGORIES)
    .map((reason) => ({
      reason,
      candidates: groups[reason].filter(
        (candidate) =>
          !used.has(tileKey(candidate)) &&
          !isSelfReferentialGuidedConnection(tile, candidate) &&
          (!artistsOnly || candidate.kind === "ARTIST"),
      ),
    }))
    .filter((group) => group.candidates.length > 0);
  if (available.length === 0) return null;
  const group = pickRandom(rng, available);
  return { tile: pickRandom(rng, group.candidates), reason: group.reason };
}

function buildRoute(dataset: Dataset, rng: () => number): Route {
  const index = routeIndex(dataset);
  for (let attempt = 0; attempt < 100; attempt++) {
    const starter = pickRandom(rng, dataset.artists);
    const used = new Set([tileKey(starter)]);
    const tiles: MatchableTile[] = [];
    const reasons: ConnectionCategory[] = [];
    let current: MatchableTile = starter;
    let failed = false;

    for (let step = 0; step < GUIDED_PATH_LENGTH; step++) {
      const next = chooseRelated(current, dataset, index, used, rng);
      if (!next) {
        failed = true;
        break;
      }
      tiles.push(next.tile);
      reasons.push(next.reason);
      used.add(tileKey(next.tile));
      current = next.tile;
    }
    if (failed) continue;

    const anchorChoice = chooseRelated(current, dataset, index, used, rng, true);
    if (!anchorChoice) continue;
    return {
      starter,
      anchor: anchorChoice.tile as ArtistTile,
      tiles,
      reasons,
      anchorReason: anchorChoice.reason,
    };
  }
  throw new Error("Unable to prepare a five-tile path for this category.");
}

export class GuidedGameEngine {
  private dataset: Dataset;
  private rng: () => number;
  private index: RouteIndex;
  private route: Route;
  private board: Board;
  private choices: MatchableTile[] = [];
  private step = 0;
  private score = 0;
  private misses = 0;
  private roundsCompleted = 0;
  private status: GuidedGameStatus = "playing";
  private awaitingConnectionGuess = false;
  private hintReason: ConnectionCategory | null = null;
  private completedConnections: GuidedPathConnection[] = [];
  private missedCorrectTile: MatchableTile | null = null;
  private pendingBasePoints = 0;
  private currentTilePlaced = false;

  constructor(dataset: Dataset, seed = Date.now(), progress?: GuidedSessionProgress) {
    this.dataset = dataset;
    this.rng = createRng(seed);
    this.index = routeIndex(dataset);
    if (progress) {
      this.score = progress.score;
      this.misses = progress.misses;
      this.roundsCompleted = progress.roundsCompleted;
    }
    this.route = buildRoute(dataset, this.rng);
    this.board = createEmptyBoard();
    placeStarterAndAnchor(this.board, this.route.starter, this.route.anchor);
    this.prepareChoices();
  }

  private prepareChoices(): void {
    const correct = this.route.tiles[this.step];
    const previous = this.step === 0 ? this.route.starter : this.route.tiles[this.step - 1];
    const excluded = new Set(this.route.tiles.map(tileKey));
    excluded.add(tileKey(this.route.starter));
    excluded.add(tileKey(this.route.anchor));
    const decoys: MatchableTile[] = [];

    for (let attempts = 0; attempts < 5000 && decoys.length < 2; attempts++) {
      const candidate = pickRandom(this.rng, this.index.allTiles);
      if (excluded.has(tileKey(candidate))) continue;
      if (decoys.some((tile) => tileKey(tile) === tileKey(candidate))) continue;
      if (bestConnectionReason(previous, candidate) !== null) continue;
      decoys.push(candidate);
    }
    if (decoys.length < 2) {
      throw new Error("Unable to prepare two incorrect choices for this path.");
    }
    this.choices = shuffled(this.rng, [correct, ...decoys]);
  }

  private basePointsForCurrentStep(): number {
    const tile = this.route.tiles[this.step];
    return (
      GUIDED_TILE_POINTS +
      tileValue(tile) +
      (this.step === 0 ? tileValue(this.route.starter) : 0) +
      (this.step === GUIDED_PATH_LENGTH - 1 ? tileValue(this.route.anchor) : 0)
    );
  }

  private placeCurrentTile(): void {
    if (this.currentTilePlaced) return;
    const tile = this.route.tiles[this.step];
    const currentPosition = GUIDED_PATH_POSITIONS[this.step + 1];
    const previousPosition = GUIDED_PATH_POSITIONS[this.step];
    this.board[currentPosition.row][currentPosition.col].tile = tile;
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
    this.hintReason = null;
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
      choices: [...this.choices],
      step: this.step,
      score: this.score,
      misses: this.misses,
      roundsCompleted: this.roundsCompleted,
      status: this.status,
      awaitingConnectionGuess: this.awaitingConnectionGuess,
      hintReason: this.hintReason,
      completedConnections: [...this.completedConnections],
      missedCorrectTile: this.missedCorrectTile,
    };
  }

  useHint(): ConnectionCategory | null {
    if (this.status !== "playing" || this.awaitingConnectionGuess) return null;
    this.hintReason = this.route.reasons[this.step];
    return this.hintReason;
  }

  chooseTile(index: number): GuidedTileChoiceResult {
    if (this.status !== "playing" || this.awaitingConnectionGuess) {
      throw new Error("A tile cannot be selected right now.");
    }
    const selected = this.choices[index];
    if (!selected) throw new Error("Invalid tile choice.");
    const correctTile = this.route.tiles[this.step];
    const missed = tileKey(selected) !== tileKey(correctTile);
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
        correctTile,
        pointsAwarded: 0,
        misses: this.misses,
        status: this.status,
      };
    }

    if (this.hintReason) {
      const pointsAwarded = this.completeStep(false);
      return {
        correct: !missed,
        missed,
        needsConnectionGuess: false,
        correctTile,
        pointsAwarded,
        misses: this.misses,
        status: this.status,
      };
    }

    this.awaitingConnectionGuess = true;
    return {
      correct: !missed,
      missed,
      needsConnectionGuess: true,
      correctTile,
      pointsAwarded: 0,
      misses: this.misses,
      status: this.status,
    };
  }

  guessConnection(reason: ConnectionCategory): GuidedConnectionGuessResult {
    if (this.status !== "playing" || !this.awaitingConnectionGuess) {
      throw new Error("A connection cannot be guessed right now.");
    }
    const correctReason = this.route.reasons[this.step];
    const correct = reason === correctReason;
    const pointsAwarded = this.completeStep(correct);
    return { correct, correctReason, pointsAwarded, status: this.status };
  }

  getProgress(): GuidedSessionProgress {
    return {
      score: this.score,
      misses: this.misses,
      roundsCompleted: this.roundsCompleted,
    };
  }

  startNextRound(): void {
    if (this.status !== "path-complete") {
      throw new Error("A new round can only start after completing the current path.");
    }
    this.route = buildRoute(this.dataset, this.rng);
    this.board = createEmptyBoard();
    placeStarterAndAnchor(this.board, this.route.starter, this.route.anchor);
    this.choices = [];
    this.step = 0;
    this.status = "playing";
    this.awaitingConnectionGuess = false;
    this.hintReason = null;
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
