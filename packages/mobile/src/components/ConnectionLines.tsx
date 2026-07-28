import React from "react";
import Svg, { Line } from "react-native-svg";
import { Board, getAllConnections, GRID_SIZE, type GuidedPathConnection } from "@chartcross/engine";
import { connectionColors } from "../theme";
import { BOARD_RENDER_COLS } from "../boardLayout";

interface Props {
  board: Board;
  cellSize: number;
  pathConnections?: GuidedPathConnection[];
}

export function ConnectionLines({ board, cellSize, pathConnections }: Props) {
  const width = cellSize * BOARD_RENDER_COLS;
  const height = cellSize * GRID_SIZE;
  // Tiles are twice as wide as a grid cell, anchored at their cell's
  // top-left corner, so a tile's true center is a full cellSize to the
  // right of the plain per-cell center.
  const center = (row: number, col: number) => ({
    x: col * cellSize + cellSize,
    y: row * cellSize + cellSize / 2,
  });

  const lines = (pathConnections ?? getAllConnections(board)).map((c) => {
    const a = center(c.fromRow, c.fromCol);
    const b = center(c.toRow, c.toCol);
    return (
      <Line
        key={`${c.fromRow}-${c.fromCol}-${c.toRow}-${c.toCol}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={connectionColors[c.reason]}
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={0.85}
      />
    );
  });

  return (
    <Svg
      width={width}
      height={height}
      style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
    >
      {lines}
    </Svg>
  );
}
