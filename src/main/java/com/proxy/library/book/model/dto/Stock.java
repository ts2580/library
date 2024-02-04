package com.proxy.library.book.model.dto;

import java.util.ArrayList;

public class Stock {

    // 정확히 말해 DTO는 아니고...Wrapper임...
    public class Output {
        public String  version;                     // API Version
        public String  title;                       // API 결과의 제목, 책 제목은 아님
        public String  link;                        // 새 책 링크
        public String  pubDate;                     // API 실행일
        public Integer totalResults;                // API의 총 결과수
        public Integer startIndex;                  // Page수
        public Integer itemsPerPage;                // 한 페이지에 출력될 상품 수
        public String  query;                       // API로 조회한 쿼리
        public Integer searchCategoryId;            // 분야로 조회한 경우 해당 분야의 ID
        public String  searchCategoryName;          // 분야로 조회한 경우 해당 분야의 분야명
        public ArrayList<Item> item;                     // 상품정보
    }

    public class Item {
        public String  title;                       // 상품명
        public String  link;                        // 상품 링크 URL(새책)
        public String  author;                      // 작가
        public String  pubDate;                     // 출간일
        public String  description;                 // 상품설명 (요약)
        public String  isbn;                        // 10자리 ISBN
        public String  isbn13;                      // 13자리 ISBN
        public Integer itemId;                      // 상품을 구분짓는 Key, 알라딘 내에서 사용
        public Integer priceSales;                  // 판매가
        public Integer priceStandard;               // 정가
        public String  mallType;                    // 상품의 몰타입. 국내도서:BOOK, 음반:MUSIC, Dvd:DVD, 외서:FOREIGN, 전자책:EBOOK, 중고상품:USED
        public String  stockStatus;                 // 재고상태(정상유통일 경우 비어있음, 품절/절판 등)
        public String  cover;                       // 표지
        public Integer categoryId;                  // 전체 분야 정보 - 카테고리 ID
        public String  categoryName;                // 전체 분야 정보 - 카테고리 명
        public String  publisher;                   // 출판사
        public Integer salesPoint;                  // 판매지수
        public String  adult;                       // 성인등급 여부
        public String  fixedPrice;                  // 정가제 여부
        public Integer customerReviewRank;          // 회원 리뷰 평점
        public SubInfo subInfo;                     // 회원 리뷰 평점
    }

    public class SubInfo {
        public String  subTitle;                    // 부제
        public String  originalTitle;               // 원제
        public Integer itemPage;                    // 상품의 쪽수
        public UsedList usedList;                   // 해당 상품에 등록된 중고상품 정보
    }

    public class UsedList {
        public AladinUsed aladinUsed;               // 알라딘 직배송 중고정보
        public SpaceUsed  spaceUsed;                // 광활한 우주점(매장 배송) 중고의 정보
    }

    public class AladinUsed {
        public String  link;                        // 알라딘 직접 배송 중고의 리스트 페이지 URL
        public Integer itemCount;                   // 알라딘 직접 배송 중고의 보유 상품수
        public Integer minPrice;                    // 알라딘 직접 배송 중고의 보유 상품중 최저가 상품 판매가격
    }

    public class SpaceUsed {
        public String  link;                        // 광활한 우주점(매장 배송) 중고의 리스트 페이지 URL
        public Integer itemCount;                   // 광활한 우주점(매장 배송) 중고의 보유 상품수
        public Integer minPrice;                    // 광활한 우주점(매장 배송) 중고의 보유 상품중 최저가 상품 판매가격
    }

}
