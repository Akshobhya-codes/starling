export interface ServerLogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
}

const globalForLogs = globalThis as unknown as { __serverLogs?: ServerLogEntry[] };
if (!globalForLogs.__serverLogs) {
  globalForLogs.__serverLogs = [];
}

const MAX_LOGS = 120;

export function addServerLog(level: ServerLogEntry["level"], message: string): ServerLogEntry {
  const entry: ServerLogEntry = {
    ts: new Date().toISOString(),
    level,
    message,
  };
  globalForLogs.__serverLogs!.push(entry);
  while (globalForLogs.__serverLogs!.length > MAX_LOGS) {
    globalForLogs.__serverLogs!.shift();
  }
  return entry;
}

export function getServerLogs(): ServerLogEntry[] {
  return [...globalForLogs.__serverLogs!];
}
