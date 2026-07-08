// Czysci techniczne prefiksy Electron IPC z komunikatow, by uzytkownik widzial
// tylko sensowna tresc (komunikaty sa juz humanizowane w warstwie main/infra).
export function humanizeError(error: unknown): string {
  let msg = error instanceof Error ? error.message : String(error);
  msg = msg.replace(/^Error invoking remote method '[^']*':\s*/i, '');
  msg = msg.replace(/^(Error|UnhandledPromiseRejection):\s*/i, '');
  return msg.trim() || 'An unknown error occurred. Please try again.';
}
