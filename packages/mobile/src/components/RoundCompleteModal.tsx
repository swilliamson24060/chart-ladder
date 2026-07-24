import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

interface Props {
  visible: boolean;
  score: number;
  misses: number;
  roundsCompleted: number;
  onContinue: () => void;
  onSave: () => void;
  onEnd: () => void;
}

export function RoundCompleteModal({
  visible,
  score,
  misses,
  roundsCompleted,
  onContinue,
  onSave,
  onEnd,
}: Props) {
  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>PATH {roundsCompleted} COMPLETE</Text>
          <Text style={styles.title}>Keep the streak going?</Text>
          <Text style={styles.score}>{score.toLocaleString()} POINTS</Text>
          <Text style={styles.misses}>{misses}/5 tile misses used</Text>

          <Pressable style={[styles.button, styles.continueButton]} onPress={onContinue}>
            <Text style={styles.buttonText}>ADD ANOTHER ROUND</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.saveButton]} onPress={onSave}>
            <Text style={styles.buttonText}>SAVE & EXIT</Text>
          </Pressable>
          <Pressable style={styles.endButton} onPress={onEnd}>
            <Text style={styles.endButtonText}>END & SUBMIT SCORE</Text>
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
    maxWidth: 360,
    backgroundColor: colors.headerBackground,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.decade,
    padding: 22,
    alignItems: "center",
  },
  eyebrow: {
    color: colors.decade,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 6,
    marginBottom: 14,
  },
  score: {
    color: colors.song,
    fontSize: 25,
    fontWeight: "900",
  },
  misses: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 20,
  },
  button: {
    width: "100%",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 9,
  },
  continueButton: {
    backgroundColor: colors.artist,
  },
  saveButton: {
    backgroundColor: colors.songDim,
    borderWidth: 1,
    borderColor: colors.song,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  endButton: {
    paddingVertical: 8,
  },
  endButtonText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
  },
});
