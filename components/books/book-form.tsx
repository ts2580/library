import type { BookDetail } from "@/features/books/types";
import { SubmitButton } from "@/components/ui/submit-button";
import { CategorySelect } from "@/components/books/category-select";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";

export function BookForm({
  action,
  book,
  categories = [],
  submitLabel = "저장",
  deleteAction,
  enrichAction,
  returnTo
}: {
  action: (formData: FormData) => void | Promise<void>;
  book?: BookDetail | null;
  categories?: string[];
  submitLabel?: string;
  deleteAction?: (formData: FormData) => void | Promise<void>;
  enrichAction?: (formData: FormData) => void | Promise<void>;
  returnTo?: string;
}) {
  return (
    <div className="entity-edit-layout entity-edit-layout-book">
    <form action={action} className="entity-edit-form book-edit-form" aria-label="책 정보">
      <div className="form-grid entity-edit-fields">
      {book && <input type="hidden" name="bookId" value={book.id}/>}
      {returnTo && <input type="hidden" name="returnTo" value={returnTo}/>}
      <div className="field"><label htmlFor={`book-name-${book?.id ?? "new"}`}>제목</label><input className="input" id={`book-name-${book?.id ?? "new"}`} name="name" defaultValue={book?.name ?? ""} maxLength={300} required/></div>
      <div className="field"><label htmlFor={`book-author-${book?.id ?? "new"}`}>저자</label><input className="input" id={`book-author-${book?.id ?? "new"}`} name="author" defaultValue={book?.author ?? ""} maxLength={300}/></div>
      <CategorySelect id={`book-type-${book?.id ?? "new"}`} categories={categories} initialValue={book?.type ?? ""}/>
      <div className="field"><label htmlFor={`book-total-${book?.id ?? "new"}`}>총 권수</label><input className="input" id={`book-total-${book?.id ?? "new"}`} name="totalVolume" defaultValue={book?.totalVolume ?? ""} maxLength={30}/></div>
      <div className="field span-2"><label htmlFor={`book-description-${book?.id ?? "new"}`}>설명</label><textarea className="textarea" id={`book-description-${book?.id ?? "new"}`} name="description" defaultValue={book?.description ?? ""} maxLength={5000}/></div>
      <div className="field"><label htmlFor={`book-cover-url-${book?.id ?? "new"}`}>표지 URL</label><input className="input" id={`book-cover-url-${book?.id ?? "new"}`} name="coverUrl" inputMode="url" placeholder="https://..." maxLength={2048}/><span className="muted small">새 URL을 입력한 경우에만 기존 표지가 교체됩니다.</span></div>
      <div className="field"><label htmlFor={`book-cover-file-${book?.id ?? "new"}`}>표지 파일</label><input className="input file-input" id={`book-cover-file-${book?.id ?? "new"}`} type="file" name="coverFile" accept="image/jpeg,image/png,image/gif,image/webp"/><span className="muted small">최대 8MB. 파일이 URL보다 우선합니다.</span></div>
      </div>
      <div className="button-row book-form-actions"><SubmitButton pendingLabel="저장 중">{submitLabel}</SubmitButton></div>
    </form>
    {book && enrichAction && <form action={enrichAction} className="book-enrichment-form" title="빈 저자·설명과 각 권의 상품 링크를 알라딘에서 채웁니다.">
      <input type="hidden" name="bookId" value={book.id}/>
      {returnTo && <input type="hidden" name="returnTo" value={returnTo}/>}
      <SubmitButton pendingLabel="정보 검색 중" className="button button-outline" progress>저자/설명 알라딘에서 넣기</SubmitButton>
    </form>}
    {book && deleteAction && <form action={deleteAction} className="entity-delete-form" aria-label="책 삭제">
      <input type="hidden" name="bookId" value={book.id}/>
      {returnTo && <input type="hidden" name="returnTo" value={returnTo}/>}
      <ConfirmSubmitButton message="책과 모든 권, 연결된 재고를 삭제합니까?">책 삭제</ConfirmSubmitButton>
    </form>}
    </div>
  );
}
