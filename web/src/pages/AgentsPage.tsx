import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { getInstance } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function AgentsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance) return <div className="p-8 text-muted-foreground">Instance not found</div>;

  const { config } = instance;

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">Agents</h1>

      {(!config.agents || config.agents.length === 0) ? (
        <p className="text-muted-foreground">No agents configured.</p>
      ) : (
        <div className="rounded-lg border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-[120px]">Scope</TableHead>
                <TableHead className="w-[100px]">Model</TableHead>
                <TableHead className="w-[80px]">Tools</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {config.agents.map((a) => (
                <TableRow
                  key={a.name}
                  className="cursor-pointer"
                  onClick={() => navigate(`/instances/${id}/agents/${a.name}`)}
                >
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    {a.role && (
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{a.role}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.mission ? (
                      <Badge variant="outline" className="text-xs">{a.mission}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Global</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{a.model}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{a.tools?.length ?? 0}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
