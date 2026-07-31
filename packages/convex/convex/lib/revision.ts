import { invalid } from './validate';

/** Existing rows predate optimistic concurrency and therefore start at zero. */
export function currentRevision(value: number | undefined): number {
  return value ?? 0;
}

export function nextRevision(value: number | undefined): number {
  return currentRevision(value) + 1;
}

/**
 * Reject a stale editor before it can overwrite a newer browser/device save.
 * Web callers may omit the expectation, but every successful write still bumps
 * the counter so a native editor's snapshot detects that write.
 */
export function assertExpectedRevision(
  actual: number | undefined,
  expected: number | undefined,
): void {
  if (expected !== undefined && expected !== currentRevision(actual)) {
    invalid({
      code: 'conflict',
      field: 'expectedRevision',
      message: 'This record changed on another device. Close and reopen the editor, then try again.',
    });
  }
}
