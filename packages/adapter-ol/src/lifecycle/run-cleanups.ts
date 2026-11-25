export function runCleanups(cleanups: readonly (() => void)[]): unknown[] {
  const errors: unknown[] = [];
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}
