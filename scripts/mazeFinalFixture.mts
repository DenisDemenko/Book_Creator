export const mazeFinalFixture = () => {
  const grid = Array.from({ length: 3 }, (_, y) =>
    Array.from({ length: 3 }, (_, x) => ({
      x,
      y,
      walls: { top: y === 0, right: x === 2, bottom: y === 2, left: x === 0 },
      isBridge: x === 1 && y === 1,
      bridgeDirection: x === 1 && y === 1 ? "horizontal" : null,
    })),
  );
  grid[1][1].walls.left = true;
  grid[1][0].walls.right = true;
  grid[1][1].walls.right = true;
  grid[1][2].walls.left = true;
  return {
    width: 3,
    height: 3,
    grid,
    bridges: [{ x: 1, y: 1, direction: "horizontal" }],
    keys: [],
    barriers: [],
    entrance: { x: 0, y: 0, side: "top" },
    exit: { x: 2, y: 2, side: "bottom" },
  };
};
