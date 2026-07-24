import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  CONNECTION_CATEGORIES,
  GUIDED_PATH_LENGTH,
  type ConnectionCategory,
  type MatchableTile,
} from "@chartcross/engine";
import { colors, connectorDim } from "../theme";
import { TileChip } from "./TileChip";

interface Props {
  choices: MatchableTile[];
  step: number;
  awaitingConnectionGuess: boolean;
  hintReason: ConnectionCategory | null;
  onChooseTile: (index: number) => void;
  onGuessConnection: (reason: ConnectionCategory) => void;
}

const CONNECTION_LABELS: Record<ConnectionCategory, string> = {
  COLLAB: "COLLAB",
  ARTIST: "ARTIST",
  SAME_YEAR: "SAME YEAR",
};

const CONNECTION_COLORS: Record<ConnectionCategory, string> = {
  COLLAB: colors.collab,
  ARTIST: colors.connectorArtist,
  SAME_YEAR: colors.decade,
};

export function GuidedChoices({
  choices,
  step,
  awaitingConnectionGuess,
  hintReason,
  onChooseTile,
  onGuessConnection,
}: Props) {
  return (
    <View style={styles.wrap}>
      {awaitingConnectionGuess ? (
        <>
          <Text style={styles.heading}>BONUS: NAME THE CONNECTION</Text>
          <Text style={styles.instructions}>Correct answer: +10 points</Text>
          <View style={styles.connectionRow}>
            {CONNECTION_CATEGORIES.map((reason) => (
              <Pressable
                key={reason}
                onPress={() => onGuessConnection(reason)}
                style={[
                  styles.connectionChip,
                  {
                    borderColor: CONNECTION_COLORS[reason],
                    backgroundColor: connectorDim[reason],
                  },
                ]}
              >
                <Text style={[styles.connectionText, { color: CONNECTION_COLORS[reason] }]}>
                  {CONNECTION_LABELS[reason]}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <>
          <Text style={styles.heading}>
            CHOOSE THE NEXT TILE · {step + 1}/{GUIDED_PATH_LENGTH}
          </Text>
          <Text style={styles.instructions}>
            One tile connects to the last tile. A miss ends the path.
          </Text>
          {hintReason && (
            <View style={[styles.hint, { borderColor: CONNECTION_COLORS[hintReason] }]}>
              <Text style={[styles.hintText, { color: CONNECTION_COLORS[hintReason] }]}>
                HINT: {CONNECTION_LABELS[hintReason]} CONNECTION
              </Text>
            </View>
          )}
          <View style={styles.choiceRow}>
            {choices.map((tile, index) => (
              <View key={`${tile.kind}-${tile.id}`} style={styles.choice}>
                <TileChip tile={tile} size={82} showValue onPress={() => onChooseTile(index)} />
                <Text style={styles.kind}>{tile.kind}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textAlign: "center",
  },
  instructions: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 10,
  },
  choiceRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 14,
  },
  choice: {
    alignItems: "center",
  },
  kind: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: "700",
    marginTop: 4,
  },
  hint: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 10,
    backgroundColor: colors.boardBackground,
  },
  hintText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  connectionRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  connectionChip: {
    width: 92,
    height: 54,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  connectionText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
});
