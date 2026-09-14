import { describe, it, expect } from 'vitest';
import { formatResolvedResponse } from './HumanInputCard';
import type { HumanInputRequestDTO } from '@/api/types';

// formatResolvedResponse is the single rendering helper for the
// "Response" line on a resolved request — used by both the Inbox
// detail pane and the inline mission-detail card. The contract:
//   - Single-select / free-text → response shown verbatim.
//   - Multi-select with valid JSON array → expanded into a comma list
//     so operators see "A, C" instead of '["A","C"]'.
//   - Multi-select with malformed input → fall back to the raw string
//     rather than throwing or showing nothing (audit trail must always
//     surface what was actually stored).
function rec(partial: Partial<HumanInputRequestDTO>): HumanInputRequestDTO {
  return {
    id: 'id',
    toolCallId: 'tc',
    question: 'q',
    state: 'resolved',
    requestedAt: '2026-04-26T00:00:00Z',
    ...partial,
  };
}

describe('formatResolvedResponse', () => {
  it('returns the response verbatim for single-select / free-text', () => {
    expect(formatResolvedResponse(rec({ response: 'Option A' }))).toBe('Option A');
  });

  it('returns empty string when response is missing', () => {
    expect(formatResolvedResponse(rec({ response: undefined }))).toBe('');
  });

  it('expands a multi-select JSON array into a comma list', () => {
    expect(
      formatResolvedResponse(
        rec({ multiSelect: true, response: '["crowds","long drives"]' }),
      ),
    ).toBe('crowds, long drives');
  });

  it('preserves order of selections in the expanded list', () => {
    expect(
      formatResolvedResponse(rec({ multiSelect: true, response: '["B","A","C"]' })),
    ).toBe('B, A, C');
  });

  it('falls back to the raw string when multi-select response is malformed JSON', () => {
    expect(
      formatResolvedResponse(rec({ multiSelect: true, response: 'not json' })),
    ).toBe('not json');
  });

  it('falls back to the raw string when JSON parses to a non-array', () => {
    expect(
      formatResolvedResponse(rec({ multiSelect: true, response: '"single string"' })),
    ).toBe('"single string"');
  });

  it('falls back to the raw string when array contains non-string entries', () => {
    expect(
      formatResolvedResponse(rec({ multiSelect: true, response: '[1, 2, 3]' })),
    ).toBe('[1, 2, 3]');
  });

  it('renders an empty multi-select array as an empty string (the user picked nothing)', () => {
    // Reasonable UX: if the operator submitted with zero selections,
    // show nothing rather than `[]` — an empty answer is its own signal.
    expect(formatResolvedResponse(rec({ multiSelect: true, response: '[]' }))).toBe('');
  });

  it('treats multi-select with empty response the same as missing response', () => {
    expect(formatResolvedResponse(rec({ multiSelect: true, response: '' }))).toBe('');
  });
});
