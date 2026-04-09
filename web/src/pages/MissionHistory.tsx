import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { getInstance, getMissionHistory } from '@/api/client';
import { StatusBadge, formatTime, formatDuration } from '@/lib/mission-utils';
import { PageStats } from '@/components/page-stats';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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

  const stats = useMemo(() => {
    const runs = history?.missions ?? [];
    const completed = runs.filter(m => m.status === 'completed').length;
    const failed = runs.filter(m => m.status === 'failed').length;
    const running = runs.filter(m => m.status === 'running').length;
    return [
      { label: 'Total Runs', value: history?.total ?? 0 },
      { label: 'Completed', value: completed },
      { label: 'Failed', value: failed },
      { label: 'Running', value: running },
    ];
  }, [history]);

  return (
    <div className="p-8 w-full max-w-6xl mx-auto">
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
        <>
          <PageStats stats={stats} />
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mission</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.missions.map((m) => (
                  <TableRow key={m.id} className="cursor-pointer" onClick={() => navigate(`/instances/${id}/runs/${m.id}`)}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTime(m.startedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.finishedAt ? formatDuration(m.startedAt, m.finishedAt) : '\u2014'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Showing {history.missions.length} of {history.total} runs
          </p>
        </>
      )}
    </div>
  );
}
