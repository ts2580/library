export interface StockRefreshProgress {
  runId?: string | null;
  completionId?: string | null;
  mode: "REPLACE_ALL" | "APPEND_BOOK" | "REFRESH_SELECTED";
  pendingFailures?: number;
  scopeBookId: number | null;
  running: boolean;
  completed: boolean;
  failed: boolean;
  total: number;
  processed: number;
  success: number;
  empty: number;
  fail: number;
  percent: number;
  message: string;
  updatedAt: string | null;
  status: "IDLE" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
}

export interface StockRefreshLogEntry {
  id: number;
  bookId: number;
  bookName: string;
  volumeId: number;
  volumeName: string;
  volume: number | null;
  isbn13: string | null;
  status: "SUCCESS" | "EMPTY" | "FAILED";
  code: string;
  message: string;
  createdAt: string;
  retryable: boolean;
}

export interface StockRefreshLogPage {
  items: StockRefreshLogEntry[];
  total: number;
  page: number;
  totalPages: number;
  pendingFailures: number;
}

export interface BranchInventoryItem {
  branch: string;
  branchName: string;
  stockCount: number;
  pricedCount: number;
  totalAmount: number;
}

export interface BranchStockItem {
  id: number;
  branch: string | null;
  branchName: string | null;
  bookId: number;
  bookName: string | null;
  volumeName: string | null;
  grade: string | null;
  isbn13: string | null;
  cover: string | null;
  price: string | null;
  bookLink: string | null;
  purchaseUrl: string | null;
}
