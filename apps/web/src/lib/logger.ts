type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function formatMessage(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] [${module}] ${message}`;
  return data ? `${base} ${JSON.stringify(data)}` : base;
}

export function createLogger(module: string) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => {
      if (shouldLog("debug")) console.debug(formatMessage("debug", module, msg, data));
    },
    info: (msg: string, data?: Record<string, unknown>) => {
      if (shouldLog("info")) console.info(formatMessage("info", module, msg, data));
    },
    warn: (msg: string, data?: Record<string, unknown>) => {
      if (shouldLog("warn")) console.warn(formatMessage("warn", module, msg, data));
    },
    error: (msg: string, data?: Record<string, unknown>) => {
      if (shouldLog("error")) console.error(formatMessage("error", module, msg, data));
    },
  };
}
