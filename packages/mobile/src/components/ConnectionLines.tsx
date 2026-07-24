import React from "react";
import Svg, { Line } from "react-native-svg";
import { Board, getAllConnections, GRID_SIZE, type GuidedPathConnection } from "@chartcross/engine";
import { connectionColors } from "../theme";

interface Props {
  board: Board;
  cellSize: number;
  pathConnections?: GuidedPathConnection[];
}

export function ConnectionLines({ board, cellSize, pathConnections }: Props) {
  const size = cellSize * GRID_SIZE;
  const center = (row: number, col: number) => ({
    x: col * cellSize + cellSize / 2,
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
      width={size}
      height={size}
      style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
    >
      {lines}
    </Svg>
  );
}
