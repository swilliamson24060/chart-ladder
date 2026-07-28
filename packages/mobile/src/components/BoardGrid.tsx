import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Board, GRID_SIZE, type GuidedPathConnection } from "@chartcross/engine";
import { BOARD_RENDER_COLS } from "../boardLayout";
import { colors } from "../theme";
import { TileChip } from "./TileChip";
import { ConnectionLines } from "./ConnectionLines";

interface Props {
  board: Board;
  cellSize: number;
  highlightCells: Set<string>;
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
  const width = cellSize * BOARD_RENDER_COLS;
  const height = cellSize * GRID_SIZE;
  return (
    <View style={[styles.board, { width, height }]}>
      {board.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((cell) => {
            const isHighlighted = highlightCells.has(`${cell.row},${cell.col}`);
            const isPendingGap =
              pendingActionCell?.row === cell.row && pendingActionCell?.col === cell.col;
            return (
              <View
                key={cell.col}
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
                    backgroundColor: isPendingGap ? `${colors.pendingGap}22` : colors.cellEmpty,
                  },
                ]}
              />
            );
          })}
          {/* One extra visual-only square per row (no game cell behind it) so
              the rightmost tile's overflow lands on a real grid square
              instead of blank margin. */}
          <View
            style={[
              styles.cell,
              { width: cellSize, height: cellSize, borderColor: colors.cellBorder, backgroundColor: colors.cellEmpty },
            ]}
          />
        </View>
      ))}

      <ConnectionLines board={board} cellSize={cellSize} pathConnections={pathConnections} />

      {/* Wide tiles are rendered as a separate absolute layer, positioned by
          their origin cell, so they can visually overflow into the next
          cell (one square over) without disturbing the grid squares below
          or the empty-cell layout above. */}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {board.flatMap((row) => row).map((cell) => {
          if (!cell.tile) return null;
          return (
            <Pressable
              key={`tile-${cell.row}-${cell.col}`}
              onPress={() => onCellPress(cell.row, cell.col)}
              style={{ position: "absolute", left: cell.col * cellSize, top: cell.row * cellSize }}
            >
              <TileChip tile={cell.tile} size={cellSize - 4} role={cell.role} />
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
