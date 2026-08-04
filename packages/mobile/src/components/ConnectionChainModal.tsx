import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  LADDER_TILE_LABELS,
  ladderConnectionDetail,
  type LadderSongTile,
  type LadderTileKey,
} from "@chartcross/engine";
import { ladderDataset } from "../dataset";
import { colors, connectionColors } from "../theme";

interface Props {
  visible: boolean;
  /** Seven songs, START through ANCHOR. */
  tiles: LadderSongTile[];
  /** Six links, one per adjacent pair. */
  reasons: LadderTileKey[];
  /** Set when the ladder was lost rather than solved, which changes the framing. */
  lost?: boolean;
  onClose: () => void;
}

/**
 * The chain as a list of songs with the link between each pair, rather than
 * as a list of links. Takes songs directly instead of reading the board so
 * it can show a *lost* ladder's full solution - the board only holds the
 * rungs the player actually placed.
 *
 * Every song carries its performer and debut year, whether or not the chain
 * happens to use SAME ARTIST or SAME YEAR. Those are the two facts that
 * make an unfamiliar song placeable next time, and hiding them is only
 * justified while the puzzle is still live.
 */
export function ConnectionChainModal({ visible, tiles, reasons, lost, onClose }: Props) {
  if (!visible || tiles.length === 0) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{lost ? "THE CORRECT CHAIN" : "THE WHOLE CHAIN"}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {tiles.map((tile, i) => {
              const reason = reasons[i];
              const next = tiles[i + 1];
              const detail = reason && next ? ladderConnectionDetail(tile, next, reason, ladderDataset) : "";
              const role = i === 0 ? "START" : i === tiles.length - 1 ? "ANCHOR" : `${i}`;
              return (
                <View key={`${tile.id}-${i}`}>
                  <View style={styles.songRow}>
                    <Text style={styles.rank}>{role}</Text>
                    <View style={styles.songCopy}>
                      <Text style={styles.songTitle}>{tile.title}</Text>
                      <Text style={styles.songMeta}>
                        {tile.performer}
                        {tile.debutYear ? ` · ${tile.debutYear}` : ""}
                      </Text>
                    </View>
                  </View>
                  {reason && next && (
                    <View style={styles.linkRow}>
                      <Text style={[styles.linkLine, { color: connectionColors[reason] }]}>│</Text>
                      <Text style={[styles.reason, { color: connectionColors[reason] }]}>
                        {LADDER_TILE_LABELS[reason]}
                        {detail ? ` · ${detail}` : ""}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <Pressable style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>CLOSE</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5, 8, 18, 0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "80%",
    backgroundColor: colors.headerBackground,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.cellBorder,
    padding: 18,
  },
  scroll: {
    flexShrink: 1,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1,
  },
  closeText: {
    color: colors.textSecondary,
    fontSize: 22,
    fontWeight: "700",
  },
  songRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rank: {
    width: 48,
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  songCopy: {
    flex: 1,
  },
  songTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
  },
  songMeta: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 3,
  },
  linkLine: {
    width: 48,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "900",
  },
  reason: {
    flex: 1,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  button: {
    backgroundColor: colors.artist,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "800",
    letterSpacing: 1,
  },
});
