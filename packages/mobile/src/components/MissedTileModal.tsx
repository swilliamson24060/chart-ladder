import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { tileLabel, type LadderSongTile } from "@chartcross/engine";
import { colors } from "../theme";

interface Props {
  visible: boolean;
  correctTile: LadderSongTile | null;
  misses: number;
  canTryBonus: boolean;
  gameOver: boolean;
  onContinue: () => void;
}

export function MissedTileModal({
  visible,
  correctTile,
  misses,
  canTryBonus,
  gameOver,
  onContinue,
}: Props) {
  if (!visible || !correctTile) return null;

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>WRONG TILE</Text>
          <Text style={styles.title}>0 base points</Text>
          <Text style={styles.body}>
            The correct tile was{" "}
            <Text style={styles.correctTile}>{tileLabel(correctTile)}</Text>. It has been placed on
            the path automatically.
          </Text>
          <Text style={styles.missCount}>{misses}/5 tile misses used</Text>
          <Text style={styles.next}>
            {gameOver
              ? "That was the fifth miss, so the session is over."
              : canTryBonus
                ? "You can still identify the connection for the 10-point bonus."
                : "The hint forfeited this step's connection bonus."}
          </Text>
          <Pressable style={styles.button} onPress={onContinue}>
            <Text style={styles.buttonText}>
              {gameOver ? "SEE FINAL SCORE" : canTryBonus ? "TRY FOR BONUS" : "CONTINUE"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5, 8, 18, 0.86)",
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
    borderColor: colors.illegal,
    padding: 22,
    alignItems: "center",
  },
  eyebrow: {
    color: colors.illegal,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 25,
    fontWeight: "900",
    marginTop: 5,
    marginBottom: 14,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  correctTile: {
    color: colors.song,
    fontWeight: "900",
  },
  missCount: {
    color: colors.illegal,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 14,
  },
  next: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 18,
  },
  button: {
    width: "100%",
    borderRadius: 8,
    backgroundColor: colors.artist,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "900",
    letterSpacing: 0.7,
  },
});
