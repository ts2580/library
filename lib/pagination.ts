export function pageNumbers(page: number, totalPages: number): number[] {
  const count = Math.min(5, Math.max(1, totalPages));
  const first = Math.max(1, Math.min(page - 2, totalPages - count + 1));
  return Array.from({ length: count }, (_, index) => first + index);
}
