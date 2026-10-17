import { relations } from "drizzle-orm";
import { appSessions, bookVolumes, books, branchBooks, members } from "@/db/schema";

export const memberRelations = relations(members, ({ many }) => ({
  books: many(books),
  sessions: many(appSessions)
}));

export const bookRelations = relations(books, ({ one, many }) => ({
  owner: one(members, { fields: [books.ownerId], references: [members.id] }),
  volumes: many(bookVolumes),
  branchStocks: many(branchBooks)
}));

export const bookVolumeRelations = relations(bookVolumes, ({ one, many }) => ({
  book: one(books, { fields: [bookVolumes.bookId], references: [books.id] }),
  branchStocks: many(branchBooks)
}));

export const branchBookRelations = relations(branchBooks, ({ one }) => ({
  book: one(books, { fields: [branchBooks.bookId], references: [books.id] }),
  volume: one(bookVolumes, { fields: [branchBooks.bookVolumeId], references: [bookVolumes.id] })
}));
