import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type BrowserKind = 'chrome' | 'edge';

// Common Chrome and Edge install paths on Windows.
// Order: Program Files, Program Files (x86), LocalAppData.
function candidatePaths(kind: BrowserKind): string[] {
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = process.env['LOCALAPPDATA'] ?? '';

  if (kind === 'chrome') {
    return [
      join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      localAppData ? join(localAppData, 'Google\\Chrome\\Application\\chrome.exe') : ''
    ].filter(Boolean);
  }
  return [
    join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
    join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe')
  ];
}

export function findBrowserExecutable(kind: BrowserKind): string | null {
  for (const path of candidatePaths(kind)) {
    if (existsSync(path)) return path;
  }
  return null;
}

export function friendlyBrowserName(kind: BrowserKind): string {
  return kind === 'chrome' ? 'Chrome' : 'Edge';
}
