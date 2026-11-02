/** Lets search results and empty states open the help drawer. */
let opener: ((query?: string) => void) | null = null;

export function setHelpOpener(fn: (query?: string) => void) {
  opener = fn;
  return () => { if (opener === fn) opener = null; };
}

export function showHelp(query?: string) {
  opener?.(query);
}
