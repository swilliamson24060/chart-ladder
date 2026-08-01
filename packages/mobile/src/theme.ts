export const colors = {
  background: "#0a1224",
  headerBackground: "#16213f",
  boardBackground: "#0d1730",
  cellEmpty: "#1a2444",
  cellBorder: "#2a3660",
  textPrimary: "#e8ecf8",
  textSecondary: "#8b96b8",
  artist: "#ff3d9a",
  artistDim: "#5c2244",
  song: "#2ec5ff",
  songDim: "#1e4258",
  wildcard: "#ffe066",
  wildcardDim: "#4a4322",
  starter: "#ff3d9a",
  endAnchor: "#2ec5ff",
  multiplierSong: "#2ec5ff",
  multiplierArtist: "#ff3d9a",
  chartBoost: "#ff9a3d",
  decade: "#4fd67a",
  collab: "#ff3d9a",
  connectorArtist: "#ffa63d",
  illegal: "#ff4d4d",
  pendingGap: "#ffe066",
  rackSlotBg: "#111b36",
  rackSlotBorder: "#2a3660",
};

import type { LadderTileKey } from "@chartcross/engine";

// The two chart-tier pairs share a hue each (blue for peak, orange for run
// length) so a player can see at a glance that BOTH TOP 40 / BOTH MISSED
// TOP 40 are two sides of the same question.
export const connectionColors: Record<LadderTileKey | "WILDCARD", string> = {
  same_artist: colors.artist,
  band_collab: colors.connectorArtist,
  same_genre: colors.decade,
  same_award: colors.wildcard,
  top_40: colors.song,
  outside_top_40: "#7fa8c9",
  long_run: colors.chartBoost,
  short_run: "#c9926b",
  WILDCARD: colors.wildcard,
};

export const connectorDim: Record<LadderTileKey, string> = {
  same_artist: colors.artistDim,
  band_collab: "#4a3016",
  same_genre: "#1e4230",
  same_award: colors.wildcardDim,
  top_40: colors.songDim,
  outside_top_40: "#2b3d4a",
  long_run: "#4a2f16",
  short_run: "#3d2c1e",
};
