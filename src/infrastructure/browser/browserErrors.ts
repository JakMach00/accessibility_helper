// Tlumaczenie surowych bledow Playwright/CDP na komunikaty zrozumiale dla uzytkownika.
// Kazdy komunikat mowi CO sie stalo i CO zrobic.

function raw(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function connectionErrorMessage(error: unknown, endpoint: string): string {
  const text = raw(error);
  if (/ECONNREFUSED|ECONNRESET|connect ECONNREFUSED|failed to connect|WebSocket|Timed out|timeout|net::ERR/i.test(text)) {
    return (
      `Could not connect to the browser at ${endpoint}. ` +
      'Start the browser with a debugging port: ' +
      'msedge --remote-debugging-port=9222 --user-data-dir="%TEMP%\\wcag-edge" ' +
      '(for Chrome replace msedge with chrome), go through your flow and try again. ' +
      'If the browser was already running, close all of its windows first, because they block the port.'
    );
  }
  return `Could not connect to the browser at ${endpoint}. Technical details: ${text}`;
}

export function launchTimeoutMessage(browserName: string): string {
  return (
    `${browserName} started but did not expose the debugging port in time. ` +
    `The most common cause is an already-running instance of ${browserName}. ` +
    `Close all windows of ${browserName} and try again.`
  );
}

export function browserNotFoundMessage(browserName: string): string {
  return (
    `Browser not found: ${browserName} in the usual locations. ` +
    'Use the attach-to-open-browser mode or the bundled Chromium mode.'
  );
}

export function bundledLaunchErrorMessage(error: unknown): string {
  const text = raw(error);
  if (/Executable doesn't exist|playwright install|Failed to launch|ENOENT|browserType\.launch/i.test(text)) {
    return (
      'The bundled Chromium (Playwright) is not installed. ' +
      'In the application folder run: npx playwright install chromium, ' +
      'or choose the Edge or Chrome mode (they need no extra download).'
    );
  }
  return `Could not launch the bundled Chromium. Technical details: ${text}`;
}

export function navigationErrorMessage(error: unknown, url: string): string {
  const text = raw(error);
  if (/Timeout|Timed out/i.test(text)) {
    return `The page ${url} did not load in time. Check your connection and whether the address is reachable from this machine.`;
  }
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|ERR_ADDRESS_UNREACHABLE/i.test(text)) {
    return `Address ${url} was not found. Check that it is correct.`;
  }
  if (/net::ERR|NS_ERROR/i.test(text)) {
    return `Could not open ${url}. The page may be unreachable from this machine (VPN, firewall, login).`;
  }
  return `Could not open ${url}. Technical details: ${text}`;
}
