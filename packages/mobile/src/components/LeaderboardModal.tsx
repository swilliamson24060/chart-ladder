import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ladderLeaderboards } from "@chartcross/engine";
import { colors } from "../theme";
import { fetchTop40, type LeaderboardEntry } from "../leaderboard";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Bumped by the caller after a score submission to force a refetch. */
  refreshKey?: number;
  highlightScore?: number;
  /** Board to open on - normally whatever the player just finished. */
  initialBoard: string;
}

const BOARDS = ladderLeaderboards();

export function LeaderboardModal({ visible, onClose, refreshKey, highlightScore, initialBoard }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState(initialBoard);

  // Reopening after a different round should land on that round's board
  // rather than wherever the player last browsed to.
  useEffect(() => {
    if (visible) setBoard(initialBoard);
  }, [visible, initialBoard]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setEntries(null);
    setError(null);
    fetchTop40(board)
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the leaderboard. Try again later.");
      });
    return () => {
      cancelled = true;
    };
  }, [visible, refreshKey, board]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>TOP 40</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.boardBar}
            contentContainerStyle={styles.boardBarContent}
          >
            {BOARDS.map((option) => (
              <Pressable
                key={option.key}
                onPress={() => setBoard(option.key)}
                style={[styles.boardChip, option.key === board && styles.boardChipActive]}
              >
                <Text style={[styles.boardChipText, option.key === board && styles.boardChipTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {error ? (
            <Text style={styles.emptyText}>{error}</Text>
          ) : entries === null ? (
            <ActivityIndicator color={colors.textPrimary} style={styles.loading} />
          ) : entries.length === 0 ? (
            <Text style={styles.emptyText}>No scores on this board yet — be the first!</Text>
          ) : (
            <FlatList
              data={entries}
              keyExtractor={(_, i) => `${i}`}
              style={styles.list}
              renderItem={({ item, index }) => (
                <View
                  style={[
                    styles.row,
                    highlightScore != null && item.score === highlightScore && styles.rowHighlight,
                  ]}
                >
                  <Text style={styles.rankText}>{index + 1}</Text>
                  <Text style={styles.nameText} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.scoreText}>{item.score.toLocaleString()}</Text>
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
  boardBar: {
    flexGrow: 0,
    marginBottom: 10,
  },
  boardBarContent: {
    gap: 6,
    paddingRight: 8,
  },
  boardChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.cellBorder,
    backgroundColor: colors.boardBackground,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  boardChipActive: {
    borderColor: colors.song,
    backgroundColor: colors.songDim,
  },
  boardChipText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "800",
  },
  boardChipTextActive: {
    color: colors.textPrimary,
  },
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
  loading: {
    paddingVertical: 24,
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
  rowHighlight: {
    backgroundColor: "rgba(255, 224, 102, 0.08)",
  },
  rankText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
    width: 28,
  },
  nameText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
  },
  scoreText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
    marginLeft: 8,
  },
});
