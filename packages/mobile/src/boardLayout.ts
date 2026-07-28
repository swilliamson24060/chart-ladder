import { GRID_SIZE } from "@chartcross/engine";

/**
 * Tiles render twice as wide as they are tall, anchored at their origin
 * cell's top-left corner, so the rightmost path position's tile overflows
 * one column past the board's right edge unless the render area is widened
 * by that much. Shared by every component that lays out the board so their
 * pixel math (grid squares, connection lines, tile positions, container
 * sizing) all agree on the same extra column.
 */
export const BOARD_OVERFLOW_COLS = 1;
export const BOARD_RENDER_COLS = GRID_SIZE + BOARD_OVERFLOW_COLS;
