import type { VolumeDetail } from "@/features/books/types";
import { SubmitButton } from "@/components/ui/submit-button";

export function VolumeForm({
  action,
  bookId,
  volume,
  submitLabel = "권 저장"
}: {
  action: (formData: FormData) => void | Promise<void>;
  bookId: number;
  volume?: VolumeDetail | null;
  submitLabel?: string;
}) {
  const key = volume?.id ?? "new";
  return (
    <form action={action} className="form-grid" encType="multipart/form-data">
      <input type="hidden" name="bookId" value={bookId}/>
      {volume && <input type="hidden" name="volumeId" value={volume.id}/>}
      <div className="field"><label htmlFor={`volume-name-${key}`}>권 제목</label><input className="input" id={`volume-name-${key}`} name="name" defaultValue={volume?.name ?? ""} maxLength={500} required/></div>
      <div className="field"><label htmlFor={`volume-seq-${key}`}>권차</label><input className="input" id={`volume-seq-${key}`} name="seq" type="number" min={0} max={100000} defaultValue={volume?.seq ?? ""}/></div>
      <div className="field"><label htmlFor={`volume-isbn-${key}`}>ISBN13</label><input className="input" id={`volume-isbn-${key}`} name="isbn13" defaultValue={volume?.isbn13 ?? ""} maxLength={32}/></div>
      <div className="field"><label htmlFor={`volume-author-${key}`}>저자</label><input className="input" id={`volume-author-${key}`} name="author" defaultValue={volume?.author ?? ""} maxLength={300}/></div>
      <div className="field"><label htmlFor={`volume-price-${key}`}>가격</label><input className="input" id={`volume-price-${key}`} name="price" inputMode="numeric" defaultValue={volume?.price ?? ""} maxLength={30}/></div>
      <div className="field"><label htmlFor={`volume-pubdate-${key}`}>출간일</label><input className="input" id={`volume-pubdate-${key}`} name="pubDate" defaultValue={volume?.pubDate ?? ""} maxLength={40}/></div>
      <div className="field span-2"><label htmlFor={`volume-link-${key}`}>상품 링크</label><input className="input" id={`volume-link-${key}`} name="link" inputMode="url" defaultValue={volume?.link ?? ""} maxLength={2048}/></div>
      <div className="field span-2"><label htmlFor={`volume-description-${key}`}>설명</label><textarea className="textarea" id={`volume-description-${key}`} name="description" defaultValue={volume?.description ?? ""} maxLength={5000}/></div>
      <div className="field"><label htmlFor={`volume-cover-url-${key}`}>표지 URL</label><input className="input" id={`volume-cover-url-${key}`} name="coverUrl" inputMode="url" placeholder="https://..." maxLength={2048}/></div>
      <div className="field"><label htmlFor={`volume-cover-file-${key}`}>표지 파일</label><input className="input file-input" id={`volume-cover-file-${key}`} type="file" name="coverFile" accept="image/jpeg,image/png,image/gif,image/webp"/></div>
      <div className="check-row span-2">
        <label className="check"><input type="checkbox" name="isPurchased" defaultChecked={volume?.isPurchased ?? false}/> 구매 완료</label>
        <label className="check"><input type="checkbox" name="noNeedToBuy" defaultChecked={volume?.noNeedToBuy ?? false}/> 구매 불필요</label>
      </div>
      <div className="button-row span-2"><SubmitButton pendingLabel="저장 중">{submitLabel}</SubmitButton></div>
    </form>
  );
}
