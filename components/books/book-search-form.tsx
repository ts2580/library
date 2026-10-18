"use client";

import { useState } from "react";
import Link from "next/link";
import { SearchForm } from "@/components/ui/search-form";

export function BookSearchForm({ categories, initialField, initialQuery, type }: {
  categories: string[];
  initialField: "title" | "author";
  initialQuery: string;
  type: string;
}) {
  const [field, setField] = useState(initialField);
  const [keyword, setKeyword] = useState(initialQuery);
  const [category, setCategory] = useState(type);

  return <SearchForm className="books-search-form" action="/books">
    <div className="field"><label htmlFor="books-type">분류</label><select className="select" id="books-type" name="type" value={category} onChange={(event) => setCategory(event.target.value)}>
      <option value="">전체</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}
    </select></div>
    <div className="field"><label htmlFor="books-search-field">검색 기준</label><select className="select" id="books-search-field" value={field} onChange={(event) => setField(event.target.value === "author" ? "author" : "title")}>
      <option value="title">제목</option><option value="author">저자</option>
    </select></div>
    <div className="field"><label htmlFor="books-query">검색어</label><input className="input" id="books-query" name={field} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={field === "title" ? "제목 검색" : "저자 검색"}/></div>
    <div className="button-row"><button className="button" type="submit">검색</button><Link className="button button-outline" href="/books" onClick={() => { setField("title"); setKeyword(""); setCategory(""); }}>초기화</Link></div>
  </SearchForm>;
}
