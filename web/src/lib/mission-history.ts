import type { MissionHistoryResponse, MissionRun } from '@/api/types';

// Go encodes an uninitialized slice as null. Keep that wire detail out of pages.
export function normalizeMissionHistory(value: { missions: MissionRun[] | null; total: number }): MissionHistoryResponse {
  return { ...value, missions: value.missions ?? [] };
}
