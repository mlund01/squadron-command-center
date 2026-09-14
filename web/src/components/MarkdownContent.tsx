import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

export function MarkdownContent({ allowLinks = true, className, content }: { allowLinks?: boolean; className?: string; content: string }) {
  return <div className={cn('min-w-0 break-words', className)}>
    <ReactMarkdown
      components={{
        a: ({ children, href }) => allowLinks ? <a className="font-medium underline underline-offset-2" href={href} rel="noreferrer" target="_blank">{children}</a> : <span className="font-medium underline underline-offset-2">{children}</span>,
        blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-current/25 pl-3 text-muted-foreground">{children}</blockquote>,
        code: ({ children, className: codeClassName }) => <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]', codeClassName)}>{children}</code>,
        h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-semibold first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h3>,
        hr: () => <hr className="my-4 border-border" />,
        li: ({ children }) => <li className="pl-0.5">{children}</li>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
        p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
        pre: ({ children }) => <pre className="my-3 max-w-full overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[0.9em] leading-relaxed [&>code]:bg-transparent [&>code]:p-0">{children}</pre>,
        table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-left text-[0.95em]">{children}</table></div>,
        td: ({ children }) => <td className="border px-2 py-1.5 align-top">{children}</td>,
        th: ({ children }) => <th className="border bg-muted/50 px-2 py-1.5 font-semibold">{children}</th>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
      }}
      remarkPlugins={[remarkGfm]}
    >
      {content}
    </ReactMarkdown>
  </div>;
}
