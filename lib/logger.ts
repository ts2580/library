import "server-only";
import { env } from "@/lib/env";

const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type LogLevel = keyof typeof levels;

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[env.BOOKSHELF_LOG_LEVEL];
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? { context } : {})
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context)
};
