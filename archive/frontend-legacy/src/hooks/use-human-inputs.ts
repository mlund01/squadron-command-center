import { useQuery } from '@tanstack/react-query';
import { listHumanInputs } from '@/api/client';

// SSE (see use-human-input-alerts) drives realtime updates by
// invalidating this query, so the polling here is just a safety net
// for missed pushes during reconnect — long interval is fine.
const POLL_MS = 30_000;

const queryKey = (instanceId: string | undefined, state: 'open' | 'resolved', missionId?: string) =>
  ['humanInputs', instanceId ?? '', state, missionId ?? ''] as const;

export function useHumanInputs(opts: {
  instanceId: string | undefined;
  state?: 'open' | 'resolved';
  missionId?: string;
}) {
  const state = opts.state ?? 'open';
  const query = useQuery({
    queryKey: queryKey(opts.instanceId, state, opts.missionId),
    queryFn: () =>
      listHumanInputs(opts.instanceId!, {
        state,
        missionId: opts.missionId,
        order: 'oldest',
        limit: 100,
      }),
    enabled: !!opts.instanceId,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });

  return {
    humanInputs: query.data?.humanInputs ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

// Shares the open list cache with useHumanInputs via select() so the
// sidebar badge piggy-backs on the same fetch / invalidation flow
// instead of running its own poll.
export function useOpenHumanInputCount(instanceId: string | undefined): number {
  const query = useQuery({
    queryKey: queryKey(instanceId, 'open'),
    queryFn: () =>
      listHumanInputs(instanceId!, { state: 'open', order: 'oldest', limit: 100 }),
    enabled: !!instanceId,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    select: (data) => data.total,
  });
  return query.data ?? 0;
}
