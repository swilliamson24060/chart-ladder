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

export const connectionColors: Record<"SAME_YEAR" | "ARTIST" | "COLLAB" | "WILDCARD", string> = {
  SAME_YEAR: colors.decade,
  ARTIST: colors.connectorArtist,
  COLLAB: colors.collab,
  WILDCARD: colors.wildcard,
};

export const connectorDim: Record<"SAME_YEAR" | "ARTIST" | "COLLAB", string> = {
  SAME_YEAR: "#1e4230",
  ARTIST: "#4a3016",
  COLLAB: colors.artistDim,
};
