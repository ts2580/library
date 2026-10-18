"use client";

import { useState } from "react";
import type { VolumeDetail } from "@/features/books/types";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";

export function VolumeForm({
  action,
  bookId,
  volume,
  submitLabel = "저장",
  nextVolume = 1,
  bookType = "",
  categories = [],
  deleteAction
}: {
  action: (formData: FormData) => void | Promise<void>;
  bookId: number;
  volume?: VolumeDetail | null;
  submitLabel?: string;
  nextVolume?: number;
  bookType?: string | null;
  categories?: string[];
  deleteAction?: (formData: FormData) => void | Promise<void>;
}) {
  const key = volume?.id ?? "new";
  const [sideStory, setSideStory] = useState(Boolean(volume && volume.seq == null));
  return (
    <div className="entity-edit-layout entity-edit-layout-volume">
    <form action={action} className="entity-edit-form" aria-label={volume ? "권 정보" : "권 추가"}>
      <div className="form-grid entity-edit-fields">
      <input type="hidden" name="bookId" value={bookId}/>
      {volume && <input type="hidden" name="volumeId" value={volume.id}/>}
      {volume && <div className="field span-2"><label htmlFor={`volume-type-${key}`}>책 카테고리</label>
        <input className="input" id={`volume-type-${key}`} name="type" defaultValue={bookType ?? ""} maxLength={120} list={`volume-types-${key}`}/>
        <datalist id={`volume-types-${key}`}>{categories.map((type) => <option key={type} value={type}/>)}</datalist>
        <span className="muted small">이 권이 속한 책 전체의 카테고리입니다.</span></div>}
      <div className="field"><label htmlFor={`volume-name-${key}`}>권 제목</label><input className="input" id={`volume-name-${key}`} name="name" defaultValue={volume?.name ?? ""} maxLength={500} required/></div>
      <div className="field"><label htmlFor={`volume-seq-${key}`}>권차</label><input className="input" id={`volume-seq-${key}`} name="seq" type="number" min={0} max={100000} defaultValue={volume?.seq ?? nextVolume} disabled={sideStory} required={!sideStory}/>
        <label className="check"><input type="checkbox" checked={sideStory} onChange={(event) => setSideStory(event.target.checked)}/> 외전·특별판</label></div>
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
      </div>
      <div className="button-row volume-form-actions">
        <SubmitButton pendingLabel="저장 중">{submitLabel}</SubmitButton>
      </div>
    </form>
    {volume && deleteAction && <form action={deleteAction} className="entity-delete-form" aria-label="권 삭제">
      <input type="hidden" name="bookId" value={bookId}/><input type="hidden" name="volumeId" value={volume.id}/>
      <ConfirmSubmitButton message="이 권과 연결된 지점 재고를 삭제합니까?">삭제</ConfirmSubmitButton>
    </form>}
    </div>
  );
}
