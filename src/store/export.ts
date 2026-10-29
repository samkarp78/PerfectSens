import type { SessionRecord } from './history';

export function toJson(rec: SessionRecord): string {
  return JSON.stringify(rec);
}

