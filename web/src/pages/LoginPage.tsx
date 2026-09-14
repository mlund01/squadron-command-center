import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type LoginConfig = {
  csrfToken: string;
  identityLabel: string;
  identityType: 'email' | 'text';
};

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const [config, setConfig] = useState<LoginConfig | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function initializeLogin() {
      try {
        const response = await fetch('/api/auth/login');
        if (!response.ok) {
          throw new Error('Unable to initialize login.');
        }
        setConfig((await response.json()) as LoginConfig);
      } catch (initializeError) {
        setError(initializeError instanceof Error ? initializeError.message : 'Unable to initialize login.');
      }
    }
    void initializeLogin();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || submitting) return;

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: form.get('identity'),
          password: form.get('password'),
          csrfToken: config.csrfToken,
          next: searchParams.get('next') ?? '/',
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; next?: string };
      if (!response.ok) {
        setError(body.error ?? 'Unable to sign in.');
        return;
      }
      window.location.assign(body.next ?? '/');
    } catch {
      setError('Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="brand-label text-sm">SQUADRON / COMMAND CENTER</p>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>Continue to your Command Center and workspaces.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={submit}>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <label className="grid gap-1.5 text-sm font-medium">
              {config?.identityLabel ?? 'Email'}
              <Input
                autoComplete={config?.identityType === 'email' ? 'email' : 'username'}
                autoFocus
                name="identity"
                required
                type={config?.identityType ?? 'email'}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Password
              <Input autoComplete="current-password" maxLength={72} name="password" required type="password" />
            </label>
            <Button className="w-full" disabled={!config || submitting} type="submit">
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
