function publicationTime(value: string | null): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? "");
  if (!match) return Infinity;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp : Infinity;
}

/** Earlier publication dates first; unknown dates last, preserving input order for ties. */
export function orderByPublicationDate<T extends { pubDate: string | null }>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ item, index, time: publicationTime(item.pubDate) }))
    .sort((a, b) => a.time === b.time ? a.index - b.index : a.time < b.time ? -1 : 1)
    .map(({ item }) => item);
}
