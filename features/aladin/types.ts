export interface AladinBookItem {
  itemId?: string;
  owned?: boolean;
  title: string;
  author: string | null;
  /** Plain text introduction summary decoded once from the public product page. */
  description: string | null;
  isbn: string | null;
  isbn13: string | null;
  cover: string | null;
  priceSales: number | null;
  link: string | null;
  pubDate: string | null;
  categoryName: string | null;
}

export interface AladinSearchResult {
  items: AladinBookItem[];
  totalResults: number;
  page: number;
  pageSize: number;
}

export interface AladinBranchStock {
  /** false means the offer could not be verified. */
  verified?: boolean;
  branch: string;
  branchName: string;
  grade: string | null;
  bookLink: string | null;
  purchaseLink: string | null;
  price: string | null;
  title: string | null;
}

export type StockLookupResult =
  | { successful: true; stocks: AladinBranchStock[]; raw: unknown; partial?: boolean; warning?: string }
  | { successful: false; stocks: []; errorMessage: string; errorCode?: string; raw?: unknown };
