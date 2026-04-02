# design-tokens Typography: title / subtitle tokens 사용 리포트

- 생성 시각: 2026-04-02 23:41:42
- 대상 경로: `src/main/resources/templates/**/*.html`, `src/main/resources/static/js/**/*.js`
- 기준 토큰: `blko-title-*`, `blko-subtitle-*`

## 개요
- 전체 사용 토큰 수: **10**개
- 정의된 토큰 수: **10**개
- 미사용 토큰: **0**개
- 미정의 사용 토큰: **0**개

## 사용량 합계(카테고리)
|카테고리|총 사용 빈도|
|---|---:|
|subtitle|51|
|title|59|

## Base tokens 상세
|카테고리|토큰|사용 빈도|사용 파일(횟수)|비고|
|---|---|---:|---|---|
|subtitle|`blko-subtitle-sm`|39|aladin_search.html:2; aladin_used_search.html:1; book_detail.html:3; book_list.html:2; branch_inventory_dashboard.html:7; branch_stock_list.html:4; dashboard.html:7; dialogs.html:1; home.html:1; layout.html:2; login_form.html:3; product.html:4; signup_form.html:2||
|subtitle|`blko-subtitle-xs`|12|aladin_search.html:2; aladin_used_search.html:1; book_detail.html:2; book_list.html:1; branch_inventory_dashboard.html:2; branch_stock_list.html:1; layout.html:1; product.html:2||
|title|`blko-title-2xl`|10|branch_inventory_dashboard.html:3; branch_stock_list.html:3; dashboard.html:1; login_form.html:2; signup_form.html:1||
|title|`blko-title-base`|13|aladin_search.html:1; aladin_used_search.html:4; book_list.html:1; branch_inventory_dashboard.html:4; branch_stock_list.html:1; product.html:2||
|title|`blko-title-hero`|3|home.html:1; login_form.html:1; signup_form.html:1||
|title|`blko-title-lg`|18|aladin_search.html:1; aladin_used_search.html:1; book_list.html:1; branch_inventory_dashboard.html:7; dashboard.html:3; dialogs.html:2; layout.html:1; product.html:2||
|title|`blko-title-page`|1|layout.html:1||
|title|`blko-title-responsive-xl`|1|book_detail.html:1||
|title|`blko-title-sm`|6|aladin_search.html:1; aladin_used_search.html:1; book_detail.html:1; branch_inventory_dashboard.html:1; layout.html:1; product.html:1||
|title|`blko-title-xl`|7|book_detail.html:1; branch_stock_list.html:1; dashboard.html:3; product.html:2||

## Notes
- raw spacing/title 관련 Tailwind class(`mt-*`, `mb-*`, `gap-*`, `space-*`, `px-*`, `py-*`) 잔존은 사전 스캔으로 정리됨.