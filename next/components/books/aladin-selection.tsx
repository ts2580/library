"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CoverImage } from "@/components/ui/cover-image";
import { formatWon } from "@/lib/format";
import type { AladinSearchResult } from "@/features/aladin/types";

type Option = { id: number; name: string; author: string | null };
type Selection = { page: number; key: string };

export function AladinSelection({ query, initial, initialOptions, selectedBookId }: {
  query: string; initial: AladinSearchResult; initialOptions: Option[]; selectedBookId: number | null;
}) {
  const router = useRouter();
  const [result, setResult] = useState(initial);
  const [selection, setSelection] = useState<Selection[]>([]);
  const [target, setTarget] = useState(selectedBookId ? String(selectedBookId) : "");
  const [seriesName, setSeriesName] = useState(query);
  const [sideStory, setSideStory] = useState(false);
  const [options, setOptions] = useState(initialOptions);
  const [bookQuery, setBookQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const pageRequest = useRef<AbortController | null>(null);
  const totalPages = Math.min(50, Math.ceil(result.totalResults / Math.max(1, result.pageSize)));

  useEffect(() => () => pageRequest.current?.abort(), []);
  useEffect(() => {
    if (!bookQuery.trim()) { setOptions(initialOptions); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/books/options?query=${encodeURIComponent(bookQuery)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("기존 책 검색에 실패했습니다.");
        const found = await response.json() as Option[];
        setOptions((previous) => {
          const chosen = previous.find((option) => String(option.id) === target);
          return chosen && !found.some((option) => option.id === chosen.id) ? [chosen, ...found] : found;
        });
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "기존 책 검색에 실패했습니다.");
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [bookQuery, initialOptions, target]);

  async function loadPage(page: number) {
    pageRequest.current?.abort();
    const controller = new AbortController(); pageRequest.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/aladin/search?query=${encodeURIComponent(query)}&page=${page}`, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "페이지 로딩에 실패했습니다.");
      if (body.page !== page || !Array.isArray(body.items)) throw new Error("검색 결과 페이지를 확인할 수 없습니다.");
      setResult(body as AladinSearchResult);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "페이지 로딩에 실패했습니다.");
    } finally {
      if (pageRequest.current === controller) setLoading(false);
    }
  }

  function toggle(keys: string[], checked: boolean) {
    const remaining = selection.filter((item) => item.page !== result.page || !keys.includes(item.key));
    const next = checked ? [...remaining, ...keys.map((key) => ({ page: result.page, key }))] : remaining;
    if (new Set(next.map((item) => item.page)).size > 10) { setError("한 번에 최대 10개 페이지에서 선택할 수 있습니다."); return; }
    setSelection(next); setError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/aladin/import", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, targetBookId: target ? Number(target) : null, seriesName, sideStory, selection }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "등록에 실패했습니다.");
      router.push(`/books/${body.bookId}?message=${encodeURIComponent(`${body.count}권을 등록했습니다.`)}`);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "등록에 실패했습니다."); }
    finally { setSaving(false); }
  }

  const keys = result.items.map((item) => item.isbn13 ?? item.isbn).filter((key): key is string => Boolean(key));
  return <section className="stack-md" aria-label="알라딘 선택 등록">
    <div className="section-heading"><h2>검색 결과</h2><span className="chip">{result.totalResults.toLocaleString("ko-KR")}건</span></div>
    {error && <p className="flash flash-error" role="alert">{error}</p>}
    <div className="button-row"><button className="button button-outline" type="button" disabled={loading || saving || !keys.length} onClick={() => toggle(keys, true)}>현재 페이지 모두 선택</button>
      <button className="button button-outline" type="button" disabled={saving} onClick={() => setSelection([])}>선택 초기화</button>
      <span role="status">{selection.length}권 선택</span></div>
    <div className="search-results" aria-busy={loading}>{result.items.map((item, index) => {
      const key = item.isbn13 ?? item.isbn;
      return <article className="search-result-card" key={`${key ?? item.title}-${index}`}>
        <div className="search-result-cover"><CoverImage cover={item.cover} alt={item.title} className="h-full w-full object-cover"/></div>
        <div className="stack-sm"><label className="check"><input type="checkbox" aria-label={`선택 ${item.title}`} disabled={!key || loading || saving}
          checked={Boolean(key && selection.some((entry) => entry.page === result.page && entry.key === key))}
          onChange={(event) => key && toggle([key], event.target.checked)}/><strong>{item.title}</strong></label>
          <p className="muted small">{item.author ?? "저자 미상"} · {key ?? "ISBN 없음"}</p>
          {item.priceSales != null && <span>{formatWon(item.priceSales)}</span>}
          {item.description && <p className="muted search-description">{item.description}</p>}
        </div></article>;
    })}</div>
    {!result.items.length && <p className="empty">검색 결과가 없습니다.</p>}
    <nav className="button-row" aria-label="알라딘 검색 페이지">
      <button type="button" className="button button-outline" disabled={loading || saving || result.page <= 1} onClick={() => loadPage(result.page - 1)}>이전 페이지</button>
      <span>{result.page} / {Math.max(1, totalPages)}</span>
      <button type="button" className="button button-outline" disabled={loading || saving || result.page >= totalPages} onClick={() => loadPage(result.page + 1)}>다음 페이지</button>
    </nav>
    <form className="panel form-grid" onSubmit={submit}>
      <div className="field"><label htmlFor="target-book-query">기존 책 검색</label><input className="input" id="target-book-query" value={bookQuery} onChange={(event) => setBookQuery(event.target.value)} maxLength={200} autoComplete="off"/></div>
      <div className="field"><label htmlFor="target-book">등록 위치</label><select className="select" id="target-book" value={target} onChange={(event) => setTarget(event.target.value)} disabled={saving}>
        <option value="">새 책으로 등록</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select></div>
      {!target && <div className="field span-2"><label htmlFor="series-name">새 책 제목</label><input id="series-name" className="input" value={seriesName} onChange={(event) => setSeriesName(event.target.value)} required maxLength={300}/></div>}
      <label className="check span-2"><input type="checkbox" checked={sideStory} onChange={(event) => setSideStory(event.target.checked)} disabled={saving}/> 외전·특별판으로 추가</label>
      <p className="muted small span-2">뒤 페이지부터, 각 페이지의 위에서 아래 순서로 권차를 붙입니다.</p>
      <button type="submit" className="button" disabled={saving || loading || !selection.length}>{saving ? "등록 중" : `${selection.length}권 추가`}</button>
    </form>
  </section>;
}
