"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ExistingBookSelect, type BookOption } from "@/components/books/existing-book-select";
import { CoverImage } from "@/components/ui/cover-image";
import { ProgressIndicator } from "@/components/ui/top-progress";
import { Pagination } from "@/components/ui/pagination";
import { formatWon } from "@/lib/format";
import type { AladinBookItem, AladinSearchResult } from "@/features/aladin/types";

function QuickAddItem({ item, query, page, targetBook, categories }: {
  item: AladinBookItem; query: string; page: number; targetBook?: BookOption; categories: string[];
}) {
  const id = useId();
  const router = useRouter();
  const [target, setTarget] = useState<BookOption | null>(targetBook ?? null);
  const [sequence, setSequence] = useState(String(targetBook?.nextVolume ?? 1));
  const [editedSequence, setEditedSequence] = useState(false);
  const [sideStory, setSideStory] = useState(false);
  const [saved, setSaved] = useState<{ bookId: number; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = item.isbn13 ?? item.isbn;
  useEffect(() => {
    if (targetBook && !editedSequence) setSequence(String(targetBook.nextVolume));
  }, [targetBook?.nextVolume, editedSequence]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/aladin/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        query, targetBookId: target?.id ?? null, seriesName: item.title.slice(0, 300), sideStory,
        startVolume: sideStory ? undefined : Number(sequence),
        category: target ? undefined : String(form.get("category") ?? ""),
        totalVolume: target ? undefined : String(form.get("totalVolume") ?? ""),
        selection: [{ page, key, sideStory }]
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "권을 추가하지 못했습니다.");
      setSaved({ bookId: body.bookId, message: `권을 추가했습니다.${body.coverFailures ? " 표지는 프로필에서 다시 생성할 수 있습니다." : ""}` });
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "권을 추가하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <article className="panel stack-md quick-add-item">
    <div className="quick-add-heading"><div className="stock-cover"><CoverImage cover={item.cover} alt={`${item.title} 표지`}/></div>
      <div className="stack-xs"><h3>{item.title}</h3><p className="muted small">{item.author} · {key ?? "ISBN 없음"}</p>
        <p className="muted small">{item.priceSales == null ? "가격 미상" : formatWon(item.priceSales)}</p></div></div>
    {saved ? <div className="flash flash-success" role="status">{saved.message} <Link href={`/books/${saved.bookId}`}>추가한 책 보기</Link></div>
      : item.owned ? <span className="chip">등록됨</span> : !key ? <p className="muted">ISBN이 없어 등록할 수 없습니다.</p>
      : <form className="form-grid" onSubmit={submit} autoComplete="off">
        {!targetBook && <ExistingBookSelect initialOptions={[]} selected={target} disabled={busy} onChange={(book) => { setTarget(book); setSequence(String(book?.nextVolume ?? 1)); }}/>}
        <div className="field"><label htmlFor={`${id}-seq`}>권 번호</label><input className="input" id={`${id}-seq`} type="number" min={1} max={100000}
          value={sequence} onChange={(event) => { setSequence(event.target.value); setEditedSequence(true); }} disabled={busy || sideStory} required={!sideStory}/></div>
        <label className="check"><input type="checkbox" checked={sideStory} disabled={busy} onChange={(event) => setSideStory(event.target.checked)}/> 외전·특별판</label>
        {!target && <><div className="field"><label htmlFor={`${id}-category`}>카테고리</label><input className="input" id={`${id}-category`} name="category" list={`${id}-categories`}
          maxLength={120} disabled={busy} defaultValue={item.categoryName?.split(/>+/).at(-1)?.trim().slice(0, 120) ?? ""}/><datalist id={`${id}-categories`}>{categories.map((category) => <option key={category} value={category}/>)}</datalist></div>
          <div className="field"><label htmlFor={`${id}-total`}>총 권수</label><input className="input" id={`${id}-total`} name="totalVolume" maxLength={30} disabled={busy}/></div></>}
        {error && <p className="flash flash-error span-2" role="alert">{error}</p>}
        <div className="button-row span-2"><button className="button" disabled={busy}>{busy ? <ProgressIndicator label="등록 중"/> : "이 권 저장"}</button></div>
      </form>}
  </article>;
}

export function AladinQuickAdd({ initialQuery = "", initial = null, targetBook, categories = [] }: {
  initialQuery?: string; initial?: AladinSearchResult | null; targetBook?: BookOption; categories?: string[];
}) {
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [searched, setSearched] = useState(initialQuery);
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function search(value: string, page = 1) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/aladin/search?${new URLSearchParams({ query: value, page: String(page) })}`, { signal: controller.signal, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "검색하지 못했습니다.");
      if (!controller.signal.aborted) { setResult(body); setSearched(value); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "검색하지 못했습니다."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <section className="stack-md" aria-label="알라딘 한 권 추가">
    <form className="search-form" onSubmit={(event) => { event.preventDefault(); void search(query.trim()); }}>
      <div className="field"><label htmlFor={id}>알라딘 검색어</label><input className="input" id={id} value={query} maxLength={200} required onChange={(event) => setQuery(event.target.value)}/></div>
      <button className="button" disabled={loading}>{loading ? <ProgressIndicator label="검색 중"/> : "알라딘 검색"}</button>
    </form>
    {error && <p className="flash flash-error" role="alert">{error}</p>}
    {result && <>
      <p className="muted" role="status">검색 결과 {result.totalResults}건 · {result.page}페이지</p>
      <div className="stack-md">{result.items.map((item, index) => <QuickAddItem key={`${searched}:${result.page}:${item.isbn13 ?? item.isbn ?? index}`} item={item} query={searched} page={result.page} targetBook={targetBook} categories={categories}/>)}</div>
      {!result.items.length && <p className="empty">검색 결과가 없습니다. 직접 입력으로 권을 추가할 수 있습니다.</p>}
      <Pagination page={result.page} totalPages={Math.min(50, Math.ceil(result.totalResults / Math.max(1, result.pageSize)))} label="알라딘 한 권 검색 페이지" disabled={loading} onPageChange={page => void search(searched, page)}/>
    </>}
  </section>;
}
