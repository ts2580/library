import { BookDetailLink } from "@/components/books/book-detail-link";
import { CoverImage } from "@/components/ui/cover-image";
import { formatWon } from "@/lib/format";
import type { searchOwnedVolumes } from "@/features/books/queries";

export function VolumeSearchResults({ items }: { items: ReturnType<typeof searchOwnedVolumes>["items"] }) {
  if (!items.length) return <div className="empty">조건에 맞는 권이 없습니다.</div>;
  return <div className="stock-list">{items.map(item => <article className="stock-card" key={item.id}>
    <div className="stock-cover"><CoverImage cover={item.cover} alt={item.name ?? "책"}/></div>
    <div className="stack-xs">
      <BookDetailLink className="volume-title-link" bookId={item.bookId}>{item.name ?? "제목 없음"}</BookDetailLink>
      <p className="muted small">{item.bookName} · {item.seq == null ? "외전·특별판" : `${item.seq}권`}</p>
      <p className="muted small">{item.author ?? "저자 미상"} · {item.isbn13 || "ISBN 없음"}</p>
      <div className="button-row">{Boolean(item.isPurchased) && <span className="chip">구매 완료</span>}
        {Boolean(item.noNeedToBuy) && <span className="chip">구매 불필요</span>}<strong>{item.price ? formatWon(item.price) : "가격 미상"}</strong></div>
    </div>
  </article>)}</div>;
}
