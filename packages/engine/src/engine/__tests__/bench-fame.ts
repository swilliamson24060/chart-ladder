/**
 * Recognisability-leak benchmark. Deliberately NOT part of `npm test`.
 *
 * Measures how often "just pick the song you've heard of" wins, which is
 * the failure mode fame weighting can introduce: if the correct tile were
 * reliably the most recognisable of the three, a player could win with no
 * music knowledge at all. Chance is 33.3%.
 *
 * This needs a large sample to say anything - a proportion near 50% has a
 * standard error around 14pp at n=50, so the fast suite reports the number
 * without asserting on it. Run this when changing fame scoring, route
 * construction, or the connection type mix:
 *
 *     npm run bench:fame -w @chartcross/engine
 */
import { readFileSync } from "node:fs";
import {
  buildLadderDataset,
  GUIDED_PATH_LENGTH,
  GUIDED_PATH_POSITIONS,
  GuidedGameEngine,
  LADDER_CATEGORIES,
  LADDER_DIFFICULTIES,
  type LadderRawData,
} from "../ladder";
import type { LadderSongTile } from "../types";

const ROUNDS = 120; // 600 steps per category/difficulty cell

const raw: LadderRawData = JSON.parse(
  readFileSync(new URL("../../../../../data/connections.json", import.meta.url), "utf8"),
);
const dataset = buildLadderDataset(raw);

function measure(categoryId: (typeof LADDER_CATEGORIES)[number]["id"], minFame: number) {
  let steps = 0;
  let famousWins = 0;
  let answerFame = 0;
  let decoyFame = 0;
  let decoys = 0;

  for (let seed = 0; seed < ROUNDS; seed++) {
    let engine: GuidedGameEngine;
    try {
      engine = new GuidedGameEngine(dataset, categoryId, 200000 + seed, undefined, minFame);
    } catch {
      continue;
    }
    for (let step = 0; step < GUIDED_PATH_LENGTH; step++) {
      const state = engine.getState();
      const correctIndex = engine.peekCorrectChoiceIndex();
      if (correctIndex < 0) break;
      const fames = (state.choices as LadderSongTile[]).map((c) => dataset.songs[Number(c.id)].fame);
      steps++;
      answerFame += fames[correctIndex];
      if (fames[correctIndex] === Math.max(...fames)) famousWins++;
      fames.forEach((f, i) => {
        if (i === correctIndex) return;
        decoys++;
        decoyFame += f;
      });
      engine.chooseTile(correctIndex);
      engine.guessConnection(engine.peekCurrentReason()!);
    }
  }
  return {
    steps,
    rate: steps ? famousWins / steps : 0,
    answer: steps ? answerFame / steps : 0,
    decoy: decoys ? decoyFame / decoys : 0,
  };
}

console.log(`Recognisability leak - chance is 33.3%, ${ROUNDS} rounds per cell\n`);
const header = "category".padEnd(24) + LADDER_DIFFICULTIES.map((d) => d.name.padStart(14)).join("");
console.log(header);
console.log("-".repeat(header.length));

const worst: Array<{ label: string; rate: number }> = [];
for (const category of LADDER_CATEGORIES) {
  const cells = LADDER_DIFFICULTIES.map((d) => {
    const r = measure(category.id, d.minFame);
    worst.push({ label: `${category.id} / ${d.name}`, rate: r.rate });
    return `${(100 * r.rate).toFixed(1)}%`.padStart(14);
  });
  console.log(category.id.padEnd(24) + cells.join(""));
}

worst.sort((a, b) => b.rate - a.rate);
console.log(`\nWorst cells:`);
for (const w of worst.slice(0, 5)) console.log(`  ${w.label.padEnd(34)} ${(100 * w.rate).toFixed(1)}%`);
console.log(`\nAnything sustained above ~55% means recognisability alone is carrying the round.`);
