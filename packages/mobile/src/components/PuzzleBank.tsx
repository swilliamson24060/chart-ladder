import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { tileLabel, type PuzzleBankTile } from "@chartcross/engine";
import { colors } from "../theme";

interface Props {
  bank: PuzzleBankTile[];
  selectedIndex: number | null;
  /** Disabled while a connection guess is pending, so the board can't change underfoot. */
  disabled: boolean;
  tileSize: number;
  onSelect: (index: number) => void;
}

/**
 * The nine candidate songs, five of which belong on the ladder.
 *
 * Laid out three across rather than as full-width board tiles: nine of
 * those won't fit a phone screen. Placed tiles stay in position and grey
 * out instead of being removed, so the grid never reflows under the
 * player's thumb mid-solve.
 *
 * Only the title shows. Performer stays hidden until a tile is on the
 * board and tapped, otherwise every SAME ARTIST link would be answerable
 * by reading rather than knowing.
 */
export function PuzzleBank({ bank, selectedIndex, disabled, tileSize, onSelect }: Props) {
  return (
    <View style={styles.wrap}>
      {bank.map((entry, index) => {
        const placed = entry.placedAt !== null;
        const selected = index === selectedIndex;
        return (
          <Pressable
            key={entry.tile.id}
            disabled={placed || disabled}
            onPress={() => onSelect(index)}
            style={[
              styles.tile,
              {
                width: tileSize,
                height: tileSize * 0.62,
                borderColor: placed ? colors.cellBorder : selected ? colors.song : colors.cellBorder,
                borderWidth: selected ? 3 : 1.5,
                backgroundColor: placed
                  ? colors.rackSlotBg
                  : selected
                    ? colors.songDim
                    : colors.headerBackground,
                opacity: placed ? 0.45 : 1,
              },
            ]}
          >
            <Text
              numberOfLines={3}
              style={[styles.label, { color: placed ? colors.textSecondary : colors.textPrimary }]}
            >
              {tileLabel(entry.tile)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
  },
  tile: {
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    padding: 3,
  },
  label: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    textAlign: "center",
  },
});
