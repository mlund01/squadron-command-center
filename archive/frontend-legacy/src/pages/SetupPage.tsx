import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

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
      <form
        className="w-full max-w-md space-y-5 rounded-xl border bg-card p-7 shadow-sm"
        onSubmit={submit}
      >
        <div>
          <p className="text-sm text-muted-foreground">Squadron Command Center</p>
          <h1 className="mt-1 text-2xl font-semibold">Set up your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Create the first administrator for this Command Center.
          </p>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <label className="block text-sm font-medium">
          Email
          <input
            autoFocus
            className="mt-1.5 w-full rounded-md border bg-transparent px-3 py-2"
            name="email"
            required
            type="email"
          />
        </label>

        <label className="block text-sm font-medium">
          Name
          <input className="mt-1.5 w-full rounded-md border bg-transparent px-3 py-2" name="name" />
        </label>

        <label className="block text-sm font-medium">
          Password
          <input
            className="mt-1.5 w-full rounded-md border bg-transparent px-3 py-2"
            maxLength={72}
            minLength={12}
            name="password"
            required
            type="password"
          />
        </label>

        <label className="block text-sm font-medium">
          Confirm password
          <input
            className="mt-1.5 w-full rounded-md border bg-transparent px-3 py-2"
            maxLength={72}
            minLength={12}
            name="passwordConfirm"
            required
            type="password"
          />
        </label>

        {setup?.requiresToken && (
          <label className="block text-sm font-medium">
            Setup token
            <input
              className="mt-1.5 w-full rounded-md border bg-transparent px-3 py-2"
              name="setupToken"
              required
              type="password"
            />
          </label>
        )}

        <button
          className="w-full rounded-md bg-primary py-2 text-primary-foreground disabled:opacity-50"
          disabled={!setup || submitting}
          type="submit"
        >
          {submitting ? 'Creating administrator…' : 'Create administrator'}
        </button>
      </form>
    </main>
  );
}
