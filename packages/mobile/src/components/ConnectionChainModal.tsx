import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  Board,
  GuidedPathConnection,
  LADDER_TILE_LABELS,
  tileLabel,
  type LadderSongTile,
} from "@chartcross/engine";
import { colors, connectionColors } from "../theme";

interface Props {
  visible: boolean;
  board: Board;
  connections: GuidedPathConnection[];
  onClose: () => void;
}

export function ConnectionChainModal({ visible, board, connections, onClose }: Props) {
  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>THE WHOLE CHAIN</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {connections.map((edge, i) => {
              const fromTile = board[edge.fromRow][edge.fromCol].tile as LadderSongTile;
              const toTile = board[edge.toRow][edge.toCol].tile as LadderSongTile;
              return (
                <View key={i} style={styles.row}>
                  <Text style={styles.songs}>
                    "{tileLabel(fromTile)}" → "{tileLabel(toTile)}"
                  </Text>
                  <Text style={[styles.reason, { color: connectionColors[edge.reason] }]}>
                    {LADDER_TILE_LABELS[edge.reason]}
                  </Text>
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
  row: {
    marginBottom: 12,
  },
  songs: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  reason: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  button: {
    backgroundColor: colors.artist,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "800",
    letterSpacing: 1,
  },
});
