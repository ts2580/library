export interface FixtureItem { itemId: string; isbn13?: string; title: string; author?: string; description?: string; pubDate?: string; priceSales?: number; cover?: string }
export function searchPage(items: FixtureItem[], options?: { page?: number; pageSize?: number; total?: number; stores?: boolean }): string;
export function productPage(item: FixtureItem): string;
export function usedPage(itemId: string, options?: { count?: number; page?: number; pages?: number; offers?: Array<{kind: "direct" | "store" | "private"; id?: string}>; totals?: {direct: number; store: number; private: number} }): string;
export function branchPage(): string;
export function esc(value: unknown): string;
