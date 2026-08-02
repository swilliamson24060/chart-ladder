import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  isPuzzlePlayable,
  LADDER_BASE_CATEGORIES,
  LADDER_GENRES,
  ladderCategoryId,
  type LadderGenreId,
} from "@chartcross/engine";
import { GAME_CATEGORIES, ladderDataset, type GameCategory } from "../dataset";
import { colors } from "../theme";

interface Props {
  visible: boolean;
  onSelect: (category: GameCategory) => void;
  savedGame?: {
    categoryName: string;
    genreName: string;
    score: number;
    roundsCompleted: number;
  } | null;
  onResume?: () => void;
  /** Shown when the player opened this mid-round, so they can back out. */
  onCancel?: () => void;
}

const ALL_GENRES = { id: undefined as LadderGenreId | undefined, name: "All genres" };
const GENRE_OPTIONS = [ALL_GENRES, ...LADDER_GENRES.map((g) => ({ id: g.id as LadderGenreId | undefined, name: g.name }))];

/**
 * Two steps: genre first, then the rule within it.
 *
 * Not every pairing works - One Hit Wonders inside a genre has neither
 * same_artist nor same_genre to build with, and several combinations can't
 * produce a chain at all. Rather than let a player pick one and hit a dead
 * end, the four rules are probed once the genre is known (see
 * isPuzzlePlayable) and the unplayable ones are shown greyed out with a
 * reason, so the gap is explained rather than mysterious.
 */
export function CategorySelectModal({ visible, onSelect, savedGame, onResume, onCancel }: Props) {
  const [genreId, setGenreId] = useState<LadderGenreId | undefined>(undefined);
  const [step, setStep] = useState<"genre" | "rule">("genre");

  useEffect(() => {
    if (visible) setStep("genre");
  }, [visible]);

  if (!visible) return null;

  const genreName = GENRE_OPTIONS.find((g) => g.id === genreId)?.name ?? "All genres";

  const rules = LADDER_BASE_CATEGORIES.map((base) => {
    const id = ladderCategoryId(base.id, genreId);
    const category = GAME_CATEGORIES.find((c) => c.id === id)!;
    return { category, playable: isPuzzlePlayable(ladderDataset, id) };
  });

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>
                {step === "genre" ? "STEP 1 OF 2" : `STEP 2 OF 2 · ${genreName.toUpperCase()}`}
              </Text>
              <Text style={styles.title}>{step === "genre" ? "Pick a genre" : "Pick a category"}</Text>
            </View>
            {onCancel && (
              <Pressable onPress={onCancel} hitSlop={10}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            )}
          </View>

          <Text style={styles.intro}>
            {step === "genre"
              ? "Narrow the chart to one genre, or play across all of them."
              : "Which songs from this genre should the ladder use?"}
          </Text>

          {step === "genre" && savedGame && onResume && (
            <Pressable style={styles.resumeCard} onPress={onResume}>
              <View style={styles.resumeCopy}>
                <Text style={styles.resumeTitle}>RESUME SAVED GAME</Text>
                <Text style={styles.resumeDetails}>
                  {savedGame.genreName} · {savedGame.categoryName} ·{" "}
                  {savedGame.score.toLocaleString()} pts · {savedGame.roundsCompleted} solved
                </Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          )}

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {step === "genre" ? (
              <View style={styles.options}>
                {GENRE_OPTIONS.map((genre) => (
                  <Pressable
                    key={genre.id ?? "all"}
                    style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                    onPress={() => {
                      setGenreId(genre.id);
                      setStep("rule");
                    }}
                  >
                    <Text style={styles.optionTitle}>{genre.name}</Text>
                    <Text style={styles.arrow}>›</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.options}>
                {rules.map(({ category, playable }) => (
                  <Pressable
                    key={category.id}
                    disabled={!playable}
                    style={({ pressed }) => [
                      styles.option,
                      styles.ruleOption,
                      pressed && playable && styles.optionPressed,
                      !playable && styles.optionDisabled,
                    ]}
                    onPress={() => onSelect(category)}
                  >
                    <View style={styles.optionCopy}>
                      <View style={styles.titleRow}>
                        <Text style={[styles.optionTitle, !playable && styles.disabledText]}>
                          {category.name}
                        </Text>
                        {playable && category.mergedGenreIds && (
                          <Text style={styles.mergeBadge}>+ {category.genreLabel}</Text>
                        )}
                      </View>
                      <Text style={styles.optionDescription}>
                        {playable
                          ? category.description
                          : "Not enough connected songs in this genre to build a ladder."}
                      </Text>
                    </View>
                    <Text style={[styles.arrow, !playable && styles.disabledText]}>
                      {playable ? "›" : "—"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>

          {step === "rule" && (
            <Pressable style={styles.backButton} onPress={() => setStep("genre")}>
              <Text style={styles.backButtonText}>‹ BACK TO GENRES</Text>
            </Pressable>
          )}
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
    maxHeight: "88%",
    backgroundColor: colors.headerBackground,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.cellBorder,
    padding: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  closeText: {
    color: colors.textSecondary,
    fontSize: 20,
    fontWeight: "800",
    paddingLeft: 10,
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
    marginBottom: 16,
  },
  scroll: {
    flexShrink: 1,
  },
  options: {
    gap: 10,
    paddingBottom: 4,
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cellBorder,
    backgroundColor: colors.boardBackground,
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
  },
  ruleOption: {
    minHeight: 72,
  },
  optionPressed: {
    borderColor: colors.song,
    backgroundColor: colors.cellEmpty,
  },
  optionDisabled: {
    opacity: 0.45,
  },
  disabledText: {
    color: colors.textSecondary,
  },
  optionCopy: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mergeBadge: {
    color: colors.decade,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
    borderWidth: 1,
    borderColor: colors.decade,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  optionTitle: {
    flexShrink: 1,
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
    fontSize: 26,
    marginLeft: 8,
  },
  backButton: {
    marginTop: 14,
    paddingVertical: 10,
    alignItems: "center",
  },
  backButtonText: {
    color: colors.textSecondary,
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.8,
  },
});
