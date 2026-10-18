"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CoverImage } from "@/components/ui/cover-image";
import { Spinner } from "@/components/ui/spinner";
import { CategorySelect } from "@/components/books/category-select";
import { ExistingBookSelect, type BookOption } from "@/components/books/existing-book-select";
import { formatWon } from "@/lib/format";
import type { AladinSearchResult } from "@/features/aladin/types";
import type { AladinSearchOptions } from "@/features/aladin/validation";
import { fetchSearchPreview } from "@/features/aladin/search-client";
import { orderByPublicationDate } from "@/features/aladin/volume-order";
import { NewBookCategoryDialog } from "@/components/books/new-book-category-dialog";

type Selection = { page: number; key: string; sideStory?: boolean };

export function AladinSelection({ query, initial, initialOptions, selectedBookId, manual = false, categories = [], searchOptions, selectedTarget, onTargetChange, showTargetPicker = true }: {
  query: string; initial: AladinSearchResult | null; initialOptions: BookOption[]; selectedBookId: number | null;
  manual?: boolean; categories?: string[];
  searchOptions?: AladinSearchOptions;
  selectedTarget?: BookOption | null;
  onTargetChange?: (book: BookOption | null) => void;
  showTargetPicker?: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState(initial);
  const [selection, setSelection] = useState<Selection[]>([]);
  const [localTarget, setLocalTarget] = useState<BookOption | null>(initialOptions.find((option) => option.id === selectedBookId) ?? null);
  const target = selectedTarget === undefined ? localTarget : selectedTarget;
  function setTarget(book: BookOption | null) { setLocalTarget(book); onTargetChange?.(book); }
  const [seriesName, setSeriesName] = useState(query);
  const [direct, setDirect] = useState(false);
  const tabsId = useId();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const pageRequest = useRef<AbortController | null>(null);
  const pages = useRef(new Map<number, AladinSearchResult>(initial ? [[initial.page, initial]] : []));
  const searchedQuery = useRef(query);
  const totalPages = result ? Math.min(50, Math.ceil(result.totalResults / Math.max(1, result.pageSize))) : 0;
  useEffect(() => () => pageRequest.current?.abort(), []);

  function resetPreview() {
    pageRequest.current?.abort(); pageRequest.current = null;
    setResult(null); setSelection([]); setLoading(false); setError(""); pages.current.clear();
  }

  function changeMode(next: boolean) {
    if (next === direct) return;
    setDirect(next); setTarget(null); resetPreview();
  }

  async function loadPage(page: number, searchQuery = manual ? seriesName.trim() : query) {
    pageRequest.current?.abort();
    const controller = new AbortController(); pageRequest.current = controller;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ query: searchQuery, page: String(page) });
      for (const [key, value] of Object.entries(searchOptions ?? {})) if (value != null) params.set(key, String(value));
      const body = await fetchSearchPreview(params, controller.signal);
      if (body.page !== page || !Array.isArray(body.items)) throw new Error("검색 결과 페이지를 확인할 수 없습니다.");
      if (controller.signal.aborted) return;
      searchedQuery.current = searchQuery;
      const visited = pages.current.has(page);
      pages.current.set(page, body);
      setResult(body as AladinSearchResult);
      if (manual && !visited) {
        const keys = (body as AladinSearchResult).items.filter((item) => !item.owned).map((item) => item.isbn13 ?? item.isbn).filter((key): key is string => Boolean(key));
        setSelection((previous) => {
          const next = [...previous, ...keys.filter((key) => !previous.some((entry) => entry.key === key)).map((key) => ({ page, key }))];
          return new Set(next.map((entry) => entry.page)).size <= 10 ? next : previous;
        });
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "검색에 실패했습니다.");
    } finally { if (pageRequest.current === controller) setLoading(false); }
  }

  function toggle(keys: string[], checked: boolean) {
    if (!result) return;
    const remaining = selection.filter((item) => !keys.includes(item.key));
    const next = checked ? [...remaining, ...keys.map((key) => ({ page: result.page, key }))] : remaining;
    if (new Set(next.map((item) => item.page)).size > 10) { setError("한 번에 최대 10개 페이지에서 선택할 수 있습니다."); return; }
    setSelection(next); setError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || saving) return;
    if (manual && !direct && (!result || searchedQuery.current !== seriesName.trim())) { await loadPage(1); return; }
    if (!manual && !selection.length) return;
    if (!manual && !target && !categoryOpen) { setError(""); setCategoryOpen(true); return; }
    const form = new FormData(event.currentTarget);
    setSaving(true); setError("");
    try {
      let response: Response;
      if (manual) {
        const book = Object.fromEntries(["author", "description", "type", "totalVolume", "coverUrl"].map((key) => [key, String(form.get(key) ?? "")]));
        form.set("payload", JSON.stringify({ book: { ...book, name: seriesName }, direct, targetBookId: direct ? null : target?.id ?? null, selection }));
        response = await fetch("/api/books/manual", { method: "POST", body: form });
      } else {
        response = await fetch("/api/aladin/import", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, targetBookId: target?.id ?? null, seriesName, sideStory: false, selection, searchOptions,
            category: target ? undefined : String(form.get("type") ?? "") }) });
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "등록에 실패했습니다.");
      const message = (body.count ? `${body.count}권을 등록했습니다.` : "책을 추가했습니다.")
        + (body.coverFailures ? ` 표지 ${body.coverFailures}건은 내려받지 못했습니다. 프로필에서 표지 재생성을 실행해 주세요.` : "");
      router.push(`/books/${body.bookId}?message=${encodeURIComponent(message)}`);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "등록에 실패했습니다."); }
    finally { setSaving(false); }
  }

  // Preview and server registration share publication-date ordering.
  let nextVolume = target?.nextVolume ?? 1;
  const numbering = new Map<string, number | null>();
  const selectedItems: Array<{ key: string; pubDate: string | null; sideStory: boolean }> = [];
  for (const page of [...pages.current.keys()].sort((a, b) => b - a)) {
    for (const item of pages.current.get(page)!.items) {
      const key = item.isbn13 ?? item.isbn;
      const selected = selection.find((entry) => entry.page === page && entry.key === key);
      if (key && selected) selectedItems.push({ key, pubDate: item.pubDate, sideStory: selected.sideStory ?? false });
    }
  }
  for (const item of orderByPublicationDate(selectedItems)) numbering.set(item.key, item.sideStory ? null : nextVolume++);
  const keys = result?.items.filter((item) => !item.owned).map((item) => item.isbn13 ?? item.isbn).filter((key): key is string => Boolean(key)) ?? [];
  const ready = manual && !direct && Boolean(result);
  const submitLabel = saving ? "등록 중" : manual && direct ? "책 추가" : manual && !result ? "추가 예정 확인"
    : ready && !result?.items.length && !target ? "책만 추가" : `${selection.length}권 추가`;
  const submitButton = <button type="submit" className="button" disabled={saving || loading || ((!manual || ready) && !selection.length && !(!target && manual && !result?.items.length))}>
    {saving && <span className="spinner" aria-hidden="true"/>}{submitLabel}</button>;
  if (!manual && !result) return showTargetPicker ? <ExistingBookSelect initialOptions={initialOptions} selected={target} onChange={setTarget}/> : null;
  return <section className="stack-md" aria-label={manual ? "책 직접 추가" : "알라딘 선택 등록"}>
    {manual && <div className="manual-book-tabs" role="tablist" aria-label="책 추가 방법">
      {([{ value: false, id: "aladin", label: "알라딘 검색" }, { value: true, id: "manual", label: "책 수동 추가" }] as const).map((tab, index) => <button
        key={tab.id} className="manual-book-tab" type="button" role="tab" id={`${tabsId}-${tab.id}-tab`} aria-selected={direct === tab.value}
        aria-controls={`${tabsId}-panel`} tabIndex={direct === tab.value ? 0 : -1} disabled={saving} onClick={() => changeMode(tab.value)} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
          changeMode(next === 1);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{tab.label}</button>)}
    </div>}
    <div role={manual ? "tabpanel" : undefined} id={manual ? `${tabsId}-panel` : undefined} aria-labelledby={manual ? `${tabsId}-${direct ? "manual" : "aladin"}-tab` : undefined}>
    {manual && direct && <p className="muted small manual-book-description">ISBN이 없는 오래된 책이나 동인지도 등록할 수 있습니다.</p>}
    <form className="form-grid" autoComplete="off" onSubmit={submit} encType="multipart/form-data" onKeyDown={(event) => {
      if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
    }}>
      {!direct && showTargetPicker && <ExistingBookSelect initialOptions={initialOptions} selected={target} disabled={saving} onChange={(value) => {
        setTarget(value); if (manual) { resetPreview(); if (!seriesName.trim() && value) setSeriesName(value.name); }
      }}/>}
      {(manual || !target) && <div className="field span-2"><label htmlFor="series-name">{manual ? "제목" : "새 책 제목"}</label>
        <input id="series-name" name="name" className="input" value={seriesName} required maxLength={manual && !direct ? 200 : 300} disabled={saving}
          onChange={(event) => { setSeriesName(event.target.value); if (manual) resetPreview(); }}/></div>}
      {manual && <>
        {direct && <div className="field"><label htmlFor="manual-author">저자</label><input id="manual-author" name="author" className="input" maxLength={300} disabled={saving}/></div>}
        <fieldset className="category-fieldset" style={target ? { display: "none" } : undefined} disabled={saving || Boolean(target)}><CategorySelect id="manual-category" categories={categories}/></fieldset>
        {target && <div className="field"><label htmlFor="inherited-category">카테고리</label><input id="inherited-category" className="input" value={target.type ?? "미분류"} readOnly/><span className="muted small">기존 책의 카테고리를 유지합니다.</span></div>}
        {direct && <>
        <div className="field"><label htmlFor="manual-total">총 권수</label><input id="manual-total" name="totalVolume" className="input" maxLength={30} disabled={saving}/></div>
        <div className="field span-2"><label htmlFor="manual-description">설명</label><textarea id="manual-description" name="description" className="textarea" maxLength={5000} disabled={saving}/></div>
        {!target && <>
          <div className="field"><label htmlFor="manual-cover-url">표지 URL</label><input id="manual-cover-url" name="coverUrl" className="input" type="url" maxLength={2048} disabled={saving}/></div>
          <div className="field"><label htmlFor="manual-cover-file">표지 파일</label><input id="manual-cover-file" name="coverFile" className="input file-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" disabled={saving}/><span className="muted small">최대 8MB. 파일이 URL보다 우선합니다.</span></div>
        </>}
        </>}
      </>}
      {error && !categoryOpen && <p className="flash flash-error span-2" role="alert">{error}</p>}
      {loading && <div className="span-2"><Spinner label="알라딘 검색 중"/></div>}
      {result && !direct && <div className="stack-md span-2" aria-busy={loading}>
        <div className="section-heading"><h2>{manual ? "추가 예정 도서" : "검색 결과"}</h2><span className="chip">{result.totalResults.toLocaleString("ko-KR")}건</span></div>
        <div className="button-row"><button className="button button-outline" type="button" disabled={loading || saving || !keys.length} onClick={() => toggle(keys, true)}>현재 페이지 모두 선택</button>
          <button className="button button-outline" type="button" disabled={loading || saving} onClick={() => toggle(keys, false)}>현재 페이지 모두 제외</button>
          <button className="button button-outline" type="button" disabled={saving} onClick={() => setSelection([])}>선택 초기화</button><span role="status">{selection.length}권 선택</span></div>
        <div className="search-results">{result.items.map((item, index) => {
          const key = item.isbn13 ?? item.isbn;
          const selected = selection.find((entry) => entry.page === result.page && entry.key === key);
          return <article className="search-result-card" key={`${key ?? item.title}-${index}`}>
            <div className="search-result-cover"><CoverImage cover={item.cover} alt={item.title} className="h-full w-full object-cover"/></div>
            <div className="stack-sm"><label className="check"><input type="checkbox" aria-label={`선택 ${item.title}`} disabled={!key || item.owned || loading || saving}
              checked={Boolean(selected)} onChange={(event) => key && toggle([key], event.target.checked)}/><strong>{item.title}</strong></label>
              <p className="muted small">{item.author ?? "저자 미상"} · {key ?? "ISBN 없음"}{item.pubDate && ` · 출간일 ${item.pubDate}`}</p>
              {item.owned ? <span className="chip">이미 등록됨</span> : selected && <span className="chip">{numbering.get(key!) == null ? "외전·특별판" : `${numbering.get(key!)}권으로 추가`}</span>}
              <label className="check"><input type="checkbox" aria-label={`외전 ${item.title}`} checked={Boolean(selected?.sideStory)} disabled={!selected || loading || saving}
                onChange={(event) => setSelection((previous) => previous.map((entry) => entry.key === key ? { ...entry, sideStory: event.target.checked } : entry))}/> 외전·특별판</label>
              {item.priceSales != null && <span>{formatWon(item.priceSales)}</span>}
              {item.description && <p className="muted search-description">{item.description}</p>}
            </div></article>;
        })}</div>
        {!result.items.length && <p className="empty">{target ? "기존 책에 추가할 알라딘 항목이 없습니다." : "검색 결과가 없습니다. 입력한 정보로 책만 추가할 수 있습니다."}</p>}
        <p className="muted small">출간일이 빠른 책부터 권차를 붙입니다. 출간일이 없으면 마지막에 배치하며, 외전은 정규 권차에서 제외합니다.</p>
        <div className={`aladin-results-footer${manual ? " aladin-results-footer-manual" : ""}`}>
        <nav className="button-row aladin-pagination" aria-label="알라딘 검색 페이지">
          <button type="button" className="button button-outline" aria-label="이전 페이지" disabled={loading || saving || result.page <= 1} onClick={() => loadPage(result.page - 1)}><span className="aladin-page-label">이전 페이지</span><span className="aladin-page-label-compact">이전</span></button>
          <span>{result.page} / {Math.max(1, totalPages)}</span>
          <button type="button" className="button button-outline" aria-label="다음 페이지" disabled={loading || saving || result.page >= totalPages} onClick={() => loadPage(result.page + 1)}><span className="aladin-page-label">다음 페이지</span><span className="aladin-page-label-compact">다음</span></button>
        </nav>
        {!manual && <div className="aladin-import-action">{submitButton}</div>}
        </div>
      </div>}
      {manual && <div className="button-row span-2 manual-book-actions">{submitButton}
        {manual && result && !direct && <button className="button button-outline" type="button" disabled={saving || loading} onClick={() => { resetPreview(); void loadPage(1); }}>다시 검색</button>}
      </div>}
      {!manual && <NewBookCategoryDialog open={categoryOpen} onClose={() => setCategoryOpen(false)} categories={categories} count={selection.length} saving={saving} error={error}/>}
    </form>
    </div>
  </section>;
}
