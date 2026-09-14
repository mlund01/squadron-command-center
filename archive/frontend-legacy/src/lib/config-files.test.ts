import { describe, it, expect } from 'vitest';
import { buildNewFilePath, splitDirAndBase, validateNewFileName } from './config-files';

describe('buildNewFilePath', () => {
  it('returns the trimmed name when dir is empty (root)', () => {
    expect(buildNewFilePath('', 'example.md')).toBe('example.md');
  });

  it('prefixes the directory with a slash separator', () => {
    expect(buildNewFilePath('agents', 'new-agent.md')).toBe('agents/new-agent.md');
  });

  it('trims surrounding whitespace from the name', () => {
    expect(buildNewFilePath('agents', '  new.md  ')).toBe('agents/new.md');
  });

  it('returns empty string when name is empty or whitespace', () => {
    expect(buildNewFilePath('agents', '')).toBe('');
    expect(buildNewFilePath('agents', '   ')).toBe('');
    expect(buildNewFilePath('', '')).toBe('');
  });

  it('handles nested directory prefixes verbatim', () => {
    expect(buildNewFilePath('agents/sub', 'x.md')).toBe('agents/sub/x.md');
  });

  it('strips a leading "./" from the name', () => {
    expect(buildNewFilePath('', './foo.md')).toBe('foo.md');
    expect(buildNewFilePath('agents', './foo.md')).toBe('agents/foo.md');
  });
});

describe('splitDirAndBase', () => {
  it('returns empty dir for a root-level path', () => {
    expect(splitDirAndBase('file.md')).toEqual({ dir: '', base: 'file.md' });
  });

  it('splits a nested path on the last slash', () => {
    expect(splitDirAndBase('agents/a.md')).toEqual({ dir: 'agents', base: 'a.md' });
    expect(splitDirAndBase('a/b/c.md')).toEqual({ dir: 'a/b', base: 'c.md' });
  });

  it('handles an empty string', () => {
    expect(splitDirAndBase('')).toEqual({ dir: '', base: '' });
  });
});

describe('validateNewFileName', () => {
  const empty = new Set<string>();

  it('returns null for empty input (not yet ready, not an error)', () => {
    expect(validateNewFileName('', '', empty)).toBeNull();
    expect(validateNewFileName('agents', '   ', empty)).toBeNull();
  });

  it('accepts a simple valid name at the root', () => {
    expect(validateNewFileName('', 'new.md', empty)).toBeNull();
  });

  it('accepts a simple valid name inside a folder', () => {
    expect(validateNewFileName('agents', 'new.md', empty)).toBeNull();
  });

  it('rejects names starting with a slash (absolute path)', () => {
    expect(validateNewFileName('', '/etc/passwd', empty)).toBe('invalid-path');
    expect(validateNewFileName('agents', '/nope.md', empty)).toBe('invalid-path');
  });

  it('rejects names containing ".." (path traversal)', () => {
    expect(validateNewFileName('', '../escape.md', empty)).toBe('invalid-path');
    expect(validateNewFileName('agents', '..', empty)).toBe('invalid-path');
    expect(validateNewFileName('agents', 'sub/../other.md', empty)).toBe('invalid-path');
  });

  it('rejects a name that would collide with an existing root file', () => {
    const existing = new Set(['config.md', 'agents/a.md']);
    expect(validateNewFileName('', 'config.md', existing)).toBe('already-exists');
  });

  it('rejects a name that would collide with an existing nested file', () => {
    const existing = new Set(['agents/a.md']);
    expect(validateNewFileName('agents', 'a.md', existing)).toBe('already-exists');
  });

  it('does not treat same-basename-in-different-dir as a collision', () => {
    const existing = new Set(['agents/a.md']);
    expect(validateNewFileName('', 'a.md', existing)).toBeNull();
    expect(validateNewFileName('other', 'a.md', existing)).toBeNull();
  });

  it('ignores surrounding whitespace when checking collisions', () => {
    const existing = new Set(['config.md']);
    expect(validateNewFileName('', '  config.md  ', existing)).toBe('already-exists');
  });

  it('accepts a leading "./" and normalizes it for collision checks', () => {
    const existing = new Set(['config.md', 'agents/a.md']);
    expect(validateNewFileName('', './new.md', existing)).toBeNull();
    expect(validateNewFileName('', './config.md', existing)).toBe('already-exists');
    expect(validateNewFileName('agents', './a.md', existing)).toBe('already-exists');
  });
});
