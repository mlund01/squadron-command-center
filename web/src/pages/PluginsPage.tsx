import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getInstance } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Info } from 'lucide-react';

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
  const hasFolders = config.sharedFolders && config.sharedFolders.length > 0;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Tools</h1>

      {(!config.plugins || config.plugins.length === 0) ? (
        <p className="text-muted-foreground">No tools configured.</p>
      ) : (
        <div className="space-y-6">
          {builtinPlugins.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Built-in</h2>
              {hasFolders && (
                <Alert className="mb-3 border-blue-500/30 bg-blue-500/5 text-blue-200 [&>svg]:text-blue-400">
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    File management tools are automatically available to commanders when shared folders are configured.
                  </AlertDescription>
                </Alert>
              )}
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
              <h2 className="text-lg font-semibold mb-3">Plugins</h2>
              <div className="space-y-3">
                {externalPlugins.map((p) => (
                  <div key={p.name} className="p-4 bg-card rounded-lg border">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      {p.version && (
                        <Badge variant="secondary" className="text-[10px]">{p.version}</Badge>
                      )}
                    </div>
                    {p.path && (
                      <div className="text-xs text-muted-foreground mt-1 font-mono">{p.path}</div>
                    )}
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
