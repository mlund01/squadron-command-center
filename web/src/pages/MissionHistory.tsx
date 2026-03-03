import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { getInstance, getMissionHistory } from '@/api/client';
import { StatusBadge, formatTime, formatDuration } from '@/lib/mission-utils';

export function MissionHistory() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: instance } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
  });

  const { data: history, isLoading, error } = useQuery({
    queryKey: ['history', id],
    queryFn: () => getMissionHistory(id!),
    enabled: !!id && !!instance?.connected,
    refetchInterval: 10000,
  });

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Mission History</h1>

      {!instance?.connected && (
        <p className="text-muted-foreground">Instance is disconnected. History is unavailable.</p>
      )}

      {isLoading && <p className="text-muted-foreground">Loading history...</p>}
      {error && <p className="text-destructive">Error: {(error as Error).message}</p>}

      {history && (!history.missions || history.missions.length === 0) && (
        <p className="text-muted-foreground">No mission runs yet.</p>
      )}

      {history && history.missions && history.missions.length > 0 && (
        <div className="bg-card rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted border-b">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Mission</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Started</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Duration</th>
              </tr>
            </thead>
            <tbody>
              {history.missions.map((m) => (
                <tr key={m.id} className="border-b last:border-b-0 hover:bg-muted/50 cursor-pointer" onClick={() => navigate(`/instances/${id}/runs/${m.id}`)}>
                  <td className="px-4 py-3 font-medium">{m.name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatTime(m.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {m.finishedAt ? formatDuration(m.startedAt, m.finishedAt) : '\u2014'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history && (
        <p className="text-xs text-muted-foreground mt-3">
          Showing {history.missions?.length ?? 0} of {history.total} runs
        </p>
      )}
    </div>
  );
}
