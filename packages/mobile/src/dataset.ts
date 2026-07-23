import { buildDataset, Dataset } from "@chartcross/engine";
import oneHitWonderSongs from "../../../data/categories/one-hit-wonders/songs.json";
import oneHitWonderArtists from "../../../data/categories/one-hit-wonders/artists.json";
import lightningSongs from "../../../data/categories/lightning-strikes-twice/songs.json";
import lightningArtists from "../../../data/categories/lightning-strikes-twice/artists.json";
import numberOneSongs from "../../../data/categories/number-one-hits/songs.json";
import numberOneArtists from "../../../data/categories/number-one-hits/artists.json";
import topTierSongs from "../../../data/categories/top-tier/songs.json";
import topTierArtists from "../../../data/categories/top-tier/artists.json";

export type CategoryId =
  | "one-hit-wonders"
  | "lightning-strikes-twice"
  | "number-one-hits"
  | "top-tier";

export interface GameCategory {
  id: CategoryId;
  name: string;
  description: string;
  dataset: Dataset;
}

export const GAME_CATEGORIES: GameCategory[] = [
  {
    id: "one-hit-wonders",
    name: "One Hit Wonders",
    description: "Artists with exactly one Hot 100 hit.",
    dataset: buildDataset(oneHitWonderSongs, oneHitWonderArtists),
  },
  {
    id: "lightning-strikes-twice",
    name: "Lightning Strikes Twice",
    description: "Artists with exactly two Hot 100 hits.",
    dataset: buildDataset(lightningSongs, lightningArtists),
  },
  {
    id: "number-one-hits",
    name: "We're Number 1!",
    description: "Songs that reached the top of the Hot 100.",
    dataset: buildDataset(numberOneSongs, numberOneArtists),
  },
  {
    id: "top-tier",
    name: "The Top Tier",
    description: "Every song appearing in the weekly Top 40.",
    dataset: buildDataset(topTierSongs, topTierArtists),
  },
];

export const defaultCategory = GAME_CATEGORIES[0];
