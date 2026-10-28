export type MetadataEnrichmentProgress = {
  runId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED";
  total: number;
  processed: number;
  booksUpdated: number;
  volumesUpdated: number;
  failed: number;
  skipped: number;
  message: string;
};
