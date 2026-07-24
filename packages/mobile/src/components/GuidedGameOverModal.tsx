import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { tileLabel, type GuidedGameStatus, type MatchableTile } from "@chartcross/engine";
import { MAX_NAME_LENGTH, submitScore } from "../leaderboard";
import { colors } from "../theme";

interface Props {
  status: GuidedGameStatus;
  finalScore: number;
  misses: number;
  roundsCompleted: number;
  correctTile: MatchableTile | null;
  onRestart: () => void;
  onScoreSubmitted: () => void;
}

type SubmitState = "idle" | "submitting" | "done" | "error";

export function GuidedGameOverModal({
  status,
  finalScore,
  misses,
  roundsCompleted,
  correctTile,
  onRestart,
  onScoreSubmitted,
}: Props) {
  const [name, setName] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");

  useEffect(() => {
    if (status !== "playing") {
      setName("");
      setSubmitState("idle");
    }
  }, [status]);

  if (status !== "game-over") return null;

  async function handleSubmit() {
    if (!name.trim() || submitState === "submitting") return;
    setSubmitState("submitting");
    try {
      await submitScore(name, finalScore);
      setSubmitState("done");
      onScoreSubmitted();
    } catch {
      setSubmitState("error");
    }
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onRestart}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { borderColor: colors.illegal }]}>
          <Text style={[styles.title, { color: colors.illegal }]}>SESSION COMPLETE</Text>
          {correctTile && misses >= 5 && (
            <Text style={styles.body}>
              Five artist/song tiles were missed. The final correct tile was {tileLabel(correctTile)}.
            </Text>
          )}
          {roundsCompleted > 0 && (
            <Text style={styles.body}>
              Completed {roundsCompleted} path{roundsCompleted === 1 ? "" : "s"}.
            </Text>
          )}
          <Text style={styles.scoreLabel}>FINAL SCORE</Text>
          <Text style={styles.score}>{finalScore.toLocaleString()}</Text>

          {submitState === "done" ? (
            <Text style={styles.success}>Score submitted!</Text>
          ) : (
            <View style={styles.submitRow}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="YOUR NAME"
                placeholderTextColor={colors.textSecondary}
                maxLength={MAX_NAME_LENGTH}
                editable={submitState !== "submitting"}
                autoCapitalize="characters"
              />
              <Pressable
                style={[styles.submitButton, !name.trim() && styles.disabled]}
                onPress={handleSubmit}
                disabled={!name.trim() || submitState === "submitting"}
              >
                {submitState === "submitting" ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>SUBMIT</Text>
                )}
              </Pressable>
            </View>
          )}
          {submitState === "error" && <Text style={styles.error}>Could not submit. Try again.</Text>}
          <Pressable style={styles.restartButton} onPress={onRestart}>
            <Text style={styles.buttonText}>PLAY AGAIN</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5, 8, 18, 0.84)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 350,
    backgroundColor: colors.headerBackground,
    borderRadius: 12,
    borderWidth: 2,
    padding: 22,
    alignItems: "center",
  },
  title: {
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 12,
  },
  body: {
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 14,
  },
  scoreLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  score: {
    color: colors.textPrimary,
    fontSize: 38,
    fontWeight: "900",
    marginBottom: 16,
  },
  submitRow: {
    width: "100%",
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderColor: colors.cellBorder,
    borderRadius: 7,
    color: colors.textPrimary,
    paddingHorizontal: 10,
    backgroundColor: colors.boardBackground,
  },
  submitButton: {
    minWidth: 82,
    height: 42,
    borderRadius: 7,
    backgroundColor: colors.artist,
    alignItems: "center",
    justifyContent: "center",
  },
  restartButton: {
    width: "100%",
    borderRadius: 7,
    backgroundColor: colors.songDim,
    borderWidth: 1,
    borderColor: colors.song,
    paddingVertical: 11,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  disabled: {
    opacity: 0.4,
  },
  success: {
    color: colors.decade,
    fontWeight: "800",
    marginBottom: 14,
  },
  error: {
    color: colors.illegal,
    marginBottom: 8,
  },
});
