import React from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { tileLabel, type BoardConnection } from "@chartcross/engine";
import { colors, connectionColors } from "../theme";

interface Props {
  visible: boolean;
  connections: BoardConnection[];
  onClose: () => void;
}

const REASON_TITLES: Record<BoardConnection["reason"], string> = {
  SAME_YEAR: "Same Year Connect",
  ARTIST: "Artist Connect",
  COLLAB: "Collab Connect",
  WILDCARD: "Wildcard",
};

export function ConnectionsListModal({ visible, connections, onClose }: Props) {
  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>CONNECTIONS ({connections.length})</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {connections.length === 0 ? (
            <Text style={styles.emptyText}>No connections on the board yet.</Text>
          ) : (
            <FlatList
              data={connections}
              keyExtractor={(c, i) => `${c.fromRow}-${c.fromCol}-${c.toRow}-${c.toCol}-${i}`}
              style={styles.list}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <View style={[styles.reasonDot, { backgroundColor: connectionColors[item.reason] }]} />
                  <View style={styles.rowText}>
                    <Text style={styles.pairText} numberOfLines={2}>
                      {tileLabel(item.tileA)} ↔ {tileLabel(item.tileB)}
                    </Text>
                    <Text style={[styles.reasonText, { color: connectionColors[item.reason] }]}>
                      {REASON_TITLES[item.reason]}
                    </Text>
                  </View>
                  <Text style={styles.pointsText}>+{item.points}</Text>
                </View>
              )}
            />
          )}
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
    maxWidth: 380,
    maxHeight: "70%",
    backgroundColor: colors.headerBackground,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.cellBorder,
    padding: 18,
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
    fontSize: 18,
    fontWeight: "700",
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    paddingVertical: 16,
    textAlign: "center",
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.cellBorder,
  },
  reasonDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  rowText: {
    flex: 1,
  },
  pairText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
  reasonText: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  pointsText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
    marginLeft: 8,
  },
});
