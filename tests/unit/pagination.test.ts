import { expect, it } from "vitest";
import { pageNumbers } from "@/lib/pagination";

it.each([
  [1, 0, [1]], [1, 1, [1]], [2, 3, [1, 2, 3]],
  [1, 10, [1, 2, 3, 4, 5]], [4, 10, [2, 3, 4, 5, 6]],
  [9, 10, [6, 7, 8, 9, 10]], [10, 10, [6, 7, 8, 9, 10]]
])("shows up to five valid pages around page %i of %i", (page, total, expected) => {
  expect(pageNumbers(page as number, total as number)).toEqual(expected);
});
