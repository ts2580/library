function publicationTime(value: string | null): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? "");
  if (!match) return Infinity;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp : Infinity;
}

const titleOrder = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

/** Earlier dates first, then natural title order; unknown dates keep their input order last. */
export function orderByPublicationDate<T extends { pubDate: string | null; title?: string | null }>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ item, index, time: publicationTime(item.pubDate) }))
    .sort((a, b) => {
      if (a.time !== b.time) return a.time < b.time ? -1 : 1;
      if (a.time === Infinity) return a.index - b.index;
      return titleOrder.compare(a.item.title?.trim() ?? "", b.item.title?.trim() ?? "") || a.index - b.index;
    })
    .map(({ item }) => item);
}
