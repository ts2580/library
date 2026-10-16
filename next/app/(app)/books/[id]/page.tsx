import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/features/auth/authorization";
import { getBookDetail, getManualBookCategories } from "@/features/books/queries";
import { addVolumeAction, deleteBookAction, deleteVolumeAction, updateBookAction, updateVolumeAction } from "@/features/books/actions";
import { BookForm } from "@/components/books/book-form";
import { VolumeForm } from "@/components/books/volume-form";
import { CoverImage } from "@/components/ui/cover-image";
import { FlashMessage } from "@/components/ui/flash-message";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { formatWon } from "@/lib/format";
import { ExternalLink } from "@/components/ui/external-link";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `책 ${id}` };
}

export default async function BookDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const user = await requireUser();
  const { id: rawId } = await params;
  const query = await searchParams;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const book = getBookDetail(user.id, id);
  if (!book) notFound();
  return (
    <div className="page">
      <div className="button-row"><Link className="button button-outline button-small" href="/books">← 책장</Link><Link className="button button-secondary button-small" href={`/aladin/search?bookId=${book.id}`}>알라딘에서 권 추가</Link></div>
      <FlashMessage message={query.message} error={query.error}/>
      <section className="panel book-hero">
        <div className="book-hero-cover"><CoverImage cover={book.cover} alt={book.name ?? "책"} className="h-full w-full object-cover"/></div>
        <div className="stack-md"><div><p className="eyebrow">Book detail</p><h1>{book.name ?? "제목 없음"}</h1><p className="page-subtitle">{book.author ?? "저자 미상"}</p></div><div className="button-row"><span className="chip">{book.type ?? "미분류"}</span><span className="chip">{book.volumeCount}권</span>{book.totalVolume && <span className="chip">총권수 메모 {book.totalVolume}</span>}</div>{book.description && <p className="muted">{book.description}</p>}</div>
      </section>
      <details className="details-card"><summary><span>책 정보 수정</span><span className="chip">편집</span></summary><div className="details-body stack-md"><BookForm action={updateBookAction} book={book} categories={getManualBookCategories()}/><form action={deleteBookAction}><input type="hidden" name="bookId" value={book.id}/><ConfirmSubmitButton message="책과 모든 권, 연결된 재고를 삭제합니까?">책 삭제</ConfirmSubmitButton></form></div></details>
      <section className="stack-md" aria-labelledby="volumes-heading"><div className="section-heading"><div><p className="eyebrow">Volumes</p><h2 id="volumes-heading">권 목록</h2></div><span className="chip">{book.volumes.length}권</span></div>
        <details className="details-card"><summary><span>권 직접 추가</span><span className="chip">새 항목</span></summary><div className="details-body"><VolumeForm action={addVolumeAction} bookId={book.id} submitLabel="권 추가"/></div></details>
        {book.volumes.length ? <div className="volume-list">{book.volumes.map((volume) => <article className="volume-card" key={volume.id}><div className="volume-cover"><CoverImage cover={volume.cover} alt={volume.name ?? "권"} className="h-full w-full object-cover"/></div><div className="stack-sm"><div className="volume-title"><h3>{volume.seq != null ? `${volume.seq}권 · ` : ""}{volume.name ?? "제목 없음"}</h3><div className="button-row">{volume.isPurchased && <span className="status-badge status-completed">구매 완료</span>}{volume.noNeedToBuy && <span className="status-badge">구매 불필요</span>}</div></div><div className="volume-meta"><span>{volume.author ?? "저자 미상"}</span>{volume.isbn13 && <span>ISBN {volume.isbn13}</span>}<span>{volume.price ? formatWon(volume.price) : "가격 미등록"}</span><span>재고 {volume.stockCount}건</span>{volume.minStockPrice != null && <span>최저 {formatWon(volume.minStockPrice)}</span>}</div>{volume.description && <p className="muted small">{volume.description}</p>}<ExternalLink className="text-link" href={volume.link}>상품 페이지 열기 ↗</ExternalLink><details className="details-card"><summary><span>권 정보 수정</span><span className="chip">#{volume.id}</span></summary><div className="details-body stack-md"><VolumeForm action={updateVolumeAction} bookId={book.id} volume={volume}/><form action={deleteVolumeAction}><input type="hidden" name="bookId" value={book.id}/><input type="hidden" name="volumeId" value={volume.id}/><ConfirmSubmitButton message="이 권과 연결된 지점 재고를 삭제합니까?">권 삭제</ConfirmSubmitButton></form></div></details></div></article>)}</div> : <div className="empty">등록된 권이 없습니다.</div>}
      </section>
    </div>
  );
}
