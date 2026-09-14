import { useEffect, useState } from 'react';
import type { ComponentProps, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type SetupState = {
  claimed: boolean;
  csrfToken: string;
  requiresToken: boolean;
};

type SetupError = {
  error?: string;
};

export function SetupPage() {
  const navigate = useNavigate();
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadSetup() {
      try {
        const response = await fetch('/api/setup');
        if (!response.ok) {
          throw new Error('Unable to start setup. Please try again.');
        }

        const status = (await response.json()) as SetupState;
        if (status.claimed) {
          navigate('/', { replace: true });
          return;
        }

        setSetup(status);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to start setup. Please try again.',
        );
      }
    }

    void loadSetup();
  }, [navigate]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setup || submitting) {
      return;
    }

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          name: form.get('name'),
          password: form.get('password'),
          passwordConfirm: form.get('passwordConfirm'),
          setupToken: form.get('setupToken'),
          csrfToken: setup.csrfToken,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as SetupError;
        setError(body.error ?? 'Unable to complete setup. Please try again.');
        return;
      }

      navigate('/', { replace: true });
    } catch {
      setError('Unable to complete setup. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="brand-label text-sm">SQUADRON / COMMAND CENTER</p>
          <CardTitle className="text-2xl">Set up your workspace</CardTitle>
          <CardDescription>Create the first administrator for this Command Center.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={submit}>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <SetupField autoFocus label="Email" name="email" required type="email" />
            <SetupField autoComplete="name" label="Name" name="name" />
            <SetupField
              autoComplete="new-password"
              label="Password"
              maxLength={72}
              minLength={12}
              name="password"
              required
              type="password"
            />
            <SetupField
              autoComplete="new-password"
              label="Confirm password"
              maxLength={72}
              minLength={12}
              name="passwordConfirm"
              required
              type="password"
            />

            {setup?.requiresToken && (
              <SetupField label="Setup token" name="setupToken" required type="password" />
            )}

            <Button className="w-full" disabled={!setup || submitting} type="submit">
              {submitting ? 'Creating administrator…' : 'Create administrator'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

type SetupFieldProps = ComponentProps<typeof Input> & { label: string };

function SetupField({ label, ...props }: SetupFieldProps) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <Input {...props} />
    </label>
  );
}
