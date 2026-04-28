import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// singleLine collapses any internal whitespace (including markdown
// newlines) into a single space and trims edges. Useful when piping a
// long-form `question` into a row preview.
export function singleLine(s: string, max?: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return max != null ? truncate(flat, max) : flat;
}

// truncate caps a string to `max` characters, appending an ellipsis
// when it had to cut. Trims trailing whitespace before the ellipsis so
// "foo …" doesn't show up as "foo  …".
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
