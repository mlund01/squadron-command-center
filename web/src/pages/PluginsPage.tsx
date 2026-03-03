import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getInstance } from '@/api/client';
import { Badge } from '@/components/ui/badge';

export function PluginsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance) return <div className="p-8 text-muted-foreground">Instance not found</div>;

  const { config } = instance;
  const builtinPlugins = config.plugins?.filter((p) => p.builtin) ?? [];
  const externalPlugins = config.plugins?.filter((p) => !p.builtin) ?? [];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Plugins</h1>

      {(!config.plugins || config.plugins.length === 0) ? (
        <p className="text-muted-foreground">No plugins configured.</p>
      ) : (
        <div className="space-y-6">
          {builtinPlugins.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Built-in</h2>
              <div className="space-y-3">
                {builtinPlugins.map((p) => (
                  <div key={p.name} className="p-4 bg-card rounded-lg border">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <Badge variant="secondary" className="text-[10px]">builtin</Badge>
                    </div>
                    {p.tools && p.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {p.tools.map((tool) => (
                          <Badge key={tool.name} variant="outline" className="text-xs font-mono">
                            {tool.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {externalPlugins.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">External</h2>
              <div className="space-y-3">
                {externalPlugins.map((p) => (
                  <div key={p.name} className="p-4 bg-card rounded-lg border">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 font-mono">{p.path}</div>
                    {p.tools && p.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {p.tools.map((tool) => (
                          <Badge key={tool.name} variant="outline" className="text-xs font-mono">
                            {tool.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
