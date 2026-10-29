import type { History, SessionRecord } from './history';

export function toJson(rec: SessionRecord): string {
  return JSON.stringify(rec);
}

/** Every saved session, raw data included, as one JSON array (for sending in as feedback). */
export async function exportAll(history: History): Promise<string> {
  const list = await history.list();
  const recs = await Promise.all(list.map((s) => history.get(s.id)));
  return JSON.stringify(recs.filter((r): r is SessionRecord => r !== null));
}
