import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GUIDED_PATH_LENGTH, LADDER_TILE_LABELS, type LadderSongTile, type LadderTileKey } from "@chartcross/engine";
import { colors, connectionColors, connectorDim } from "../theme";
import { TileChip } from "./TileChip";

interface Props {
  choices: LadderSongTile[];
  /** 1 correct + up to 2 random decoys, shuffled - see GuidedGameEngine.chooseTile(). */
  connectionChoices: LadderTileKey[];
  step: number;
  awaitingConnectionGuess: boolean;
  hintReason: LadderTileKey | null;
  /** Matches the size of tiles placed on the board (BoardGrid uses cellSize - 4). */
  tileSize: number;
  onChooseTile: (index: number) => void;
  onGuessConnection: (reason: LadderTileKey) => void;
}

export function GuidedChoices({
  choices,
  connectionChoices,
  step,
  awaitingConnectionGuess,
  hintReason,
  tileSize,
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
            {connectionChoices.map((reason) => (
              <Pressable
                key={reason}
                onPress={() => onGuessConnection(reason)}
                style={[
                  styles.connectionChip,
                  {
                    width: tileSize * 2,
                    height: tileSize,
                    borderColor: connectionColors[reason],
                    backgroundColor: connectorDim[reason],
                  },
                ]}
              >
                <Text style={[styles.connectionText, { color: connectionColors[reason] }]}>
                  {LADDER_TILE_LABELS[reason]}
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
          {hintReason && (
            <View style={[styles.hint, { borderColor: connectionColors[hintReason] }]}>
              <Text style={[styles.hintText, { color: connectionColors[hintReason] }]}>
                HINT: {LADDER_TILE_LABELS[hintReason]} CONNECTION
              </Text>
            </View>
          )}
          <View style={styles.choiceRow}>
            {choices.map((tile, index) => (
              <View key={tile.id} style={styles.choice}>
                <TileChip tile={tile} size={tileSize} fontScale={0.17} onPress={() => onChooseTile(index)} />
                <Text style={styles.kind}>{tile.performer}</Text>
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
    // Wide enough that three double-width tiles never wrap to a second row.
    maxWidth: 480,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textAlign: "center",
    marginBottom: 8,
  },
  instructions: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 2,
    marginBottom: 6,
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
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
