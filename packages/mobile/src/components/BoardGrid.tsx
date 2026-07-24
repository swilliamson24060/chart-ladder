import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Board, GRID_SIZE, type GuidedPathConnection } from "@chartcross/engine";
import { colors } from "../theme";
import { TileChip } from "./TileChip";
import { ConnectionLines } from "./ConnectionLines";

interface Props {
  board: Board;
  cellSize: number;
  highlightCells: Set<string>;
  /** The cell currently awaiting player action - a connector guess or a rescue tile. */
  pendingActionCell?: { row: number; col: number } | null;
  onCellPress: (row: number, col: number) => void;
  pathConnections?: GuidedPathConnection[];
}

export function BoardGrid({
  board,
  cellSize,
  highlightCells,
  pendingActionCell,
  onCellPress,
  pathConnections,
}: Props) {
  const size = cellSize * GRID_SIZE;
  return (
    <View style={[styles.board, { width: size, height: size }]}>
      {board.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((cell) => {
            const isHighlighted = highlightCells.has(`${cell.row},${cell.col}`);
            const isPendingGap =
              pendingActionCell?.row === cell.row && pendingActionCell?.col === cell.col;
            return (
              <Pressable
                key={cell.col}
                onPress={() => onCellPress(cell.row, cell.col)}
                style={[
                  styles.cell,
                  {
                    width: cellSize,
                    height: cellSize,
                    borderColor: isPendingGap
                      ? colors.pendingGap
                      : isHighlighted
                        ? colors.decade
                        : colors.cellBorder,
                    borderWidth: isPendingGap ? 3 : isHighlighted ? 2 : 1,
                    backgroundColor: isPendingGap
                      ? `${colors.pendingGap}22`
                      : colors.cellEmpty,
                  },
                ]}
              >
                {cell.tile ? (
                  <TileChip tile={cell.tile} size={cellSize - 4} role={cell.role} />
                ) : null}
                {cell.role === "STARTER" && (
                  <Text style={[styles.roleLabel, styles.roleLabelBelow, { color: colors.starter }]}>
                    STARTER
                  </Text>
                )}
                {cell.role === "END_ANCHOR" && (
                  <Text style={[styles.roleLabel, styles.roleLabelAbove, { color: colors.endAnchor }]}>
                    ANCHOR
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
      <ConnectionLines board={board} cellSize={cellSize} pathConnections={pathConnections} />
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    backgroundColor: colors.boardBackground,
  },
  row: {
    flexDirection: "row",
  },
  cell: {
    backgroundColor: colors.cellEmpty,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  roleLabel: {
    position: "absolute",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  roleLabelAbove: {
    top: -14,
  },
  roleLabelBelow: {
    bottom: -14,
  },
});
