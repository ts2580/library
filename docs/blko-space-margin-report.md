# design-tokens Spacing: space / margin tokens 사용 리포트

- 생성 시각: 2026-04-02 23:42:16
- 대상 경로: `src/main/resources/templates/**/*.html`, `src/main/resources/static/js/**/*.js`
- 기준 토큰: `blko-space-y-*`, `blko-mt-*`, `blko-mb-*` (+ responsive variants)

## 개요
- 전체 사용 토큰 수: **19**개
- 정의된 토큰 수: **23**개
- 미사용 토큰: **4**개
- 미정의 사용 토큰: **0**개

## 사용량 합계(카테고리)
|카테고리|총 사용 빈도|
|---|---:|
|mb|36|
|mt|104|
|space-y|12|

## Base tokens 상세
|카테고리|토큰|사용 빈도|사용 파일(횟수)|비고|
|---|---|---:|---|---|
|mb|`blko-mb-1`|6|dialogs.html:6||
|mb|`blko-mb-2`|9|aladin_search.html:1; login_form.html:2; signup_form.html:6||
|mb|`blko-mb-3`|2|aladin_search.html:1; aladin_used_search.html:1||
|mb|`blko-mb-4`|14|aladin_search.html:1; aladin_used_search.html:2; book_detail.html:1; branch_inventory_dashboard.html:3; branch_stock_list.html:1; product.html:6||
|mb|`blko-mb-5`|3|login_form.html:2; signup_form.html:1||
|mb|`blko-mb-8`|2|login_form.html:1; signup_form.html:1||
|mt|`blko-mt-1`|34|aladin_search.html:2; aladin_used_search.html:1; book_detail.html:1; branch_inventory_dashboard.html:15; branch_stock_list.html:6; dashboard.html:4; dialogs.html:1; layout.html:1; product-search.js:1; product.html:2||
|mt|`blko-mt-2`|26|aladin_used_search.html:3; book_detail.html:1; book_list.html:1; branch_inventory_dashboard.html:3; branch_stock_list.html:3; dashboard.html:7; layout.html:1; login_form.html:1; product-search.js:2; product.html:3; signup_form.html:1||
|mt|`blko-mt-3`|18|aladin_search.html:3; aladin_used_search.html:2; book_detail.html:3; book_list.html:1; branch_inventory_dashboard.html:1; branch_stock_list.html:2; home.html:1; layout.html:1; login_form.html:1; product.html:2; signup_form.html:1||
|mt|`blko-mt-4`|12|book_detail.html:4; branch_inventory_dashboard.html:3; branch_stock_list.html:1; product.html:3; product_search.html:1||
|mt|`blko-mt-5`|2|login_form.html:1; signup_form.html:1||
|mt|`blko-mt-6`|9|dashboard.html:3; home.html:4; login_form.html:1; signup_form.html:1||
|space-y|`blko-space-y-1`|1|book_detail.html:1||
|space-y|`blko-space-y-1-5`|1|book_list.html:1||
|space-y|`blko-space-y-2`|1|book_detail.html:1||
|space-y|`blko-space-y-3`|1|layout.html:1||
|space-y|`blko-space-y-4`|8|aladin_search.html:1; aladin_used_search.html:1; login_form.html:3; product.html:1; signup_form.html:2||

## Responsive tokens 상세
|카테고리|토큰|사용 빈도|사용 파일(횟수)|비고|
|---|---|---:|---|---|
|mt|`sm:blko-mt-1`|0|-|반응형 sm / 미사용(정의만 존재)|
|mt|`sm:blko-mt-2`|0|-|반응형 sm / 미사용(정의만 존재)|
|mt|`sm:blko-mt-3`|0|-|반응형 sm / 미사용(정의만 존재)|
|mt|`sm:blko-mt-4`|2|book_detail.html:1; book_list.html:1|반응형 sm|
|mt|`sm:blko-mt-5`|1|book_detail.html:1|반응형 sm|
|mt|`sm:blko-mt-6`|0|-|반응형 sm / 미사용(정의만 존재)|

## 미사용 토큰(정의만 존재)
|토큰|상태|
|---|---|
|`sm:blko-mt-1`|미사용(정의만 존재)|
|`sm:blko-mt-2`|미사용(정의만 존재)|
|`sm:blko-mt-3`|미사용(정의만 존재)|
|`sm:blko-mt-6`|미사용(정의만 존재)|

## Notes
- raw spacing/title 관련 Tailwind class(`mt-*`, `mb-*`, `gap-*`, `space-*`, `px-*`, `py-*`) 잔존은 사전 스캔으로 정리됨.