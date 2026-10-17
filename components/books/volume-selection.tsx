"use client";

import { useId, useState, type ReactNode } from "react";
import { deleteVolumesAction } from "@/features/books/actions";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";

export function VolumeSelection({ bookId, items }: { bookId: number; items: Array<{ id: number; name: string; content: ReactNode }> }) {
  const formId = useId();
  const [selected, setSelected] = useState<number[]>([]);
  return <div className="stack-md">
    <form id={formId} action={deleteVolumesAction} className="button-row">
      <input type="hidden" name="bookId" value={bookId}/>
      <label className="check"><input type="checkbox" checked={items.length > 0 && selected.length === items.length}
        onChange={(event) => setSelected(event.target.checked ? items.map((item) => item.id) : [])}/> 모든 권 선택</label>
      <ConfirmSubmitButton disabled={!selected.length} message={`선택한 ${selected.length}개 권과 연결된 지점 재고를 삭제합니까?`}>선택한 권 삭제 ({selected.length})</ConfirmSubmitButton>
    </form>
    {items.map((item) => <div key={item.id} className="stack-sm">
      <label className="check"><input type="checkbox" name="volumeIds" value={item.id} form={formId} checked={selected.includes(item.id)}
        onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, item.id] : previous.filter((id) => id !== item.id))}/> {item.name} 삭제 선택</label>
      {item.content}
    </div>)}
  </div>;
}
