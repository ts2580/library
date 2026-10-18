"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { SearchForm } from "@/components/ui/search-form";
import { AladinSelection } from "@/components/books/aladin-selection";
import { ExistingBookSelect } from "@/components/books/existing-book-select";
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
  return <>
    <header className="page-header aladin-page-header">
      <div><p className="eyebrow">Aladin API</p><h1 className="page-title">알라딘 도서 검색</h1><p className="page-subtitle">여러 페이지에서 선택한 권을 새 책이나 기존 책에 한 번에 등록합니다.</p></div>
      <div className="aladin-target-select"><ExistingBookSelect key={resetVersion} initialOptions={options} selected={target} onChange={setTarget} showNewBookButton={false}/></div>
    </header>
    {children}
    <section className="panel panel-soft stack-md">
    <SearchForm key={`${query}:${searchOptions.queryType}:${resetVersion}`} className="aladin-search-form" action="/aladin/search">
      <div className="field"><label htmlFor="aladin-query-type">검색 기준</label><select className="select" id="aladin-query-type" name="queryType" defaultValue={searchOptions.queryType}>
        <option value="Title">제목</option><option value="Author">저자</option>
      </select></div>
      <div className="field"><label htmlFor="aladin-query">검색어</label><input className="input" id="aladin-query" name="query" defaultValue={query} maxLength={200} placeholder="제목 또는 저자 검색" required/></div>
      {target && <input type="hidden" name="bookId" value={target.id}/>}
      <div className="button-row"><button className="button" type="submit">검색</button><Link className="button button-outline" href="/aladin/search" onClick={() => { setTarget(null); setResetVersion((previous) => previous + 1); }}>초기화</Link></div>
    </SearchForm>
    </section>
    {result && <AladinSelection key={`${query}:${searchOptions.queryType}:${result.page}:${resetVersion}`} query={query} initial={result} searchOptions={searchOptions}
      initialOptions={options} selectedBookId={selectedBookId} selectedTarget={target} onTargetChange={setTarget} showTargetPicker={false} categories={categories}/>}
  </>;
}
