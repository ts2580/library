# design-tokens Color / Shadow tokens 사용 리포트

- 생성 시각: 2026-04-02 23:46:47
- 대상 경로: `src/main/resources/templates/**/*.html`, `src/main/resources/static/js/**/*.js`
- 기준 토큰: 색상/그림자 계열 컴포넌트 토큰 (`blko-alert-*`, `blko-btn-*`, `blko-badge*`, `blko-chip*`, `blko-card`, `blko-panel`, `blko-kpi`, `blko-toast`, `blko-sidebar`, `blko-table`, `blko-pagination` 등)

## 개요
- 전체 사용 토큰 수: **46**개
- 정의된 토큰 수: **46**개
- 미사용 토큰: **0**개
- 미정의 사용 토큰: **0**개

## 사용량 합계(카테고리)
|카테고리|총 사용 빈도|
|---|---:|
|alert|7|
|auth|3|
|badge|4|
|btn|57|
|card|23|
|chip|29|
|cover|3|
|label|24|
|empty|8|
|other|9|
|interaction|11|
|form-control|30|
|json|2|
|kpi|19|
|link|3|
|mobile|7|
|pagination|15|
|panel|11|
|product|2|
|layout|9|
|sidebar|22|
|table|2|
|toast|6|

## Base tokens 상세
|카테고리|토큰|사용 빈도|사용 파일(횟수)|비고|
|---|---|---:|---|---|
|alert|`blko-alert-error`|2|layout.html:1; login_form.html:1||
|alert|`blko-alert-info`|3|home.html:1; login_form.html:1; signup_form.html:1||
|alert|`blko-alert-success`|2|home.html:1; layout.html:1||
|auth|`blko-auth-card`|3|home.html:1; login_form.html:1; signup_form.html:1||
|badge|`blko-badge`|4|aladin_search.html:1; aladin_used_search.html:1; book_detail.html:1; layout.html:1||
|btn|`blko-btn`|10|aladin_search.html:1; branch_inventory_dashboard.html:1; dialogs.html:2; home.html:1; login_form.html:1; product.html:3; signup_form.html:1||
|btn|`blko-btn-danger`|3|book_detail.html:2; branch_inventory_dashboard.html:1||
|btn|`blko-btn-ghost`|32|aladin_used_search.html:3; book_detail.html:1; book_list.html:5; branch_stock_list.html:1; dialogs.html:4; home.html:1; layout.html:1; login_form.html:2; product.html:13; signup_form.html:1||
|btn|`blko-btn-soft`|12|aladin_used_search.html:2; book_list.html:1; branch_stock_list.html:1; dashboard.html:3; home.html:1; product.html:4||
|card|`blko-card`|23|aladin_search.html:3; aladin_used_search.html:3; book_detail.html:2; book_list.html:2; branch_inventory_dashboard.html:3; branch_stock_list.html:1; dashboard.html:3; dialogs.html:2; product.html:2; product_search.html:1; signup_form.html:1||
|chip|`blko-chip`|15|aladin_search.html:4; aladin_used_search.html:4; book_detail.html:1; book_list.html:1; branch_inventory_dashboard.html:1; branch_stock_list.html:2; product.html:2||
|chip|`blko-chip-tag`|11|aladin_search.html:3; aladin_used_search.html:3; book_list.html:1; branch_stock_list.html:2; product.html:2||
|chip|`blko-chip-tag-lg`|3|aladin_search.html:1; aladin_used_search.html:1; book_detail.html:1||
|cover|`blko-cover-placeholder`|3|aladin_search.html:1; product.html:2||
|label|`blko-detail-label`|11|book_detail.html:4; dialogs.html:7||
|empty|`blko-empty`|4|book_list.html:1; layout.html:1; product.html:2||
|empty|`blko-empty-cover`|4|book_detail.html:2; book_list.html:1; branch_stock_list.html:1||
|other|`blko-form-label`|9|aladin_search.html:1; login_form.html:2; signup_form.html:6||
|interaction|`blko-hover-lift`|11|aladin_search.html:1; aladin_used_search.html:1; book_detail.html:1; book_list.html:1; branch_inventory_dashboard.html:1; branch_stock_list.html:1; dashboard.html:3; product.html:2||
|form-control|`blko-input`|26|aladin_search.html:1; dialogs.html:11; login_form.html:4; product.html:5; signup_form.html:5||
|json|`blko-json`|2|aladin_search.html:1; aladin_used_search.html:1||
|kpi|`blko-kpi`|19|aladin_used_search.html:3; branch_inventory_dashboard.html:9; branch_stock_list.html:3; dashboard.html:4||
|label|`blko-kpi-label`|13|aladin_used_search.html:3; branch_inventory_dashboard.html:3; branch_stock_list.html:3; dashboard.html:4||
|link|`blko-link`|3|branch_inventory_dashboard.html:1; home.html:1; product.html:1||
|mobile|`blko-mobile-menu-btn`|1|layout.html:1||
|mobile|`blko-mobile-nav`|1|layout.html:1||
|mobile|`blko-mobile-nav__item`|5|layout.html:5||
|pagination|`blko-pagination`|3|book_list.html:1; product.html:2||
|pagination|`blko-pagination__nav`|8|book_list.html:4; product.html:4||
|pagination|`blko-pagination__page`|4|book_list.html:1; product.html:3||
|panel|`blko-panel`|11|aladin_search.html:1; aladin_used_search.html:1; book_detail.html:1; branch_inventory_dashboard.html:2; branch_stock_list.html:1; layout.html:2; product-search.js:1; product.html:2||
|product|`blko-product-tab`|2|product_search.html:2||
|form-control|`blko-select`|2|book_list.html:1; product.html:1||
|layout|`blko-shell`|9|aladin_search.html:1; aladin_used_search.html:1; book_detail.html:1; book_list.html:1; branch_inventory_dashboard.html:1; branch_stock_list.html:1; dashboard.html:1; home.html:1; product_search.html:1||
|sidebar|`blko-sidebar`|4|layout.html:4||
|sidebar|`blko-sidebar-open`|8|layout.html:8||
|sidebar|`blko-sidebar__brand`|1|layout.html:1||
|sidebar|`blko-sidebar__icon`|4|layout.html:4||
|sidebar|`blko-sidebar__link`|4|layout.html:4||
|sidebar|`blko-sidebar__logo`|1|layout.html:1||
|table|`blko-table`|1|branch_inventory_dashboard.html:1||
|table|`blko-table-wrap`|1|branch_inventory_dashboard.html:1||
|form-control|`blko-textarea`|2|dialogs.html:1; signup_form.html:1||
|toast|`blko-toast`|2|book-detail.js:1; layout.html:1||
|toast|`blko-toast-error`|2|book-detail.js:1; layout.html:1||
|toast|`blko-toast-success`|2|book-detail.js:1; layout.html:1||

## Notes
- 본 리포트는 `background`, `color`, `border`, `box-shadow` 등 색/입체감을 다루는 속성이 있는 컴포넌트 토큰만 대상으로 정렬
- raw spacing/title 관련 Tailwind class(`mt-*`, `mb-*`, `gap-*`, `space-*`, `px-*`, `py-*`) 잔존은 사전 스캔으로 정리됨.