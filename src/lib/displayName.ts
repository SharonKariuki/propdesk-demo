/**
 * Hook for rewriting how account identifiers are shown in the UI (e.g. hiding a
 * personal mailbox behind a role name). The demo has no such aliases, so it is
 * the identity function — kept so callers stay unchanged.
 */
export function displayName(value: string | null | undefined): string {
  return value ?? "";
}
