import { expect, test } from 'vitest';
import { solve } from '../../src/core/linalg';

test('solves a diagonal system', () => {
  const x = solve([[2, 0], [0, 4]], [2, 8]);
  expect(x).not.toBeNull();
  expect(x![0]).toBeCloseTo(1, 12);
  expect(x![1]).toBeCloseTo(2, 12);
});

test('returns null for a singular matrix', () => {
  expect(solve([[1, 2], [2, 4]], [1, 2])).toBeNull();
});

test('pivots when the leading entry is zero', () => {
  const x = solve([[0, 1], [1, 0]], [3, 5]);
  expect(x![0]).toBeCloseTo(5, 12);
  expect(x![1]).toBeCloseTo(3, 12);
});

test('does not mutate its inputs', () => {
  const A = [[2, 1], [1, 3]], b = [3, 5];
  solve(A, b);
  expect(A).toEqual([[2, 1], [1, 3]]);
  expect(b).toEqual([3, 5]);
});
