"use client";

import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { CoverImage } from "@/components/ui/cover-image";
import type { BookOption } from "@/features/books/types";
export type { BookOption } from "@/features/books/types";

export function ExistingBookSelect({ selected, onChange, disabled = false }: {
  initialOptions: BookOption[]; selected: BookOption | null; onChange: (value: BookOption | null) => void; disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  const [query, setQuery] = useState(selected?.name ?? "");
  const [options, setOptions] = useState<BookOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const expanded = open && Boolean(query.trim()) && !disabled;

  useLayoutEffect(() => {
    if (!expanded) return;
    const position = () => {
      if (!anchor.current || !list.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const room = bottom - rect.bottom - (window.innerWidth <= 820 ? 100 : 16);
      setAbove(room < Math.min(320, list.current.scrollHeight) && rect.top > room);
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
    };
  }, [expanded, options, loading, error]);

  useEffect(() => {
    const controller = new AbortController();
    setOptions([]); setHighlight(-1); setError("");
    if (!expanded) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/books/options?query=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("기존 책을 불러오지 못했습니다. 다시 검색해 주세요.");
        const found = await response.json() as BookOption[];
        if (!controller.signal.aborted) { setOptions(found); setHighlight(found.length ? 0 : -1); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "기존 책 검색에 실패했습니다."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 180);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query, expanded]);

  useEffect(() => {
    const container = list.current;
    const option = container?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!container || !option) return;
    const bounds = container.getBoundingClientRect();
    const item = option.getBoundingClientRect();
    if (item.top < bounds.top) container.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) container.scrollTop += item.bottom - bounds.bottom;
  }, [highlight]);

  function select(book: BookOption) {
    onChange(book); setQuery(book.name); setOpen(false); setOptions([]); input.current?.focus();
  }
  function clear() {
    onChange(null); setQuery(""); setOpen(false); setOptions([]); input.current?.focus();
  }
  return <div className="field span-2 book-autocomplete" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label htmlFor={id}>기존 책 검색</label>
    <div className="book-autocomplete-anchor" ref={anchor}>
      <input ref={input} id={id} className="input" value={query} maxLength={200} autoComplete="off" disabled={disabled}
        role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-results`}
        aria-activedescendant={expanded && highlight >= 0 ? `${id}-option-${options[highlight]?.id}` : undefined}
        placeholder="기존 책 검색 · 비우면 새 책으로 등록"
        onChange={(event) => { setQuery(event.target.value); setOptions([]); setHighlight(-1); setOpen(true); if (selected) onChange(null); }}
        onFocus={() => {
          const rect = input.current?.getBoundingClientRect();
          const viewport = window.visualViewport;
          const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
          if (rect && (rect.bottom > bottom - 180 || rect.top < 100)) input.current?.scrollIntoView({ block: "center" });
          if (query.trim() && !selected) setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            if (options.length) setHighlight((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (expanded && options[highlight]) select(options[highlight]);
          }
        }}/>
      {expanded && <div className={`book-autocomplete-results${above ? " book-autocomplete-above" : ""}`} ref={list}>
        {loading && <Spinner label="기존 책 검색 중"/>}
        {error && <p role="alert" className="flash flash-error">{error}</p>}
        {!loading && !error && !options.length && <p className="muted small" role="status">일치하는 기존 책이 없습니다. 새 책으로 등록할 수 있습니다.</p>}
        <div id={`${id}-results`} role="listbox" aria-label="기존 책 검색 결과" aria-busy={loading}>
          {options.map((book, index) => <button type="button" className="book-autocomplete-option" key={book.id}
            id={`${id}-option-${book.id}`} role="option" aria-selected={highlight === index} tabIndex={-1}
            onMouseEnter={() => setHighlight(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => select(book)}>
            <span className="book-autocomplete-cover"><CoverImage cover={book.cover} alt={`${book.name} 표지`}/></span>
            <span className="book-autocomplete-copy"><strong>{book.name}</strong><span className="muted small">{book.author || "저자 미입력"} · {book.type || "미분류"} · 다음 {book.nextVolume}권</span></span>
          </button>)}
        </div>
      </div>}
    </div>
    {selected ? <div className="button-row"><span className="muted small" role="status">선택됨 · {selected.name} · {selected.type ?? "미분류"} · 다음 정규 권차 {selected.nextVolume}권부터 추가</span>
      <button type="button" className="button button-outline button-small" disabled={disabled} onClick={clear}>새 책으로 등록</button></div>
      : <span className="muted small">검색 결과에서 책을 선택하거나, 비워 두고 새 책으로 등록하세요.</span>}
  </div>;
}
