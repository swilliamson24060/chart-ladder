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

export const connectionColors: Record<LadderTileKey | "WILDCARD", string> = {
  same_artist: colors.artist,
  band_collab: colors.connectorArtist,
  same_genre: colors.decade,
  same_peak_pos: colors.song,
  same_award: colors.wildcard,
  weeks_on_chart: colors.chartBoost,
  WILDCARD: colors.wildcard,
};

export const connectorDim: Record<LadderTileKey, string> = {
  same_artist: colors.artistDim,
  band_collab: "#4a3016",
  same_genre: "#1e4230",
  same_peak_pos: colors.songDim,
  same_award: colors.wildcardDim,
  weeks_on_chart: "#4a2f16",
};
