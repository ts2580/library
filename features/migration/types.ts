export type CleanupStatus = {
  state: "READY" | "BLOCKED" | "CLEANED" | "NOT_FOUND" | "RETRY";
  canDelete: boolean;
  message: string;
  databaseBytes: number;
  coverBytes: number;
  coverFiles: number;
};
