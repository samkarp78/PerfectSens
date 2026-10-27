/** Pivot magnitudes below this are treated as singular (numerical tolerance, not a product tunable). */
const SINGULAR_TOLERANCE = 1e-12;

/** Solves A·x = b by Gaussian elimination with partial pivoting. Returns null if A is (near-)singular. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    }
    if (!(Math.abs(m[piv]![col]!) >= SINGULAR_TOLERANCE)) return null;
    [m[col], m[piv]] = [m[piv]!, m[col]!];
    const pr = m[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = m[r]!;
      const k = row[col]! / pr[col]!;
      for (let j = col; j <= n; j++) row[j] = row[j]! - k * pr[j]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    const row = m[i]!;
    let s = row[n]!;
    for (let j = i + 1; j < n; j++) s -= row[j]! * x[j]!;
    x[i] = s / row[i]!;
  }
  return x;
}
