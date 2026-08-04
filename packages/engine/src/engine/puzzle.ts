/**
 * The puzzle mode: the whole ladder at once instead of a linear gauntlet.
 *
 * The player sees all nine candidate songs together - the five that form
 * the chain plus four decoys - and works inward from both ends. START and
 * ANCHOR begin locked; a rung can only be filled when it sits next to an
 * already-locked rung, so the two open slots at any moment are the ones
 * adjacent to the frontier. Solving one end constrains the other, and the
 * final middle rung falls out of what's left.
 *
 * That last property is the point. In the step-by-step mode every rung is
 * an independent 1-in-3 and nothing you work out at step 2 helps at step 3.
 * Here partial knowledge compounds: you place the songs you're sure of
 * first, and the ones you don't know get squeezed from both sides.
 *
 * Route construction, fame floors and category rules are all shared with
 * the guided mode - see ladder.ts. The only thing this file adds is the
 * bank of candidates and the locking rules.
 */
import { createEmptyBoard, END_ANCHOR_POS, STARTER_POS } from "./board";
import {
  buildLadderRoute,
  categoryById,
  DEFAULT_MIN_FAME,
  GUIDED_PATH_LENGTH,
  GUIDED_PATH_POSITIONS,
  ladderIndex,
  ladderTrueConnections,
  meetsFame,
  categoryPoolSize,
  MIN_CATEGORY_POOL,
  type LadderCategoryId,
  type LadderDataset,
  type LadderRoute,
  type LadderSong,
  type LadderTileKey,
  type GuidedPathConnection,
  toTile,
  usableTileKeys,
} from "./ladder";
import { createRng, pickRandom, randomInt } from "./rng";
import { Board, LadderSongTile } from "./types";

/** Four decoys alongside the five chain songs - nine tiles in the bank. */
export const PUZZLE_DECOY_COUNT = 4;
export const PUZZLE_BANK_SIZE = GUIDED_PATH_LENGTH + PUZZLE_DECOY_COUNT;

export const PUZZLE_TILE_POINTS = 25;
export const PUZZLE_CONNECTION_BONUS = 10;

/**
 * Wrong placements allowed per ladder. A shared pool rather than per-rung
 * lives, so a player can spend their mistakes wherever they choose - the
 * whole appeal of seeing the board at once is being able to attack the
 * rungs you're confident about first.
 */
export const PUZZLE_MISTAKE_ALLOWANCE = 4;

export type PuzzleStatus = "playing" | "solved" | "failed" | "session-over";

/** Carried across rounds and into a saved game - see savedGame.ts. */
export interface PuzzleSessionProgress {
  score: number;
  roundsCompleted: number;
}

export interface PuzzleBankTile {
  tile: LadderSongTile;
  /** Set once the tile has been correctly placed; index into GUIDED_PATH_POSITIONS. */
  placedAt: number | null;
}

export interface PuzzlePlacementResult {
  legal: boolean;
  reason?: string;
  correct: boolean;
  /** The connection linking the newly locked rung to the neighbour it attached to. */
  linkedReason?: LadderTileKey;
  awaitingConnectionGuess: boolean;
  pointsAwarded: number;
  mistakesRemaining: number;
  status: PuzzleStatus;
}

export interface PuzzleConnectionResult {
  legal: boolean;
  reason?: string;
  correct: boolean;
  correctReason: LadderTileKey;
  pointsAwarded: number;
  status: PuzzleStatus;
}

export interface PuzzleState {
  board: Board;
  bank: PuzzleBankTile[];
  /** Rung indices (into GUIDED_PATH_POSITIONS) that are locked, including START and ANCHOR. */
  lockedRungs: number[];
  /** Empty rungs adjacent to a locked one - the only legal targets right now. */
  openRungs: number[];
  score: number;
  mistakesRemaining: number;
  status: PuzzleStatus;
  awaitingConnectionGuess: boolean;
  connectionChoices: LadderTileKey[];
  roundsCompleted: number;
  /** Links closed so far, for drawing lines on the board and reviewing the finished chain. */
  completedConnections: GuidedPathConnection[];
}

const FIRST_RUNG = 1;
const LAST_RUNG = GUIDED_PATH_LENGTH; // GUIDED_PATH_POSITIONS has START at 0 and ANCHOR at length-1

function shuffled<T>(rng: () => number, items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const puzzlePlayability = new WeakMap<LadderDataset, Map<string, boolean>>();

/**
 * Whether a category can produce a *complete* puzzle, decoys included.
 *
 * Stricter than isCategoryPlayable, which only checks that a route exists.
 * A thin pool can route fine and still fail to supply four songs that
 * connect to nothing in the chain - Country / One Hit Wonders has 55
 * eligible songs, routes happily, then has to reach below the fame floor
 * for decoys, which leaves the answers visibly more recognisable than the
 * wrong options. This is the check the category picker should use.
 */
export function isPuzzlePlayable(
  dataset: LadderDataset,
  categoryId: LadderCategoryId,
  minFame: number = DEFAULT_MIN_FAME,
): boolean {
  let cache = puzzlePlayability.get(dataset);
  if (!cache) {
    cache = new Map();
    puzzlePlayability.set(dataset, cache);
  }
  const key = `${categoryId}@${minFame}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
  // A category needs to work *most* of the time, not every time. Route
  // building is a randomised search, so even a comfortable pool occasionally
  // draws a starter it can't chain from - Pop & Country / We're Number 1!
  // builds cleanly on 7 of 8 seeds. Demanding a perfect run excluded it
  // outright; callers handle the occasional miss by retrying (see
  // createPuzzleWithRetry).
  const MIN_CLEAN_SEEDS = Math.ceil(SEEDS.length * 0.75);
  let clean = 0;
  try {
    // Cheap gate first: below MIN_CATEGORY_POOL a category isn't reliably
    // playable regardless of whether one lucky seed builds.
    if (categoryPoolSize(dataset, categoryId, minFame) < MIN_CATEGORY_POOL) throw new Error("pool too small");
    for (const seed of SEEDS) {
      try {
        const state = new PuzzleGameEngine(dataset, categoryId, seed, minFame).getState();
        if (state.bank.length !== PUZZLE_BANK_SIZE) continue;
        // Every bank tile must clear the requested floor, or the answers and
        // decoys sit in different recognisability bands.
        if (state.bank.some((entry) => dataset.songs[Number(entry.tile.id)].fame < minFame)) continue;
        clean++;
      } catch {
        // this seed couldn't route; others may
      }
    }
  } catch {
    clean = 0;
  }
  const playable = clean >= MIN_CLEAN_SEEDS;
  cache.set(key, playable);
  return playable;
}

/**
 * Builds a puzzle, retrying with fresh seeds when the route builder happens
 * to draw a starter it can't chain from. Playable categories still miss
 * occasionally - it's a randomised search - and a player shouldn't see that
 * as a crash.
 */
export function createPuzzleWithRetry(
  dataset: LadderDataset,
  categoryId: LadderCategoryId,
  seed: number,
  minFame: number = DEFAULT_MIN_FAME,
  progress?: PuzzleSessionProgress,
  attempts = 8,
): PuzzleGameEngine {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return new PuzzleGameEngine(dataset, categoryId, seed + i * 7919, minFame, progress);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Could not build a puzzle for "${categoryId}".`);
}

export class PuzzleGameEngine {
  private dataset: LadderDataset;
  private categoryId: LadderCategoryId;
  private rng: () => number;
  private minFame: number;
  /** The floor the current route was actually built at, so decoys match the answers' band. */
  private effectiveMinFame: number = DEFAULT_MIN_FAME;
  private route: LadderRoute;
  private board: Board;
  private bank: PuzzleBankTile[] = [];
  private locked = new Set<number>();
  private score = 0;
  private mistakes = 0;
  private roundsCompleted = 0;
  private status: PuzzleStatus = "playing";
  private awaitingConnectionGuess = false;
  private connectionChoices: LadderTileKey[] = [];
  private acceptedReasons = new Set<LadderTileKey>();
  private pendingReason: LadderTileKey | null = null;
  private completedConnections: GuidedPathConnection[] = [];

  constructor(
    dataset: LadderDataset,
    categoryId: LadderCategoryId,
    seed = Date.now(),
    minFame: number = DEFAULT_MIN_FAME,
    progress?: PuzzleSessionProgress,
  ) {
    this.dataset = dataset;
    this.categoryId = categoryId;
    this.rng = createRng(seed);
    this.minFame = minFame;
    if (progress) {
      this.score = progress.score;
      this.roundsCompleted = progress.roundsCompleted;
    }
    const built = buildLadderRoute(dataset, categoryId, this.rng, this.minFame);
    this.route = built.route;
    this.effectiveMinFame = built.minFameUsed;
    this.board = createEmptyBoard();
    this.setupRound();
  }

  private setupRound(): void {
    this.board = createEmptyBoard();
    const starterCell = this.board[STARTER_POS.row][STARTER_POS.col];
    starterCell.tile = toTile(this.route.starter);
    starterCell.role = "STARTER";
    const anchorCell = this.board[END_ANCHOR_POS.row][END_ANCHOR_POS.col];
    anchorCell.tile = toTile(this.route.anchor);
    anchorCell.role = "END_ANCHOR";

    this.locked = new Set([0, GUIDED_PATH_POSITIONS.length - 1]);
    this.bank = shuffled(this.rng, [...this.route.tiles, ...this.pickDecoys()]).map((song) => ({
      tile: toTile(song),
      placedAt: null,
    }));
    this.awaitingConnectionGuess = false;
    this.connectionChoices = [];
    this.pendingReason = null;
    this.completedConnections = [];
  }

  /**
   * Four songs that connect to *nothing* in the chain - not just to their
   * neighbours. In the step-by-step mode a decoy only had to fail against
   * the one previous song; here every candidate is visible at once, so a
   * decoy that linked to any chain member would give the puzzle a second
   * valid solution.
   */
  private pickDecoys(): LadderSong[] {
    const index = ladderIndex(this.dataset);
    const category = categoryById(this.categoryId);
    const chain = [this.route.starter, ...this.route.tiles, this.route.anchor];
    const chainTiles = chain.map(toTile);
    const usedIds = new Set(chain.map((s) => s.id));

    const decoys: LadderSong[] = [];
    for (const floor of [this.effectiveMinFame, Math.floor(this.effectiveMinFame / 2), 0]) {
      for (let attempts = 0; attempts < 20000 && decoys.length < PUZZLE_DECOY_COUNT; attempts++) {
        const candidate = pickRandom(this.rng, this.dataset.songs);
        if (usedIds.has(candidate.id)) continue;
        if (!meetsFame(this.dataset, candidate, floor)) continue;
        if (!category.isEligible(candidate, index.categoryContext)) continue;
        if (decoys.some((d) => d.id === candidate.id)) continue;
        const candidateTile = toTile(candidate);
        const connectsToChain = chainTiles.some(
          (member) => ladderTrueConnections(member, candidateTile, this.dataset, this.categoryId).length > 0,
        );
        if (connectsToChain) continue;
        decoys.push(candidate);
        usedIds.add(candidate.id);
      }
      if (decoys.length === PUZZLE_DECOY_COUNT) return decoys;
    }
    throw new Error(`Unable to find ${PUZZLE_DECOY_COUNT} unconnected decoys for category "${this.categoryId}".`);
  }

  /** Empty rungs sitting next to a locked one - the frontier growing in from both ends. */
  private openRungs(): number[] {
    const open: number[] = [];
    for (let rung = FIRST_RUNG; rung <= LAST_RUNG; rung++) {
      if (this.locked.has(rung)) continue;
      if (this.locked.has(rung - 1) || this.locked.has(rung + 1)) open.push(rung);
    }
    return open;
  }

  getState(): PuzzleState {
    return {
      board: this.board.map((row) => row.map((cell) => ({ ...cell }))),
      bank: this.bank.map((entry) => ({ ...entry })),
      lockedRungs: [...this.locked].sort((a, b) => a - b),
      openRungs: this.openRungs(),
      score: this.score,
      mistakesRemaining: PUZZLE_MISTAKE_ALLOWANCE - this.mistakes,
      status: this.status,
      awaitingConnectionGuess: this.awaitingConnectionGuess,
      connectionChoices: [...this.connectionChoices],
      roundsCompleted: this.roundsCompleted,
      completedConnections: [...this.completedConnections],
    };
  }

  /** The bank index belonging at `rung`, or -1. Never exposed via getState(). */
  peekCorrectBankIndex(rung: number): number {
    if (this.status !== "playing") return -1;
    const song = this.route.tiles[rung - 1];
    if (!song) return -1;
    return this.bank.findIndex((entry) => entry.placedAt === null && Number(entry.tile.id) === song.id);
  }

  /**
   * Places a bank tile on an open rung. Correct placements lock the rung
   * (opening its neighbour) and then wait on a connection guess; wrong ones
   * spend a mistake and leave the tile in the bank.
   */
  placeTile(bankIndex: number, rung: number): PuzzlePlacementResult {
    const fail = (reason: string): PuzzlePlacementResult => ({
      legal: false,
      reason,
      correct: false,
      awaitingConnectionGuess: this.awaitingConnectionGuess,
      pointsAwarded: 0,
      mistakesRemaining: PUZZLE_MISTAKE_ALLOWANCE - this.mistakes,
      status: this.status,
    });

    if (this.status !== "playing") return fail("The puzzle is already over.");
    if (this.awaitingConnectionGuess) return fail("Name the connection before placing another tile.");
    const entry = this.bank[bankIndex];
    if (!entry) return fail("No tile at that bank index.");
    if (entry.placedAt !== null) return fail("That tile is already placed.");
    if (!this.openRungs().includes(rung)) {
      return fail("That rung isn't open yet - build outward from START or ANCHOR.");
    }

    const expected = this.route.tiles[rung - 1];
    if (Number(entry.tile.id) !== expected.id) {
      this.mistakes++;
      if (this.mistakes >= PUZZLE_MISTAKE_ALLOWANCE) this.status = "failed";
      return {
        legal: true,
        correct: false,
        awaitingConnectionGuess: false,
        pointsAwarded: 0,
        mistakesRemaining: PUZZLE_MISTAKE_ALLOWANCE - this.mistakes,
        status: this.status,
      };
    }

    const position = GUIDED_PATH_POSITIONS[rung];
    this.board[position.row][position.col].tile = entry.tile;
    entry.placedAt = rung;
    this.locked.add(rung);
    this.score += PUZZLE_TILE_POINTS;

    // The link that just closed: whichever locked neighbour this rung
    // attached to. Attaching downward closes the hop below this rung,
    // attaching upward closes the one above it.
    const attachedBelow = this.locked.has(rung - 1);
    const lowerRung = attachedBelow ? rung - 1 : rung;
    const reason = this.linkReason(lowerRung);
    const from = this.chainSongAt(lowerRung);
    const to = this.chainSongAt(lowerRung + 1);

    const fromPos = GUIDED_PATH_POSITIONS[lowerRung];
    const toPos = GUIDED_PATH_POSITIONS[lowerRung + 1];
    this.completedConnections.push({
      fromRow: fromPos.row,
      fromCol: fromPos.col,
      toRow: toPos.row,
      toCol: toPos.col,
      reason,
    });

    this.pendingReason = reason;
    this.acceptedReasons = new Set(
      ladderTrueConnections(toTile(from), toTile(to), this.dataset, this.categoryId),
    );
    this.acceptedReasons.add(reason);
    this.connectionChoices = this.pickConnectionChoices(reason);
    this.awaitingConnectionGuess = true;

    return {
      legal: true,
      correct: true,
      linkedReason: reason,
      awaitingConnectionGuess: true,
      pointsAwarded: PUZZLE_TILE_POINTS,
      mistakesRemaining: PUZZLE_MISTAKE_ALLOWANCE - this.mistakes,
      status: this.status,
    };
  }

  /**
   * The connection for the hop from `lowerRung` to `lowerRung + 1`.
   *
   * LadderRoute keeps the five inter-tile links in `reasons` but stores the
   * final hop onto ANCHOR separately as `anchorReason`, so the last rung
   * has to be special-cased - reasons[5] doesn't exist.
   */
  private linkReason(lowerRung: number): LadderTileKey {
    return lowerRung < GUIDED_PATH_LENGTH ? this.route.reasons[lowerRung] : this.route.anchorReason;
  }

  /** The chain song at a rung index, where 0 is START and the last index is ANCHOR. */
  private chainSongAt(rung: number): LadderSong {
    if (rung === 0) return this.route.starter;
    if (rung === GUIDED_PATH_POSITIONS.length - 1) return this.route.anchor;
    return this.route.tiles[rung - 1];
  }

  private pickConnectionChoices(correct: LadderTileKey): LadderTileKey[] {
    const pool = usableTileKeys(categoryById(this.categoryId)).filter((key) => key !== correct);
    const falseKeys = pool.filter((key) => !this.acceptedReasons.has(key));
    const decoys = shuffled(this.rng, falseKeys).slice(0, 2);
    for (const key of shuffled(this.rng, pool)) {
      if (decoys.length >= 2) break;
      if (!decoys.includes(key)) decoys.push(key);
    }
    return shuffled(this.rng, [correct, ...decoys]);
  }

  /** Any genuinely true connection scores the bonus - same rule as the guided mode. */
  guessConnection(reason: LadderTileKey): PuzzleConnectionResult {
    if (this.status !== "playing" || !this.awaitingConnectionGuess || !this.pendingReason) {
      throw new Error("A connection cannot be guessed right now.");
    }
    const correctReason = this.pendingReason;
    const correct = this.acceptedReasons.has(reason);
    if (correct) this.score += PUZZLE_CONNECTION_BONUS;
    this.awaitingConnectionGuess = false;
    this.connectionChoices = [];
    this.pendingReason = null;

    if (this.locked.size === GUIDED_PATH_POSITIONS.length) {
      this.status = "solved";
      this.roundsCompleted++;
    }
    return {
      legal: true,
      correct,
      correctReason,
      pointsAwarded: correct ? PUZZLE_CONNECTION_BONUS : 0,
      status: this.status,
    };
  }

  peekPendingReason(): LadderTileKey | null {
    return this.pendingReason;
  }

  startNextRound(): void {
    if (this.status !== "solved") throw new Error("A new round can only start after solving the current puzzle.");
    const built = buildLadderRoute(this.dataset, this.categoryId, this.rng, this.minFame);
    this.route = built.route;
    this.effectiveMinFame = built.minFameUsed;
    this.status = "playing";
    this.mistakes = 0;
    this.setupRound();
  }

  getProgress(): PuzzleSessionProgress {
    return { score: this.score, roundsCompleted: this.roundsCompleted };
  }

  /** Ends a session voluntarily from the solved screen, so the score can be submitted. */
  endSession(): void {
    if (this.status !== "solved") throw new Error("A session can only be ended after solving a puzzle.");
    this.status = "session-over";
  }
}
