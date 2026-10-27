export interface VolumeSaveResult {
  success: boolean;
  message: string;
  code?: string;
}

export interface BookListItem {
  id: number;
  name: string | null;
  author: string | null;
  description: string | null;
  type: string | null;
  cover: string | null;
  createdDate: string | null;
  volumeCount: number;
}

export interface BookOption {
  id: number;
  name: string;
  author: string | null;
  cover: string | null;
  type: string | null;
  nextVolume: number;
}

export interface VolumeDetail {
  id: number;
  seq: number | null;
  name: string | null;
  author: string | null;
  isbn13: string | null;
  cover: string | null;
  price: string | null;
  description: string | null;
  link: string | null;
  pubDate: string | null;
  isPurchased: boolean;
  noNeedToBuy: boolean;
  stockCount: number;
  minStockPrice: number | null;
}

export interface BookDetail extends BookListItem {
  totalVolume: string | null;
  volumes: VolumeDetail[];
}

export interface BookListResult {
  items: BookListItem[];
  categories: string[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  from: number;
  to: number;
}

export interface BookListFilters {
  page?: number;
  title?: string | null;
  author?: string | null;
  type?: string | null;
  search?: string | null;
}
