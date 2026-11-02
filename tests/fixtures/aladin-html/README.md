# 알라딘 공개 HTML 표본

2026-11-02 읽기 전용 요청에서 추출. 내비게이션·스크립트·이벤트 핸들러를 제거하고 검색 요약/폼/상품 블록, 상품 메타, 중고 목록/페이지 폼, 지점 재고 블록만 보존했다. 인증키·쿠키를 사용하지 않았다. 래퍼 HTML과 검색 요약 문단은 테스트용이며 내부 상품·가격·매장 마크업은 수집본이다.

- search: `/search/wsearchresult.aspx?SearchTarget=Book&SearchWord=해리 포터`
- title: `/search/wsearchresult.aspx?SearchTarget=Book&KeyTitle=해리 포터&SortOrder=5&ViewRowCount=20&page=2`
- empty: 같은 검색 경로, `SearchWord=qqzbookshelfunknown9918273`
- isbn10: 같은 검색 경로, `SearchTarget=All&SearchWord=059035342X`
- used: 같은 검색 경로, `SearchTarget=UsedStore&SearchWord=9780590353403`
- product: `/shop/wproduct.aspx?ItemId=208556`
- positive: `/shop/UsedShop/wuseditemall.aspx?ItemId=40869703&TabType=2&Fix=1`
- direct: 동일 경로, `ItemId=208556&TabType=2&Fix=1` (명시적 0)
- allstores: 동일 경로, `ItemId=208556&TabType=3&Fix=1` (탭 29건, 구매 가능한 행 15건: 전체 매장 재고 소스로 사용 금지)
- branch: `/usedstore/wproduct.aspx?ItemId=208556&OffCode=Geondae`

2026-11-02 23:53~23:57 KST 전체 중고 표본 추가. `unified`: ItemId=378768331, TabType=0, Fix=1(11행 중 우주점 5, 판매자 6). `unified-first`/`unified-last`: ItemId=208556, TabType=0, Fix=1의 1/12페이지(20/11행). 탭 합계 244와 목록 231행이 다를 수 있으므로 표시 부수와 온라인 판매 행을 동일시하지 않는다. 기존 allstores 표본은 방문 구매 재고 소스로 부적합하다는 과거 판단의 근거이며, 현재 수집 범위는 사용자 요청에 따른 온라인 목록이다.
