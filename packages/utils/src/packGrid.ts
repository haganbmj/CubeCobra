/**
 * How to lay a pack of `count` cards out in a grid, as columns x rows.
 *
 * The table is hand-tuned for the shapes that read well rather than derived: 9 cards go 3x3 rather
 * than the 5x2 a pure aspect calculation would give, 16 go 4x4, and so on. Sizes outside it fall
 * back to the same roughly-5:3 target the table approximates.
 *
 * Shared deliberately. `generatePackImage` composites the social-card image from it, and the
 * Markdown embed tile lays its preview grid out with it, so a pack keeps one shape wherever it
 * appears. Before this was shared the tile used fixed per-breakpoint column counts, which respond
 * to the *viewport* rather than the tile, so a half-width tile in a `<<...>>` row still asked for
 * twelve columns and rendered cards too small to read.
 */
const PACK_DIMENSIONS: Record<number, [number, number]> = {
  1: [1, 1],
  2: [2, 1],
  3: [3, 1],
  4: [2, 2],
  5: [5, 1],
  6: [3, 2],
  7: [4, 2],
  8: [4, 2],
  9: [3, 3],
  10: [5, 2],
  11: [6, 2],
  12: [4, 3],
  13: [5, 3],
  14: [5, 3],
  15: [5, 3],
  16: [4, 4],
  17: [6, 3],
  18: [6, 3],
  19: [5, 4],
  20: [5, 4],
  21: [7, 3],
  22: [6, 4],
  23: [6, 4],
  24: [6, 4],
  25: [5, 5],
};

export interface PackGridDimensions {
  columns: number;
  rows: number;
}

export const packGridDimensions = (count: number): PackGridDimensions => {
  if (count <= 0) {
    return { columns: 1, rows: 1 };
  }

  const known = PACK_DIMENSIONS[count];
  if (known) {
    return { columns: known[0], rows: known[1] };
  }

  const columns = Math.max(1, Math.floor(Math.sqrt((5 / 3) * count)));
  return { columns, rows: Math.ceil(count / columns) };
};
