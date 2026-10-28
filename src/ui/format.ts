export const DECIMALS = 2;
const REVOKE_DELAY_MS = 1000;
export const fmt = (x: number, digits = DECIMALS): string => String(Number(x.toFixed(digits)));
export const fmtOpt = (x: number | null, digits = DECIMALS): string => (x === null ? '—' : fmt(x, digits));
export const fmtDate = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
