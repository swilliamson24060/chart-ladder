import {
  buildLadderDataset,
  LADDER_CATEGORIES,
  type LadderCategoryDef,
  type LadderCategoryId,
  type LadderRawData,
} from "@chartcross/engine";
import rawConnections from "../../../data/connections.json";

export type CategoryId = LadderCategoryId;
export type GameCategory = LadderCategoryDef;

export const ladderDataset = buildLadderDataset(rawConnections as unknown as LadderRawData);

// Adding a category later is a one-line addition to LADDER_CATEGORIES in
// packages/engine/src/engine/ladder.ts - nothing here needs to change.
export const GAME_CATEGORIES: GameCategory[] = LADDER_CATEGORIES;

export const defaultCategory = GAME_CATEGORIES[0];
