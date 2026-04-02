# design-tokens gap/p/px/py 사용 리포트

- 생성 시각: 2026-04-02 23:38:43
- 대상 경로: `src/main/resources/templates/**/*.html`, `src/main/resources/static/js/**/*.js`
- 기준 토큰: `blko-gap-*`, `blko-p-*`, `blko-px-*`, `blko-py-*` (+ responsive variants)

## 개요

- 전체 사용 토큰 수: **34**개
- 정의된 토큰 수: **34**개
- 미사용 토큰: **0**개
- 미정의 사용 토큰: **0**개

## 사용량 합계(카테고리)

|카테고리|총 사용 빈도|
|---|---:|
|gap|2|
|p|93|
|px|112|
|py|94|

## Base tokens 상세

|카테고리|토큰|사용 빈도|사용 파일(횟수)|비고|
|---|---|---:|---|---|
|gap|`blko-gap-1-5`|1|product-search.js:1||
|gap|`blko-gap-3`|1|product-search.js:1||
|p|`blko-p-0`|2|dialogs.html:2||
|p|`blko-p-2`|27|aladin_search.html:2; aladin_used_search.html:3; book_detail.html:3; book_list.html:1; branch_inventory_dashboard.html:2; branch_stock_list.html:1; dialogs.html:3; product.html:10; home.html:1; product_search.html:1||
|p|`blko-p-3`|12|aladin_search.html:1; aladin_used_search.html:3; branch_inventory_dashboard.html:4; branch_stock_list.html:1; layout.html:1; product.html:2||
|p|`blko-p-4`|20|aladin_search.html:2; aladin_used_search.html:1; book_detail.html:1; book_list.html:1; branch_inventory_dashboard.html:1; branch_stock_list.html:1; dashboard.html:2; dialogs.html:6; layout.html:1; product.html:3; signup_form.html:1||
|p|`blko-p-5`|1|book_detail.html:1||
|p|`blko-p-6`|4|layout.html:1; product.html:2; product_search.html:1||
|p|`blko-p-7`|1|home.html:1||
|px|`blko-px-2`|4|product-search.js:4||
|px|`blko-px-2-5`|1|branch_stock_list.html:1||
|px|`blko-px-3`|20|product-search.js:2; aladin_used_search.html:2; branch_inventory_dashboard.html:1; dialogs.html:2; product.html:13||
|px|`blko-px-4`|65|aladin_search.html:3; aladin_used_search.html:4; book_detail.html:3; book_list.html:1; branch_inventory_dashboard.html:11; branch_stock_list.html:1; dashboard.html:3; dialogs.html:16; layout.html:1; product.html:4; home.html:3; login_form.html:7; signup_form.html:8||
|px|`blko-px-5`|9|dialogs.html:6; home.html:1; login_form.html:1; signup_form.html:1||
|px|`blko-px-6`|2|login_form.html:1; signup_form.html:1||
|py|`blko-py-0-5`|1|product-search.js:1||
|py|`blko-py-1`|5|product-search.js:3; branch_inventory_dashboard.html:1; branch_stock_list.html:1||
|py|`blko-py-1-5`|8|product.html:8||
|py|`blko-py-10`|4|branch_stock_list.html:1; home.html:1; login_form.html:1; signup_form.html:1||
|py|`blko-py-2`|28|aladin_search.html:1; aladin_used_search.html:5; book_detail.html:3; branch_inventory_dashboard.html:2; branch_stock_list.html:1; dashboard.html:3; dialogs.html:6; product.html:7||
|py|`blko-py-3`|27|product-search.js:2; branch_inventory_dashboard.html:8; dialogs.html:12; layout.html:1; home.html:3; signup_form.html:1||
|py|`blko-py-4`|6|aladin_search.html:1; aladin_used_search.html:1; dialogs.html:4||
|py|`blko-py-5`|3|branch_inventory_dashboard.html:1; dialogs.html:2||
|py|`blko-py-7`|2|login_form.html:1; signup_form.html:1||
|py|`blko-py-8`|8|aladin_search.html:1; aladin_used_search.html:1; book_detail.html:1; book_list.html:1; branch_inventory_dashboard.html:1; branch_stock_list.html:1; dashboard.html:1; product_search.html:1||

## Responsive tokens 상세

|카테고리|토큰|사용 빈도|사용 파일(횟수)|비고|
|---|---|---:|---|---|
|p|`md:blko-p-4`|1|product.html:1|반응형 md|
|p|`sm:blko-p-4`|4|book_detail.html:1; book_list.html:2; branch_stock_list.html:1|반응형 sm|
|p|`sm:blko-p-5`|6|aladin_search.html:3; aladin_used_search.html:2; branch_inventory_dashboard.html:1|반응형 sm|
|p|`sm:blko-p-6`|11|book_detail.html:3; branch_inventory_dashboard.html:3; branch_stock_list.html:1; layout.html:1; product.html:2; signup_form.html:1|반응형 sm|
|p|`sm:blko-p-8`|3|layout.html:1; product.html:2|반응형 sm|
|p|`sm:blko-p-9`|1|home.html:1|반응형 sm|
|px|`sm:blko-px-6`|6|dialogs.html:6|반응형 sm|
|px|`sm:blko-px-8`|5|home.html:1; login_form.html:2; signup_form.html:2|반응형 sm|
|py|`sm:blko-py-9`|2|login_form.html:1; signup_form.html:1|반응형 sm|

## Notes
- raw tailwind class(`mt-*`, `mb-*`, `gap-*`, `px-*`, `py-*`) 잔존 점검: **없음**
- 반응형 variant(`sm:`, `md:`)는 사용분만 유지/정의 기준으로 정리됨
- 사용 파일 수는 파일 단위 누적 + 중복 횟수 기준
