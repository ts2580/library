"use client";

import { useState } from "react";
import { AladinSelection } from "@/components/books/aladin-selection";
import type { BookOption } from "@/components/books/existing-book-select";

export function ManualBookCreate({ categories, options }: { categories: string[]; options: BookOption[] }) {
  const [open, setOpen] = useState(false);
  return <details className="details-card" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>책 직접 추가</span><span className="chip">기존 책 · 알라딘 · 직접 입력</span></summary>
    {open && <div className="details-body"><AladinSelection manual categories={categories} query="" initial={null} initialOptions={options} selectedBookId={null}/></div>}
  </details>;
}
