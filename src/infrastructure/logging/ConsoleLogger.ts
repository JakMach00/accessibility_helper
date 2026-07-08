import type { ILogger } from '@core/domain/ports';

export class ConsoleLogger implements ILogger {
  constructor(private readonly scope = 'app') {}

  private fmt(level: string, message: string): string {
    return `[${new Date().toISOString()}] [${level}] [${this.scope}] ${message}`;
  }

  debug(message: string, meta?: unknown): void {
    if (process.env.NODE_ENV === 'production') return;
    // eslint-disable-next-line no-console
    console.debug(this.fmt('DEBUG', message), meta ?? '');
  }
  info(message: string, meta?: unknown): void {
    // eslint-disable-next-line no-console
    console.info(this.fmt('INFO', message), meta ?? '');
  }
  warn(message: string, meta?: unknown): void {
    // eslint-disable-next-line no-console
    console.warn(this.fmt('WARN', message), meta ?? '');
  }
  error(message: string, meta?: unknown): void {
    // eslint-disable-next-line no-console
    console.error(this.fmt('ERROR', message), meta ?? '');
  }
}
