import { Tile } from "./types";

const CONNECTOR_LABELS: Record<string, string> = {
  COLLAB: "Collab Connect",
  ARTIST: "Artist Connect",
  SAME_YEAR: "Same Year Connect",
};

export function tileLabel(tile: Tile): string {
  if (tile.kind === "ARTIST") return tile.name;
  if (tile.kind === "SONG") return tile.title;
  if (tile.kind === "CONNECTOR") return CONNECTOR_LABELS[tile.connectionType];
  return "★ Wildcard";
}
