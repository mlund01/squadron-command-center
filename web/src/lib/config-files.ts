// Pure helpers for the Config tab "add file" flow.
// Extracted so they can be unit-tested without mounting the full page.

/**
 * Strip a leading `./` from a user-typed name so `./foo.md` and `foo.md`
 * are treated identically (both for path building and collision checks).
 */
function stripDotSlash(name: string): string {
  return name.startsWith('./') ? name.slice(2) : name;
}

/**
 * Build the full path for a new config file given a directory prefix
 * (empty string = root) and a user-typed name. Trims whitespace and a
 * leading `./`; does not validate — use `validateNewFileName` for that.
 */
export function buildNewFilePath(dir: string, rawName: string): string {
  const name = stripDotSlash(rawName.trim());
  if (!name) return '';
  return dir ? `${dir}/${name}` : name;
}

export type NewFileError = 'invalid-path' | 'already-exists';

/**
 * Validate a user-typed filename against the set of existing file paths.
 * Returns null when input is acceptable (or empty — callers decide how
 * to treat the empty case). An empty name is treated as "not yet ready"
 * rather than an error so the UI doesn't flash red before typing.
 */
export function validateNewFileName(
  dir: string,
  rawName: string,
  existingPaths: ReadonlySet<string>,
): NewFileError | null {
  const name = stripDotSlash(rawName.trim());
  if (!name) return null;
  if (name.startsWith('/') || name.includes('..')) return 'invalid-path';
  const full = buildNewFilePath(dir, rawName);
  if (existingPaths.has(full)) return 'already-exists';
  return null;
}

/** Split a file path into its parent directory and basename. */
export function splitDirAndBase(path: string): { dir: string; base: string } {
  const i = path.lastIndexOf('/');
  return i < 0 ? { dir: '', base: path } : { dir: path.slice(0, i), base: path.slice(i + 1) };
}
