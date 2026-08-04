/**
 * Puzzle-mode verification.
 *
 * The properties that matter are structural: the bank must contain exactly
 * the five chain songs plus four decoys that connect to nothing, rungs must
 * only open next to a locked neighbour (so the ladder genuinely grows in
 * from both ends), and the puzzle must have exactly one solution.
 */
import { readFileSync } from "node:fs";
import {
  buildLadderDataset,
  GUIDED_PATH_LENGTH,
  GUIDED_PATH_POSITIONS,
  LADDER_BASE_CATEGORIES,
  LADDER_CATEGORIES,
  LADDER_DIFFICULTIES,
  LADDER_GENRES,
  categoryById,
  ladderCategoryId,
  isCategoryPlayable,
  ladderTrueConnections,
  type LadderRawData,
} from "../ladder";
import {
  PUZZLE_BANK_SIZE,
  PUZZLE_CONNECTION_BONUS,
  PUZZLE_DECOY_COUNT,
  PUZZLE_MISTAKE_ALLOWANCE,
  PUZZLE_TILE_POINTS,
  PuzzleGameEngine,
} from "../puzzle";
import type { LadderSongTile } from "../types";

let failures = 0;
function check(label: string, condition: boolean) {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures++;
}

const raw: LadderRawData = JSON.parse(
  readFileSync(new URL("../../../../../data/connections.json", import.meta.url), "utf8"),
);
const dataset = buildLadderDataset(raw);

console.log(`Loaded ${dataset.songs.length} ladder songs.\n`);

/**
 * A representative slice of the 24 genre x rule combinations: every rule in
 * its all-genres form, plus every genre paired with a different rule. Runs
 * in a fraction of the time while still touching each rule and each genre.
 */
const SAMPLE_CATEGORIES = [
  ...LADDER_BASE_CATEGORIES.map((base) => categoryById(ladderCategoryId(base.id))),
  // Several genre/rule pairings genuinely can't build a chain (see
  // isCategoryPlayable), so each genre contributes its first playable rule
  // rather than a fixed one - otherwise the sample spends its time watching
  // the route builder exhaust every retry on a dead combination.
  ...LADDER_GENRES.map((genre) => {
    const base = LADDER_BASE_CATEGORIES.find((b) =>
      isCategoryPlayable(dataset, ladderCategoryId(b.id, genre.id)),
    )!;
    return categoryById(ladderCategoryId(base.id, genre.id));
  }),
];

console.log("Bank composition and decoy isolation:");
{
  let bankSizeWrong = 0;
  let decoyConnected = 0;
  let rounds = 0;

  for (const category of SAMPLE_CATEGORIES) {
    for (let seed = 0; seed < 8; seed++) {
      const engine = new PuzzleGameEngine(dataset, category.id, 70000 + seed);
      const state = engine.getState();
      rounds++;
      if (state.bank.length !== PUZZLE_BANK_SIZE) bankSizeWrong++;

      // Work out which bank tiles are the real chain by asking the engine
      // for each rung's answer, then treat the rest as decoys.
      const chainIds = new Set<string>();
      for (let rung = 1; rung <= GUIDED_PATH_LENGTH; rung++) {
        const idx = engine.peekCorrectBankIndex(rung);
        if (idx >= 0) chainIds.add(state.bank[idx].tile.id);
      }
      const startTile = state.board[GUIDED_PATH_POSITIONS[0].row][GUIDED_PATH_POSITIONS[0].col].tile as LadderSongTile;
      const anchorTile = state.board[GUIDED_PATH_POSITIONS[6].row][GUIDED_PATH_POSITIONS[6].col].tile as LadderSongTile;
      const chainTiles = [startTile, anchorTile, ...state.bank.filter((b) => chainIds.has(b.tile.id)).map((b) => b.tile)];

      for (const entry of state.bank) {
        if (chainIds.has(entry.tile.id)) continue;
        // A decoy must connect to nothing in the chain, or the puzzle would
        // have more than one valid arrangement.
        for (const member of chainTiles) {
          if (ladderTrueConnections(member, entry.tile, dataset, category.id).length > 0) decoyConnected++;
        }
      }
    }
  }

  console.log(`  (info) ${rounds} rounds across ${SAMPLE_CATEGORIES.length} categories`);
  check(`Every bank holds ${PUZZLE_BANK_SIZE} tiles (5 chain + ${PUZZLE_DECOY_COUNT} decoys)`, bankSizeWrong === 0);
  check("No decoy connects to any song in the chain", decoyConnected === 0);
}

console.log("\nAnchored growth - rungs only open beside a locked neighbour:");
{
  const engine = new PuzzleGameEngine(dataset, "top-tier", 4242);
  let state = engine.getState();
  check("START and ANCHOR begin locked", state.lockedRungs.includes(0) && state.lockedRungs.includes(6));
  check("Exactly the two end rungs are open at the start", state.openRungs.join() === "1,5");

  // The middle rung must be unreachable until its neighbours are locked.
  const middleAttempt = engine.placeTile(engine.peekCorrectBankIndex(3), 3);
  check("Placing into the middle rung is rejected while it's closed", middleAttempt.legal === false);

  // Solve inward from the START end and watch the frontier advance.
  const openedAfter: string[] = [];
  for (const rung of [1, 2, 3, 4, 5]) {
    const idx = engine.peekCorrectBankIndex(rung);
    const placed = engine.placeTile(idx, rung);
    if (!placed.legal || !placed.correct) {
      check(`Rung ${rung} accepted its correct tile`, false);
      break;
    }
    engine.guessConnection(engine.peekPendingReason()!);
    openedAfter.push(engine.getState().openRungs.join() || "-");
  }
  console.log(`  (info) open rungs after each placement: ${openedAfter.join(" -> ")}`);
  state = engine.getState();
  check("Solving every rung marks the puzzle solved", state.status === "solved");
  check("All seven rungs end up locked", state.lockedRungs.length === GUIDED_PATH_POSITIONS.length);
  check("Every bank tile that belongs is placed", state.bank.filter((b) => b.placedAt !== null).length === GUIDED_PATH_LENGTH);
  check(`Decoys are never placed`, state.bank.filter((b) => b.placedAt === null).length === PUZZLE_DECOY_COUNT);
  check(
    "A perfect solve scores tile points plus the bonus on every rung",
    state.score === GUIDED_PATH_LENGTH * (PUZZLE_TILE_POINTS + PUZZLE_CONNECTION_BONUS),
  );
}

console.log("\nMistakes:");
{
  const engine = new PuzzleGameEngine(dataset, "top-tier", 555);
  const correctForRung1 = engine.peekCorrectBankIndex(1);
  const wrongIndex = engine.getState().bank.findIndex((_, i) => i !== correctForRung1);
  const before = engine.getState().mistakesRemaining;
  const result = engine.placeTile(wrongIndex, 1);
  check("A wrong placement is a legal move that scores nothing", result.legal && !result.correct && result.pointsAwarded === 0);
  check("A wrong placement spends one mistake", engine.getState().mistakesRemaining === before - 1);
  check("A wrong placement leaves the tile in the bank", engine.getState().bank[wrongIndex].placedAt === null);
  check("A wrong placement doesn't lock the rung", !engine.getState().lockedRungs.includes(1));
  check("A fresh wrong placement isn't flagged as already tried", !result.alreadyTried);

  const repeat = engine.placeTile(wrongIndex, 1);
  check("Retrying the same wrong tile on the same rung is flagged as already tried", repeat.alreadyTried === true);
  check(
    "Retrying the same wrong placement doesn't spend another mistake",
    engine.getState().mistakesRemaining === before - 1,
  );

  // Burn the rest of the allowance - a different wrong tile each time, since
  // retrying the one already tried above no longer spends a mistake.
  let guard = 0;
  const tried = new Set<number>([wrongIndex]);
  while (engine.getState().status === "playing" && guard++ < 20) {
    const idx = engine
      .getState()
      .bank.findIndex((b, i) => b.placedAt === null && i !== engine.peekCorrectBankIndex(1) && !tried.has(i));
    if (idx === -1) break;
    tried.add(idx);
    engine.placeTile(idx, 1);
  }
  check(`Running out of ${PUZZLE_MISTAKE_ALLOWANCE} mistakes fails the puzzle`, engine.getState().status === "failed");
  const afterFail = engine.placeTile(engine.peekCorrectBankIndex(1), 1);
  check("No further placements are accepted once failed", afterFail.legal === false);
}

console.log("\nEvery category and difficulty can be solved end to end:");
{
  for (const difficulty of LADDER_DIFFICULTIES) {
    let solved = 0;
    let attempted = 0;
    let buildErrors = 0;
    for (const category of SAMPLE_CATEGORIES) {
      for (let seed = 0; seed < 5; seed++) {
        attempted++;
        try {
          const engine = new PuzzleGameEngine(dataset, category.id, 80000 + seed, difficulty.minFame);
          // Alternate ends to exercise attaching from both directions.
          const order = [1, 5, 2, 4, 3];
          for (const rung of order) {
            const idx = engine.peekCorrectBankIndex(rung);
            const res = engine.placeTile(idx, rung);
            if (!res.legal) break;
            engine.guessConnection(engine.peekPendingReason()!);
          }
          if (engine.getState().status === "solved") solved++;
        } catch (err) {
          buildErrors++;
          if (buildErrors === 1) console.log(`  (first error) ${(err as Error).message}`);
        }
      }
    }
    check(
      `${difficulty.name}: all ${attempted} puzzles build and solve (${solved} solved, ${buildErrors} build errors)`,
      solved === attempted && buildErrors === 0,
    );
  }
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
