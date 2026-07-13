import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import type { JiraConfigInput, JiraConfigView, JiraIssuePayload, JiraCreateResult } from '@shared/types';

// Persisted Jira configuration. The API token is stored encrypted with the OS
// keychain (Electron safeStorage) when available, otherwise base64 (obfuscation only).
interface StoredConfig {
  baseUrl: string;
  email: string;
  projectKey: string;
  issueType: string;
  component: string;
  labels: string[];
  tokenEnc: string;
  encrypted: boolean;
}

const configPath = (): string => join(app.getPath('userData'), 'jira-config.json');

async function readConfig(): Promise<StoredConfig | null> {
  try {
    return JSON.parse(await readFile(configPath(), 'utf-8')) as StoredConfig;
  } catch {
    return null;
  }
}

export async function getJiraConfig(): Promise<JiraConfigView> {
  const c = await readConfig();
  if (!c) {
    return {
      baseUrl: '',
      email: '',
      projectKey: '',
      issueType: 'Bug',
      component: '',
      labels: ['accessibility', 'wcag'],
      hasToken: false
    };
  }
  return {
    baseUrl: c.baseUrl,
    email: c.email,
    projectKey: c.projectKey,
    issueType: c.issueType,
    component: c.component,
    labels: c.labels,
    hasToken: Boolean(c.tokenEnc)
  };
}

export async function saveJiraConfig(input: JiraConfigInput): Promise<void> {
  const existing = await readConfig();
  let tokenEnc = existing?.tokenEnc ?? '';
  let encrypted = existing?.encrypted ?? false;

  // Only replace the token when a new one is provided (empty = keep the old one).
  if (input.apiToken) {
    if (safeStorage.isEncryptionAvailable()) {
      tokenEnc = safeStorage.encryptString(input.apiToken).toString('base64');
      encrypted = true;
    } else {
      tokenEnc = Buffer.from(input.apiToken, 'utf-8').toString('base64');
      encrypted = false;
    }
  }

  const stored: StoredConfig = {
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    email: input.email.trim(),
    projectKey: input.projectKey.trim(),
    issueType: input.issueType.trim() || 'Bug',
    component: input.component.trim(),
    labels: input.labels.map((l) => l.trim()).filter(Boolean),
    tokenEnc,
    encrypted
  };
  await writeFile(configPath(), JSON.stringify(stored, null, 2), 'utf-8');
}

function decryptToken(c: StoredConfig): string {
  if (!c.tokenEnc) return '';
  const buf = Buffer.from(c.tokenEnc, 'base64');
  if (c.encrypted) {
    try {
      return safeStorage.decryptString(buf);
    } catch {
      return '';
    }
  }
  return buf.toString('utf-8');
}

// Convert our plain-text defect into a minimal, always-valid ADF document.
function toAdf(text: string): unknown {
  const content = text
    .split('\n')
    .map((line) =>
      line
        .replace(/^h3\.\s*/, '')
        .replace(/\*/g, '')
        .replace(/^#\s+/, '- ')
        .trimEnd()
    )
    .filter((line) => line.trim().length > 0)
    .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }));
  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: '-' }] });
  }
  return { type: 'doc', version: 1, content };
}

export async function createJiraIssue(payload: JiraIssuePayload): Promise<JiraCreateResult> {
  const c = await readConfig();
  if (!c || !c.baseUrl || !c.email || !c.tokenEnc || !c.projectKey) {
    throw new Error(
      'Jira is not configured. Open Jira settings and fill in the URL, email, API token and project key.'
    );
  }
  const token = decryptToken(c);
  if (!token) {
    throw new Error('Could not read the stored Jira API token. Re-enter it in Jira settings.');
  }

  const labels = [...new Set([...(c.labels ?? []), ...(payload.extraLabels ?? [])])].filter(Boolean);
  const fields: Record<string, unknown> = {
    project: { key: c.projectKey },
    issuetype: { name: c.issueType || 'Bug' },
    summary: payload.summary.slice(0, 255),
    description: toAdf(payload.description),
    labels
  };
  if (c.component) fields.components = [{ name: c.component }];

  const auth = Buffer.from(`${c.email}:${token}`).toString('base64');
  const res = await fetch(`${c.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${auth}`
    },
    body: JSON.stringify({ fields })
  });

  if (!res.ok) {
    let detail = '';
    try {
      const err = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> };
      detail = [...(err.errorMessages ?? []), ...Object.values(err.errors ?? {})].join('; ');
    } catch {
      // response body was not JSON
    }
    if (res.status === 401) {
      throw new Error('Jira rejected the credentials (401). Check the email and API token.');
    }
    throw new Error(`Jira returned an error (${res.status}). ${detail}`.trim());
  }

  const data = (await res.json()) as { key: string };
  return { key: data.key, url: `${c.baseUrl}/browse/${data.key}` };
}
