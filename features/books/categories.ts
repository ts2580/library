import "server-only";
import { z } from "zod";
import { sqlite } from "@/db";
import { AppError } from "@/lib/errors";

const nameSchema = z.string().trim().min(1).max(120);
function categoryName(raw: unknown): string {
  const parsed = nameSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("카테고리 이름은 1~120자로 입력하세요.");
  return parsed.data;
}

export function addCategory(raw: unknown): string {
  const name = categoryName(raw);
  sqlite.prepare("INSERT OR IGNORE INTO book_categories(name) VALUES (?)").run(name);
  return name;
}

export function removeCategory(raw: unknown): void {
  const name = categoryName(raw);
  sqlite.transaction(() => {
    if (sqlite.prepare("SELECT 1 FROM books WHERE TRIM(type)=? LIMIT 1").get(name)) {
      throw new AppError("책에 사용 중인 카테고리입니다. 책의 분류를 변경한 후 삭제해 주세요.");
    }
    sqlite.prepare("DELETE FROM book_categories WHERE name=?").run(name);
  }).immediate();
}
