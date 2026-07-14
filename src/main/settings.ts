import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { AppSettings } from '@shared/types';

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json');

const DEFAULTS: AppSettings = { exportDir: '', askEachTime: true };

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(settingsPath(), 'utf-8')) as Partial<AppSettings>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(input: AppSettings): Promise<void> {
  const clean: AppSettings = {
    exportDir: (input.exportDir ?? '').trim(),
    askEachTime: Boolean(input.askEachTime)
  };
  await writeFile(settingsPath(), JSON.stringify(clean, null, 2), 'utf-8');
}
