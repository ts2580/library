import "server-only";
import { sqlite } from "@/db";

export interface CategorySummary {
  category: string;
  volumeCount: number;
  purchasedAmount: number;
  plannedAmount: number;
}

export interface DashboardData {
  bookCount: number;
  volumeCount: number;
  purchasedAmount: number;
  plannedPurchaseAmount: number;
  categories: CategorySummary[];
}

export function getDashboardData(ownerId: number): DashboardData {
  const totals = sqlite.prepare(`
    SELECT
      COUNT(DISTINCT b.id) AS bookCount,
      COUNT(bv.id) AS volumeCount,
      COALESCE(SUM(CASE WHEN COALESCE(bv.ispurchased, 0) = 1 AND REPLACE(COALESCE(bv.price, ''), ',', '') NOT GLOB '*[^0-9]*' THEN CAST(REPLACE(bv.price, ',', '') AS INTEGER) ELSE 0 END), 0) AS purchasedAmount,
      COALESCE(SUM(CASE WHEN COALESCE(bv.ispurchased, 0) = 0 AND COALESCE(bv.noneedtobuy, 0) = 0 AND REPLACE(COALESCE(bv.price, ''), ',', '') NOT GLOB '*[^0-9]*' THEN CAST(REPLACE(bv.price, ',', '') AS INTEGER) ELSE 0 END), 0) AS plannedPurchaseAmount
    FROM books b
    LEFT JOIN book_volumes bv ON bv.book = b.id
    WHERE b.owner_id = ?
  `).get(ownerId) as Omit<DashboardData, "categories">;

  const categories = sqlite.prepare(`
    SELECT COALESCE(NULLIF(TRIM(b.type), ''), '미분류') AS category,
      COUNT(bv.id) AS volumeCount,
      COALESCE(SUM(CASE WHEN COALESCE(bv.ispurchased, 0) = 1 AND REPLACE(COALESCE(bv.price, ''), ',', '') NOT GLOB '*[^0-9]*' THEN CAST(REPLACE(bv.price, ',', '') AS INTEGER) ELSE 0 END), 0) AS purchasedAmount,
      COALESCE(SUM(CASE WHEN COALESCE(bv.ispurchased, 0) = 0 AND COALESCE(bv.noneedtobuy, 0) = 0 AND REPLACE(COALESCE(bv.price, ''), ',', '') NOT GLOB '*[^0-9]*' THEN CAST(REPLACE(bv.price, ',', '') AS INTEGER) ELSE 0 END), 0) AS plannedAmount
    FROM books b LEFT JOIN book_volumes bv ON bv.book = b.id
    WHERE b.owner_id = ?
    GROUP BY category
    ORDER BY volumeCount DESC, category COLLATE NOCASE
  `).all(ownerId).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      category: String(item.category), volumeCount: Number(item.volumeCount),
      purchasedAmount: Number(item.purchasedAmount), plannedAmount: Number(item.plannedAmount)
    };
  });

  return {
    bookCount: Number(totals.bookCount), volumeCount: Number(totals.volumeCount),
    purchasedAmount: Number(totals.purchasedAmount), plannedPurchaseAmount: Number(totals.plannedPurchaseAmount),
    categories
  };
}
