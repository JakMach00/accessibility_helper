import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanResultDTO, ScanSummaryDTO } from '@shared/types';
import { toSummary, type ScanResult } from '@core/domain/ScanResult';
import type { ILogger, IScanRepository } from '@core/domain/ports';

// Default repository implementation: each scan is a JSON file in the history directory.
// Port IScanRepository pozwala podmienic to na SQLite bez zmian w reszcie aplikacji.
export class FileScanRepository implements IScanRepository {
  constructor(
    private readonly baseDir: string,
    private readonly logger: ILogger
  ) {}

  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  private fileFor(id: string): string {
    // Id pochodzi zza granicy IPC. Dopuszczamy tylko bezpieczne znaki, by uniemozliwic
    // wyjscie poza katalog historii (np. "../../cos").
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      throw new Error(`Unsafe scan identifier: ${id}`);
    }
    return join(this.baseDir, `${id}.json`);
  }

  async save(scan: ScanResult): Promise<void> {
    await this.ensureDir();
    await writeFile(this.fileFor(scan.id), JSON.stringify(scan), 'utf-8');
    this.logger.info(`Saved scan ${scan.id}`);
  }

  async list(): Promise<ScanSummaryDTO[]> {
    await this.ensureDir();
    const files = (await readdir(this.baseDir)).filter((f) => f.endsWith('.json'));
    const summaries: ScanSummaryDTO[] = [];
    for (const file of files) {
      try {
        const raw = await readFile(join(this.baseDir, file), 'utf-8');
        const scan = JSON.parse(raw) as ScanResultDTO;
        summaries.push(toSummary(scan));
      } catch (error) {
        this.logger.warn(`Pominieto uszkodzony plik historii: ${file}`, error);
      }
    }
    // Najnowsze na gorze.
    summaries.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
    return summaries;
  }

  async getById(id: string): Promise<ScanResult | null> {
    try {
      const raw = await readFile(this.fileFor(id), 'utf-8');
      return JSON.parse(raw) as ScanResult;
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await unlink(this.fileFor(id));
    } catch (error) {
      this.logger.warn(`Could not delete scan ${id}`, error);
    }
  }
}
