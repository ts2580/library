import { BookDetailLink } from "@/components/books/book-detail-link";
import type { BookListItem } from "@/features/books/types";
import { CoverImage } from "@/components/ui/cover-image";

export function BookCard({ book }: { book: BookListItem }) {
  return (
    <BookDetailLink bookId={book.id} className="book-card">
      <div className="book-card-cover"><CoverImage cover={book.cover} alt={book.name ?? "책"} className="h-full w-full object-cover"/></div>
      <div className="book-card-copy">
        <h2>{book.name ?? "제목 없음"}</h2>
        <p>{book.author ?? "저자 미상"}</p>
        <div className="book-card-meta"><span>{book.volumeCount}권</span><span className="chip">{book.type ?? "미분류"}</span></div>
      </div>
    </BookDetailLink>
  );
}
