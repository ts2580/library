import type { AladinSearchOptions } from "@/features/aladin/validation";

export function AladinSearchFilters({ options, page }: { options: AladinSearchOptions; page: number }) {
  return <details className="details-card" style={{ gridColumn: "1 / -1" }}>
    <summary>상세 검색 조건</summary>
    <div className="details-body form-grid">
      <label className="field">검색 기준<select className="select" name="queryType" defaultValue={options.queryType}>
        <option value="Title">제목</option><option value="Keyword">제목+저자</option><option value="Author">작가</option><option value="Publisher">출판사</option>
      </select></label>
      <label className="field">검색 대상<select className="select" name="searchTarget" defaultValue={options.searchTarget}>
        <option value="Book">도서</option><option value="Foreign">외국도서</option><option value="Music">음반</option><option value="DVD">DVD</option><option value="Used">중고샵</option><option value="eBook">전자책</option><option value="All">전체</option>
      </select></label>
      <label className="field">정렬<select className="select" name="sort" defaultValue={options.sort}>
        <option value="PublishTime">출간일</option><option value="Accuracy">관련도</option><option value="Title">제목</option><option value="SalesPoint">판매량</option><option value="CustomerRating">고객평점</option><option value="MyReviewCount">리뷰수</option>
      </select></label>
      <label className="field">출간 범위<select className="select" name="recentPublishFilter" defaultValue={options.recentPublishFilter}>
        {[0, 1, 3, 6, 12, 24, 60].map((months) => <option key={months} value={months}>{months ? `${months}개월` : "전체"}</option>)}
      </select></label>
      <label className="field">결과 수<input className="input" name="maxResults" type="number" min={1} max={100} defaultValue={options.maxResults}/></label>
      <label className="field">시작 페이지<input className="input" name="page" type="number" min={1} max={50} defaultValue={page}/></label>
      <label className="field">카테고리 ID<input className="input" name="categoryId" type="number" min={1} defaultValue={options.categoryId ?? ""}/></label>
      <label className="field">표지 크기<select className="select" name="cover" defaultValue={options.cover}>
        {["Big", "MidBig", "Mid", "Small", "Mini", "None"].map((size) => <option key={size}>{size}</option>)}
      </select></label>
      <label className="check"><input type="checkbox" name="outOfStockFilter" value="true" defaultChecked={options.outOfStockFilter}/> 품절 제외</label>
    </div>
  </details>;
}
