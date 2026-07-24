import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  explainConnection,
  tileLabel,
  tileValue,
  type Board,
  type Cell,
  type Dataset,
  type MatchableTile,
  type SongTile,
} from "@chartcross/engine";
import { colors } from "../theme";

interface Props {
  cell: Cell | null;
  dataset: Dataset;
  board: Board;
  onClose: () => void;
}

function yearList(years: number[]): string {
  return years.join(", ");
}

const ROLE_LABELS: Record<string, string> = {
  STARTER: "STARTER",
  END_ANCHOR: "ANCHOR",
};

export function TileInfoModal({ cell, dataset, board, onClose }: Props) {
  const tile = cell?.tile;
  if (!tile) return null;

  const isArtist = tile.kind === "ARTIST";
  const isWildcard = tile.kind === "WILDCARD";
  const isConnector = tile.kind === "CONNECTOR";
  const accent = isConnector
    ? colors.connectorArtist
    : isWildcard
      ? colors.wildcard
      : isArtist
        ? colors.artist
        : colors.song;
  const value = tileValue(tile);

  let title = "";
  let rows: Array<{ label: string; value: string }> = [];

  if (tile.kind === "SONG") {
    const performerNames = tile.performerIds
      .map((id) => dataset.artistById.get(id)?.name)
      .filter((name): name is string => !!name);
    title = tile.title;
    rows = [
      { label: "Artist", value: performerNames.join(", ") || "Unknown" },
      { label: "Chart Year", value: String(tile.peakYear) },
      { label: "Peak Position", value: `#${tile.peakPos}` },
      { label: "Point Value", value: `${value} pt${value === 1 ? "" : "s"}` },
    ];
  } else if (tile.kind === "ARTIST") {
    // Represent the artist by their biggest hit (lowest peak position).
    const bestSong = tile.songIds
      .map((id) => dataset.songById.get(id))
      .filter((s): s is SongTile => !!s)
      .reduce<SongTile | null>((best, s) => (!best || s.peakPos < best.peakPos ? s : best), null);
    title = tile.name;
    rows = [
      { label: "Song", value: bestSong ? bestSong.title : "—" },
      {
        label: "Chart Year",
        value: bestSong ? String(bestSong.peakYear) : String(Math.min(...tile.years)),
      },
      { label: "Peak Position", value: bestSong ? `#${bestSong.peakPos}` : "—" },
      { label: "Point Value", value: `${value} pt${value === 1 ? "" : "s"}` },
    ];
  } else if (tile.kind === "CONNECTOR") {
    title = tileLabel(tile);
    const contentTile = board[tile.contentRow]?.[tile.contentCol]?.tile;
    const anchorTile = board[tile.anchorRow]?.[tile.anchorCol]?.tile;
    const isMatchable = (t?: typeof contentTile): t is MatchableTile =>
      !!t && (t.kind === "SONG" || t.kind === "ARTIST");

    if (isMatchable(contentTile) && isMatchable(anchorTile)) {
      const explanation = explainConnection(contentTile, anchorTile, tile.connectionType, dataset);

      if (explanation.reason === "SAME_YEAR") {
        const sharedSet = new Set(explanation.sharedYears);
        const otherA = explanation.tileAYears.filter((year) => !sharedSet.has(year));
        const otherB = explanation.tileBYears.filter((year) => !sharedSet.has(year));
        rows = [
          {
            label: explanation.sharedYears.length > 1 ? "Matched years" : "Matched year",
            value: yearList(explanation.sharedYears),
          },
        ];
        if (otherA.length > 0) {
          rows.push({ label: tileLabel(contentTile), value: `Also charted in ${yearList(otherA)}` });
        }
        if (otherB.length > 0) {
          rows.push({ label: tileLabel(anchorTile), value: `Also charted in ${yearList(otherB)}` });
        }
      } else if (explanation.reason === "COLLAB") {
        rows = [
          {
            label: "Collaborated on",
            value: explanation.songs.length > 0 ? explanation.songs.map((s) => s.title).join(", ") : "—",
          },
        ];
      } else if (explanation.reason === "ARTIST") {
        rows = explanation.sharedPerformerNames
          ? [{ label: "Shared performer", value: explanation.sharedPerformerNames.join(", ") || "—" }]
          : [
              {
                label: explanation.artistName ?? "Performed by",
                value: explanation.songTitle ? `Performed "${explanation.songTitle}"` : "—",
              },
            ];
      }
    } else {
      rows = [{ label: "Fills a gap between", value: "Two tiles with a matching connection" }];
    }
  } else {
    title = "★ Wildcard";
    rows = [{ label: "Connects to", value: "Anything, worth 0 points" }];
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, { borderColor: accent }]} onPress={() => {}}>
          <View style={styles.headerRow}>
            <Text style={[styles.kindBadge, { color: accent, borderColor: accent }]}>
              {tile.kind}
              {cell?.role ? ` · ${ROLE_LABELS[cell.role]}` : ""}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.title}>{title}</Text>
          {rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue}>{row.value}</Text>
            </View>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5, 8, 18, 0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: colors.headerBackground,
    borderRadius: 12,
    borderWidth: 2,
    padding: 18,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  kindBadge: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  closeText: {
    color: colors.textSecondary,
    fontSize: 18,
    fontWeight: "700",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 14,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: colors.cellBorder,
  },
  rowLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  rowValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "right",
    marginLeft: 12,
  },
});
