# design-tokens Button / Form-Control tokens 사용 리포트

- 생성 시각: 2026-04-02 23:46:47
- 대상 경로: `src/main/resources/templates/**/*.html`, `src/main/resources/static/js/**/*.js`
- 기준 토큰: `blko-btn-*`, `blko-form-label`, `blko-detail-label`, `blko-input`, `blko-textarea`, `blko-select`

## 개요
- 전체 사용 토큰 수: **12**개
- 정의된 토큰 수: **12**개
- 미사용 토큰: **0**개
- 미정의 사용 토큰: **0**개

## 사용량 합계(카테고리)
|카테고리|총 사용 빈도|
|---|---:|
|btn|91|
|label|20|
|form-control|30|

## Base tokens 상세
|카테고리|토큰|사용 빈도|사용 파일(횟수)|비고|
|---|---|---:|---|---|
|btn|`blko-btn`|10|aladin_search.html:1; branch_inventory_dashboard.html:1; dialogs.html:2; home.html:1; login_form.html:1; product.html:3; signup_form.html:1||
|btn|`blko-btn-danger`|3|book_detail.html:2; branch_inventory_dashboard.html:1||
|btn|`blko-btn-ghost`|32|aladin_used_search.html:3; book_detail.html:1; book_list.html:5; branch_stock_list.html:1; dialogs.html:4; home.html:1; layout.html:1; login_form.html:2; product.html:13; signup_form.html:1||
|btn|`blko-btn-size-lg`|3|login_form.html:2; signup_form.html:1||
|btn|`blko-btn-size-sm`|27|aladin_search.html:1; aladin_used_search.html:3; book_detail.html:3; branch_inventory_dashboard.html:2; branch_stock_list.html:1; dashboard.html:3; dialogs.html:6; home.html:3; layout.html:1; login_form.html:1; product.html:2; signup_form.html:1||
|btn|`blko-btn-size-xs`|4|aladin_used_search.html:2; branch_stock_list.html:1; product.html:1||
|btn|`blko-btn-soft`|12|aladin_used_search.html:2; book_list.html:1; branch_stock_list.html:1; dashboard.html:3; home.html:1; product.html:4||
|label|`blko-detail-label`|11|book_detail.html:4; dialogs.html:7||
|label|`blko-form-label`|9|aladin_search.html:1; login_form.html:2; signup_form.html:6||
|form-control|`blko-input`|26|aladin_search.html:1; dialogs.html:11; login_form.html:4; product.html:5; signup_form.html:5||
|form-control|`blko-select`|2|book_list.html:1; product.html:1||
|form-control|`blko-textarea`|2|dialogs.html:1; signup_form.html:1||

## Notes
- raw spacing/title 관련 Tailwind class(`mt-*`, `mb-*`, `gap-*`, `space-*`, `px-*`, `py-*`) 잔존은 사전 스캔으로 정리됨.