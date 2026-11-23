/**
 * Minimal injectable logger. The upstream backend uses slf4j (log.debug/log.warn) and swallows most
 * backend errors with a warning (RestClient.java). A silent default keeps the library quiet
 * and lets tests assert warnings without console noise.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const noop = (): void => undefined;

export const silentLogger: Logger = { debug: noop, warn: noop, error: noop };

export const consoleLogger: Logger = {
  debug: (message, ...args) => console.debug(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
};