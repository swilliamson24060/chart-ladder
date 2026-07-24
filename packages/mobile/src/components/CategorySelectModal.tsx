import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { GameCategory } from "../dataset";
import { colors } from "../theme";

interface Props {
  visible: boolean;
  categories: GameCategory[];
  onSelect: (category: GameCategory) => void;
  savedGame?: {
    categoryName: string;
    score: number;
    misses: number;
    roundsCompleted: number;
  } | null;
  onResume?: () => void;
}

export function CategorySelectModal({ visible, categories, onSelect, savedGame, onResume }: Props) {
  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>CHOOSE YOUR CHART</Text>
          <Text style={styles.title}>Pick a category</Text>
          <Text style={styles.intro}>
            Your choice determines which Billboard songs and artists appear in this game.
          </Text>

          {savedGame && onResume && (
            <Pressable style={styles.resumeCard} onPress={onResume}>
              <View style={styles.resumeCopy}>
                <Text style={styles.resumeTitle}>RESUME SAVED GAME</Text>
                <Text style={styles.resumeDetails}>
                  {savedGame.categoryName} · {savedGame.score.toLocaleString()} pts ·{" "}
                  {savedGame.misses}/5 misses
                </Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          )}

          <View style={styles.options}>
            {categories.map((category, index) => (
              <Pressable
                key={category.id}
                style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                onPress={() => onSelect(category)}
              >
                <View style={styles.numberBadge}>
                  <Text style={styles.number}>{index + 1}</Text>
                </View>
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>{category.name}</Text>
                  <Text style={styles.optionDescription}>{category.description}</Text>
                </View>
                <Text style={styles.arrow}>›</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5, 8, 18, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: colors.headerBackground,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.cellBorder,
    padding: 20,
  },
  eyebrow: {
    color: colors.song,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: "800",
  },
  intro: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 18,
  },
  options: {
    gap: 10,
  },
  resumeCard: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.decade,
    backgroundColor: colors.boardBackground,
    flexDirection: "row",
    alignItems: "center",
    padding: 13,
    marginBottom: 14,
  },
  resumeCopy: {
    flex: 1,
  },
  resumeTitle: {
    color: colors.decade,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  resumeDetails: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 4,
  },
  option: {
    minHeight: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cellBorder,
    backgroundColor: colors.boardBackground,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  optionPressed: {
    borderColor: colors.song,
    backgroundColor: colors.cellEmpty,
  },
  numberBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.artistDim,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  number: {
    color: colors.artist,
    fontSize: 15,
    fontWeight: "900",
  },
  optionCopy: {
    flex: 1,
  },
  optionTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 3,
  },
  optionDescription: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  arrow: {
    color: colors.song,
    fontSize: 28,
    marginLeft: 8,
  },
});
