"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";

export type BookOption = { id: number; name: string; author: string | null; type: string | null; nextVolume: number };

export function ExistingBookSelect({ initialOptions, selected, onChange, disabled = false }: {
  initialOptions: BookOption[]; selected: BookOption | null; onChange: (value: BookOption | null) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(initialOptions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    if (!query.trim()) { setOptions(initialOptions); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/books/options?query=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("기존 책 검색에 실패했습니다.");
        const found = await response.json() as BookOption[];
        if (!controller.signal.aborted) setOptions(found);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "기존 책 검색에 실패했습니다."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query, initialOptions]);
  const choices = selected && !options.some((option) => option.id === selected.id) ? [selected, ...options] : options;
  return <>
    <div className="field"><label htmlFor="target-book-query">기존 책 검색</label>
      <input id="target-book-query" className="input" value={query} maxLength={200} autoComplete="off" disabled={disabled}
        placeholder="제목 또는 저자로 찾기" onChange={(event) => setQuery(event.target.value)}/>
      {loading && <Spinner label="기존 책 검색 중"/>}
      {error && <span role="alert" className="flash flash-error">{error}</span>}
      {!loading && query.trim() && !options.length && !error && <span className="muted small">기존 책이 없습니다. 새 책으로 등록할 수 있습니다.</span>}
    </div>
    <div className="field"><label htmlFor="target-book">등록 위치</label>
      <select id="target-book" className="select" value={selected?.id ?? ""} disabled={disabled || loading}
        onChange={(event) => onChange(choices.find((option) => option.id === Number(event.target.value)) ?? null)}>
        <option value="">새 책으로 등록</option>{choices.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
      {selected && <span className="muted small">{selected.type ?? "미분류"} · 다음 정규 권차 {selected.nextVolume}권부터 추가</span>}
    </div>
  </>;
}
