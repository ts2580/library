import type { BookDetail } from "@/features/books/types";
import { SubmitButton } from "@/components/ui/submit-button";
import { CategorySelect } from "@/components/books/category-select";

export function BookForm({
  action,
  book,
  categories = [],
  submitLabel = "저장"
}: {
  action: (formData: FormData) => void | Promise<void>;
  book?: BookDetail | null;
  categories?: string[];
  submitLabel?: string;
}) {
  return (
    <form action={action} className="form-grid" encType="multipart/form-data">
      {book && <input type="hidden" name="bookId" value={book.id}/>}
      <div className="field"><label htmlFor={`book-name-${book?.id ?? "new"}`}>제목</label><input className="input" id={`book-name-${book?.id ?? "new"}`} name="name" defaultValue={book?.name ?? ""} maxLength={300} required/></div>
      <div className="field"><label htmlFor={`book-author-${book?.id ?? "new"}`}>저자</label><input className="input" id={`book-author-${book?.id ?? "new"}`} name="author" defaultValue={book?.author ?? ""} maxLength={300}/></div>
      <CategorySelect id={`book-type-${book?.id ?? "new"}`} categories={categories} initialValue={book?.type ?? ""}/>
      <div className="field"><label htmlFor={`book-total-${book?.id ?? "new"}`}>총 권수 메모</label><input className="input" id={`book-total-${book?.id ?? "new"}`} name="totalVolume" defaultValue={book?.totalVolume ?? ""} maxLength={30}/></div>
      <div className="field span-2"><label htmlFor={`book-description-${book?.id ?? "new"}`}>설명</label><textarea className="textarea" id={`book-description-${book?.id ?? "new"}`} name="description" defaultValue={book?.description ?? ""} maxLength={5000}/></div>
      <div className="field"><label htmlFor={`book-cover-url-${book?.id ?? "new"}`}>표지 URL</label><input className="input" id={`book-cover-url-${book?.id ?? "new"}`} name="coverUrl" inputMode="url" placeholder="https://..." maxLength={2048}/><span className="muted small">새 URL을 입력한 경우에만 기존 표지가 교체됩니다.</span></div>
      <div className="field"><label htmlFor={`book-cover-file-${book?.id ?? "new"}`}>표지 파일</label><input className="input file-input" id={`book-cover-file-${book?.id ?? "new"}`} type="file" name="coverFile" accept="image/jpeg,image/png,image/gif,image/webp"/><span className="muted small">최대 8MB. 파일이 URL보다 우선합니다.</span></div>
      <div className="button-row span-2"><SubmitButton pendingLabel="저장 중">{submitLabel}</SubmitButton></div>
    </form>
  );
}
