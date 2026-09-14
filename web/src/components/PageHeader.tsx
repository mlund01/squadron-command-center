import type { ReactNode } from 'react';

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>}
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {actions}
    </header>
  );
}
