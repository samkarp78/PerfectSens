import { expect, test } from 'vitest';
import { createRng } from '../../src/core/rng';

test('same seed, same sequence', () => {
  const a = createRng(42), b = createRng(42);
  for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
});

test('next in [0,1)', () => {
  const r = createRng(1);
  for (let i = 0; i < 10000; i++) {
    const v = r.next();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
});

test('normal ≈ N(0,1)', () => {
  const r = createRng(7);
  const xs = Array.from({ length: 20000 }, () => r.normal());
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
  expect(Math.abs(mean)).toBeLessThan(0.03);
  expect(Math.abs(sd - 1)).toBeLessThan(0.03);
});

test('int inclusive bounds', () => {
  const r = createRng(3);
  const seen = new Set<number>();
  for (let i = 0; i < 10000; i++) seen.add(r.int(3, 5));
  expect([...seen].sort()).toEqual([3, 4, 5]);
});

test('shuffle is a deterministic permutation and does not mutate', () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const copy = [...a];
  const s1 = createRng(5).shuffle(a);
  const s2 = createRng(5).shuffle(a);
  expect(a).toEqual(copy);
  expect([...s1].sort((x, y) => x - y)).toEqual(copy);
  expect(s1).toEqual(s2);
  expect(s1).not.toEqual(copy);
});

test('fork is deterministic and differs from parent', () => {
  const f1 = createRng(1).fork('x').next();
  const f2 = createRng(1).fork('x').next();
  expect(f1).toBe(f2);
  expect(f1).not.toBe(createRng(1).next());
  expect(createRng(1).fork('y').next()).not.toBe(f1);
  expect(createRng(1).fork(1).next()).not.toBe(createRng(1).fork(2).next());
});

test('fork does not advance the parent', () => {
  const a = createRng(9), b = createRng(9);
  a.fork('z');
  expect(a.next()).toBe(b.next());
});
