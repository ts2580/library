"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchForm } from "@/components/ui/search-form";
import { AladinSelection } from "@/components/books/aladin-selection";
import { ExistingBookSelect } from "@/components/books/existing-book-select";
import { ProgressIndicator } from "@/components/ui/top-progress";
import type { BookOption } from "@/features/books/types";
import type { AladinSearchResult } from "@/features/aladin/types";
import type { AladinSearchOptions } from "@/features/aladin/validation";

export function AladinSearchPanel({ query, result, searchOptions, options, selectedBookId, categories, children }: {
  query: string; result: AladinSearchResult | null; searchOptions: AladinSearchOptions;
  options: BookOption[]; selectedBookId: number | null;
  categories: string[];
  children?: ReactNode;
}) {
  const [target, setTarget] = useState(options.find((book) => book.id === selectedBookId) ?? null);
  const [resetVersion, setResetVersion] = useState(0);
  const [keyword, setKeyword] = useState(query);
  const [queryType, setQueryType] = useState(searchOptions.queryType);
  const [searching, startSearch] = useTransition();
  const searchForm = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => { setKeyword(query); setQueryType(searchOptions.queryType); }, [query, searchOptions.queryType]);

  function selectTarget(book: BookOption | null) {
    setTarget(book);
    if (!book) return;
    const title = book.name.trim().slice(0, 200);
    setKeyword(title); setQueryType("Title");
    if (result?.items.length || !searchForm.current) return;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(searchForm.current)) if (typeof value === "string") params.append(key, value);
    params.set("queryType", "Title"); params.set("query", title); params.set("bookId", String(book.id));
    startSearch(() => router.push(`/aladin/search?${params}`, { scroll: false }));
  }
  return <>
    <header className="page-header aladin-page-header">
      <div><p className="eyebrow">Aladin API</p><h1 className="page-title">알라딘 도서 검색</h1><p className="page-subtitle">여러 페이지에서 선택한 권을 새 책이나 기존 책에 한 번에 등록합니다.</p><Link className="text-link small" href="/aladin/used">ISBN 재고 조회</Link></div>
      <div className="aladin-target-select"><ExistingBookSelect key={resetVersion} initialOptions={options} selected={target} onChange={selectTarget} disabled={searching} showNewBookButton={false}/></div>
    </header>
    {children}
    <section className="panel panel-soft stack-md">
    <SearchForm key={`${query}:${JSON.stringify(searchOptions)}:${resetVersion}`} formRef={searchForm} className="aladin-search-form" action="/aladin/search">
      <div className="field"><label htmlFor="aladin-query-type">검색 기준</label><select className="select" id="aladin-query-type" name="queryType" value={queryType} onChange={event => setQueryType(event.target.value as AladinSearchOptions["queryType"])} disabled={searching}>
        <option value="Title">제목</option><option value="Author">저자</option><option value="Keyword">키워드</option><option value="Publisher">출판사</option>
      </select></div>
      <div className="field"><label htmlFor="aladin-query">검색어</label><input className="input" id="aladin-query" name="query" value={keyword} onChange={event => setKeyword(event.target.value)} disabled={searching} maxLength={200} placeholder="제목 또는 저자 검색" required/></div>
      {target && <input type="hidden" name="bookId" value={target.id}/>}
      <div className="button-row"><button className="button" type="submit" disabled={searching}>검색</button><Link className="button button-outline" href="/aladin/search" onClick={() => { setTarget(null); setKeyword(""); setQueryType("Title"); setResetVersion((previous) => previous + 1); }}>초기화</Link></div>
      <details className="details-card aladin-search-options"><summary>검색 조건</summary><fieldset className="details-body form-grid" disabled={searching}>
        <div className="field"><label htmlFor="aladin-target">검색 대상</label><select id="aladin-target" name="searchTarget" className="select" defaultValue={searchOptions.searchTarget}>
          {Object.entries({ Book: "국내 도서", Foreign: "외국 도서", Music: "음반", DVD: "DVD", Used: "중고", eBook: "전자책", All: "전체" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></div>
        <div className="field"><label htmlFor="aladin-sort">정렬</label><select id="aladin-sort" name="sort" className="select" defaultValue={searchOptions.sort}>
          {Object.entries({ PublishTime: "출간일", Accuracy: "정확도", Title: "제목", SalesPoint: "판매량", CustomerRating: "평점", MyReviewCount: "리뷰 수" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></div>
        <div className="field"><label htmlFor="aladin-limit">페이지당 결과</label><input id="aladin-limit" name="maxResults" className="input" type="number" min={1} max={100} defaultValue={searchOptions.maxResults}/></div>
        <div className="field"><label htmlFor="aladin-recent">최근 출간 개월 (0: 전체)</label><input id="aladin-recent" name="recentPublishFilter" className="input" type="number" min={0} max={60} defaultValue={searchOptions.recentPublishFilter}/></div>
        <div className="field"><label htmlFor="aladin-category">알라딘 카테고리 ID</label><input id="aladin-category" name="categoryId" className="input" type="number" min={1} defaultValue={searchOptions.categoryId ?? ""}/></div>
        <div className="field"><label htmlFor="aladin-cover">표지 크기</label><select id="aladin-cover" name="cover" className="select" defaultValue={searchOptions.cover}>
          {Object.entries({ Big: "크게", MidBig: "중간 크게", Mid: "중간", Small: "작게", Mini: "아주 작게", None: "없음" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></div>
        <label className="check"><input type="checkbox" name="outOfStockFilter" defaultChecked={searchOptions.outOfStockFilter}/>품절 도서 제외</label>
      </fieldset></details>
    </SearchForm>
    {searching && <ProgressIndicator label="알라딘 검색 중"/>}
    </section>
    {result && <AladinSelection key={`${query}:${JSON.stringify(searchOptions)}:${result.page}:${resetVersion}`} query={query} initial={result} searchOptions={searchOptions}
      initialOptions={options} selectedBookId={selectedBookId} selectedTarget={target} onTargetChange={setTarget} showTargetPicker={false} categories={categories}/>}
  </>;
}
