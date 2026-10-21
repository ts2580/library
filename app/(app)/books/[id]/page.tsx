import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/features/auth/authorization";
import { getBookDetail, getManualBookCategories } from "@/features/books/queries";
import { addVolumeAction, deleteBookAction, deleteVolumeAction, updateBookAction, updateVolumeAction, enrichBookInfoAction } from "@/features/books/actions";
import { VolumeSelection } from "@/components/books/volume-selection";
import { BookForm } from "@/components/books/book-form";
import { AladinQuickAdd } from "@/components/books/aladin-quick-add";
import { VolumeAddTools } from "@/components/books/volume-add-tools";
import { VolumeDetailDialog } from "@/components/books/volume-detail-dialog";
import { VolumeForm } from "@/components/books/volume-form";
import { CoverImage } from "@/components/ui/cover-image";
import { FlashMessage } from "@/components/ui/flash-message";
import { formatWon } from "@/lib/format";
import { ExternalLink } from "@/components/ui/external-link";
import { getStockRefreshProgress } from "@/features/inventory/queries";

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
  const categories = getManualBookCategories();
  const nextVolume = Math.max(0, ...book.volumes.map((volume) => volume.seq ?? 0)) + 1;
  return (
    <div className="page">
      <div className="button-row"><Link className="button button-outline button-small" href="/books">← 책장</Link><Link className="button button-secondary button-small" href={`/aladin/search?bookId=${book.id}`}>알라딘에서 권 추가</Link></div>
      <FlashMessage message={query.message} error={query.error}/>
      <div className="book-detail-layout"><div className="book-detail-sidebar">
      <section className="panel book-hero">
        <div className="book-hero-cover"><CoverImage cover={book.cover} alt={book.name ?? "책"} className="h-full w-full object-cover"/></div>
        <div className="stack-md"><div><p className="eyebrow">Book detail</p><h1>{book.name ?? "제목 없음"}</h1><p className="page-subtitle">{book.author ?? "저자 미상"}</p></div><div className="button-row"><span className="chip">{book.type ?? "미분류"}</span><span className="chip">{book.volumeCount}권</span>{book.totalVolume && <span className="chip">총 권수 {book.totalVolume}</span>}</div>{book.description && <p className="muted">{book.description}</p>}</div>
      </section>
      <section className="panel stack-md"><BookForm action={updateBookAction} deleteAction={deleteBookAction} enrichAction={enrichBookInfoAction} book={book} categories={categories}/>
      </section>
      </div><section className="panel stack-md book-volumes-panel" aria-labelledby="volumes-heading"><div className="section-heading"><div><p className="eyebrow">Volumes</p><h2 id="volumes-heading">권 목록</h2></div><span className="chip">{book.volumes.length}권</span></div>
        <VolumeAddTools
          stockSearch={user.role === "ADMIN" ? { bookId: book.id, initial: getStockRefreshProgress(user.id) } : undefined}
          manual={<VolumeForm action={addVolumeAction} bookId={book.id} nextVolume={nextVolume} submitLabel="권 추가"/>}
          search={<AladinQuickAdd initialQuery={book.name ?? ""} targetBook={{ id: book.id, name: book.name ?? "", author: book.author, cover: book.cover, type: book.type, nextVolume }}/>}
        />
        {book.volumes.length ? <VolumeSelection key={book.volumes.map(volume => volume.id).join(",")} bookId={book.id} items={book.volumes.map((volume) => {
          const title = `${volume.seq != null ? `${volume.seq}권 · ` : "외전 · "}${volume.name ?? "제목 없음"}`;
          const publicationDate = volume.pubDate?.trim().match(/^\d{4}-\d{2}-\d{2}(?=$|[T\s])/)?.[0];
          return { id: volume.id, name: volume.name ?? "제목 없음", content: <article className="volume-card" key={volume.id}>
            <div className="volume-cover-section">
              <div className="volume-cover"><CoverImage cover={volume.cover} alt={volume.name ?? "권"} className="h-full w-full object-cover"/></div>
              <ExternalLink className="text-link volume-product-link" href={volume.link}>상품 페이지 열기 ↗</ExternalLink>
            </div>
            <div className="stack-sm">
              <div className="volume-title"><h3>{title}</h3>
                <VolumeDetailDialog title={title}>
                  <VolumeForm action={updateVolumeAction} deleteAction={deleteVolumeAction} bookId={book.id} volume={volume} bookType={book.type} categories={categories}/>
                </VolumeDetailDialog>
              </div>
              {(volume.isPurchased || volume.noNeedToBuy) && <div className="button-row">
                {volume.isPurchased && <span className="status-badge status-completed">구매 완료</span>}
                {volume.noNeedToBuy && <span className="status-badge">구매 불필요</span>}
              </div>}
              <div className="volume-meta"><span>{volume.author ?? "저자 미상"}</span>{volume.isbn13 && <span>ISBN {volume.isbn13}</span>}
                {publicationDate && <span>출간일 <time dateTime={publicationDate}>{publicationDate}</time></span>}
                <span>{volume.price ? formatWon(volume.price) : "가격 미등록"}</span><span>재고 {volume.stockCount}건</span>
                {volume.minStockPrice != null && <span>최저 {formatWon(volume.minStockPrice)}</span>}
              </div>
              {volume.description && <p className="muted small">{volume.description}</p>}
            </div>
          </article> };
        })}/> : <div className="empty">등록된 권이 없습니다.</div>}

      </section>
      </div>
    </div>
  );
}
