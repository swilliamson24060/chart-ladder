/**
 * Fame-band verification for the guided ladder.
 *
 * The point of fame weighting is to stop the game drawing songs nobody can
 * possibly recognise, WITHOUT handing players a shortcut. The load-bearing
 * check here is the "famous-answer heuristic" one: if the correct tile were
 * reliably the most recognisable of the three, a player could win with no
 * music knowledge at all - a worse game than the hard one. So each floor is
 * measured against the unfloored (Deep Cuts) baseline for the same
 * category, and must not make that leak worse.
 *
 * Connections are re-derived locally from the raw dataset rather than via
 * ladderConnectionReason(), because that helper deliberately ignores a
 * category's excludedTileKeys - for "We're Number 1!" it reports every pair
 * as same_peak_pos, since every song in the category peaked at #1.
 */
import { readFileSync } from "node:fs";
import {
  buildLadderDataset,
  GUIDED_PATH_LENGTH,
  GUIDED_PATH_POSITIONS,
  GuidedGameEngine,
  LADDER_CATEGORIES,
  LADDER_DIFFICULTIES,
  type LadderCategoryDef,
  type LadderConnectionType,
  type LadderDataset,
  type LadderRawData,
  type LadderTileKey,
} from "../ladder";
import type { LadderSongTile } from "../types";

let failures = 0;
function check(label: string, condition: boolean) {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures++;
}

// Deliberately duplicated from ladder.ts so this harness verifies the
// engine against an independent statement of the rules.
const TILE_CONNECTION_TYPES: Record<LadderTileKey, LadderConnectionType[]> = {
  same_artist: ["same_performer", "same_artist_identity"],
  band_collab: ["collaboration", "band_membership"],
  same_genre: ["same_song_genre"],
  same_award: ["same_award"],
  top_40: ["top_40"],
  outside_top_40: ["outside_top_40"],
  long_run: ["long_run"],
  short_run: ["short_run"],
};

const raw: LadderRawData = JSON.parse(
  readFileSync(new URL("../../../../../data/connections.json", import.meta.url), "utf8"),
);
const dataset = buildLadderDataset(raw);

/** Every tile key the category permits that genuinely links these two songs. */
function trueKeys(dataset: LadderDataset, aId: number, bId: number, category: LadderCategoryDef): LadderTileKey[] {
  const excluded = new Set(category.excludedTileKeys ?? []);
  const found: LadderTileKey[] = [];
  for (const [tileKey, connTypes] of Object.entries(TILE_CONNECTION_TYPES) as Array<[LadderTileKey, LadderConnectionType[]]>) {
    if (excluded.has(tileKey)) continue;
    for (const connType of connTypes) {
      const groupMap = dataset.connections[connType];
      if (!groupMap) continue;
      if (Object.values(groupMap).some((ids) => ids.includes(aId) && ids.includes(bId))) {
        found.push(tileKey);
        break;
      }
    }
  }
  return found;
}

interface ComboResult {
  steps: number;
  answersBelowFloor: number;
  decoysBelowFloor: number;
  badConnectionCounts: number;
  answerWasMostFamous: number;
  answerFameTotal: number;
  decoyFameTotal: number;
  decoyCount: number;
  buildFailures: number;
}

const ROUNDS_PER_COMBO = 40;

function runCombo(category: LadderCategoryDef, minFame: number): ComboResult {
  const r: ComboResult = {
    steps: 0, answersBelowFloor: 0, decoysBelowFloor: 0, badConnectionCounts: 0,
    answerWasMostFamous: 0, answerFameTotal: 0, decoyFameTotal: 0, decoyCount: 0, buildFailures: 0,
  };

  for (let round = 0; round < ROUNDS_PER_COMBO; round++) {
    let engine: GuidedGameEngine;
    try {
      engine = new GuidedGameEngine(dataset, category.id, 1000 + round, undefined, minFame);
    } catch {
      r.buildFailures++;
      continue;
    }

    for (let step = 0; step < GUIDED_PATH_LENGTH; step++) {
      const state = engine.getState();
      const previousPosition = GUIDED_PATH_POSITIONS[step];
      const previous = state.board[previousPosition.row][previousPosition.col].tile as LadderSongTile;
      const previousId = Number(previous.id);

      const connecting = state.choices.map((c) => trueKeys(dataset, previousId, Number(c.id), category).length > 0);
      const correctIndex = connecting.findIndex(Boolean);
      if (connecting.filter(Boolean).length !== 1) r.badConnectionCounts++;
      if (correctIndex === -1) break;

      const fames = state.choices.map((c) => dataset.songs[Number(c.id)].fame);
      r.steps++;
      r.answerFameTotal += fames[correctIndex];
      if (fames[correctIndex] < minFame) r.answersBelowFloor++;
      if (fames[correctIndex] === Math.max(...fames)) r.answerWasMostFamous++;
      fames.forEach((f, i) => {
        if (i === correctIndex) return;
        r.decoyCount++;
        r.decoyFameTotal += f;
        if (f < minFame) r.decoysBelowFloor++;
      });

      engine.chooseTile(correctIndex);
      engine.guessConnection(engine.peekCurrentReason()!);
    }
  }
  return r;
}

console.log(`Loaded ${dataset.songs.length} ladder songs (fame scores present: ${dataset.hasFameScores}).\n`);

console.log("Dataset carries fame scores:");
check("buildLadderDataset detects fame scores", dataset.hasFameScores === true);
check("Every song has a numeric fame in 0..100", dataset.songs.every((s) => s.fame >= 0 && s.fame <= 100));
check("Fame actually varies across songs", new Set(dataset.songs.map((s) => s.fame)).size > 100);

// Unfloored baseline per category - this is exactly the pre-fame behaviour,
// so it's the bar every floor has to beat rather than an abstract ideal.
const baseline = new Map<string, number>();
console.log("\nUnfloored baseline (pre-fame behaviour):");
for (const category of LADDER_CATEGORIES) {
  const r = runCombo(category, 0);
  const rate = r.answerWasMostFamous / Math.max(1, r.steps);
  baseline.set(category.id, rate);
  console.log(
    `  [${category.id}] ${r.steps} steps | answer fame ${(r.answerFameTotal / Math.max(1, r.steps)).toFixed(1)} ` +
      `vs decoy ${(r.decoyFameTotal / Math.max(1, r.decoyCount)).toFixed(1)} | "most famous wins" ${(100 * rate).toFixed(1)}%`,
  );
}

for (const difficulty of LADDER_DIFFICULTIES) {
  console.log(`\n=== ${difficulty.name} (minFame ${difficulty.minFame}) ===`);
  for (const category of LADDER_CATEGORIES) {
    const r = runCombo(category, difficulty.minFame);
    const rate = r.answerWasMostFamous / Math.max(1, r.steps);
    const base = baseline.get(category.id)!;
    console.log(
      `\n  [${category.id}] ${r.steps} steps | answer fame ${(r.answerFameTotal / Math.max(1, r.steps)).toFixed(1)} ` +
        `vs decoy ${(r.decoyFameTotal / Math.max(1, r.decoyCount)).toFixed(1)} | ` +
        `"most famous wins" ${(100 * rate).toFixed(1)}% (baseline ${(100 * base).toFixed(1)}%)`,
    );
    check(`  ${category.id}: every round built`, r.buildFailures === 0);
    check(`  ${category.id}: produced steps to inspect`, r.steps > 0);
    check(`  ${category.id}: every ANSWER clears the fame floor`, r.answersBelowFloor === 0);
    check(`  ${category.id}: every DECOY clears the fame floor`, r.decoysBelowFloor === 0);
    check(`  ${category.id}: exactly one connecting choice per step`, r.badConnectionCounts === 0);
    check(
      `  ${category.id}: fame floor doesn't worsen the recognisability leak`,
      rate <= base + 0.1,
    );
  }
}

console.log("\nDatasets without fame scores still work (backwards compatibility):");
{
  const legacy = buildLadderDataset({
    song_fields: ["title", "performer", "peak_pos", "max_wks_on_chart"],
    songs: raw.songs.map(([t, p, peak, wks]) => [t, p, peak, wks] as [string, string, number, number]),
    connections: raw.connections,
  });
  check("A dataset with no fame column reports hasFameScores false", legacy.hasFameScores === false);
  let built = true;
  try {
    // A high floor against an unscored dataset must degrade to the old
    // uniform behaviour rather than filtering the pool down to nothing.
    built = new GuidedGameEngine(legacy, "top-tier", 7, undefined, 70).getState().choices.length === 3;
  } catch {
    built = false;
  }
  check("A fame floor against an unscored dataset still builds a round", built);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
