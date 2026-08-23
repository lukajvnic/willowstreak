import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { api, API_URL } from './lib/api'

type LogLine = { id: number; at: string; text: string; detail?: string }

/** Profile is `null` while unknown, `'none'` when the API says 404 (no profile yet). */
type Profile = Record<string, unknown> | 'none' | null

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile>(null)
  const [log, setLog] = useState<LogLine[]>([])
  const logId = useRef(0)

  const say = useCallback((text: string, detail?: unknown) => {
    logId.current += 1
    setLog((prev) => [
      {
        id: logId.current,
        at: new Date().toLocaleTimeString(),
        text,
        detail: detail === undefined ? undefined : JSON.stringify(detail, null, 2),
      },
      ...prev,
    ])
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      say(`auth event: ${event}`)
      setSession(next)
    })
    return () => sub.subscription.unsubscribe()
  }, [say])

  const loadProfile = useCallback(
    async (token: string) => {
      const res = await api('/api/me', { token })
      say(`GET /api/me -> ${res.status}`, res.data)
      setProfile(res.status === 404 ? 'none' : (res.data as { user: Record<string, unknown> }).user)
    },
    [say],
  )

  useEffect(() => {
    if (!session) {
      setProfile(null)
      return
    }
    void loadProfile(session.access_token)
  }, [session, loadProfile])

  if (!ready) return <p>loading…</p>

  return (
    <main>
      <h1>willo auth test</h1>
      <p>
        api: <code>{API_URL}</code>
      </p>
      <hr />

      {!session && <SignedOut say={say} />}

      {session && profile === 'none' && (
        <CreateProfile
          token={session.access_token}
          say={say}
          onCreated={() => loadProfile(session.access_token)}
        />
      )}

      {session && profile && profile !== 'none' && (
        <SignedIn session={session} profile={profile} say={say} />
      )}

      <hr />
      <Log log={log} onClear={() => setLog([])} />
    </main>
  )
}

/* ---------------------------------------------------------------- signed out */

function SignedOut({ say }: { say: (t: string, d?: unknown) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')

  return (
    <section>
      <nav>
        <button onClick={() => setMode('login')} disabled={mode === 'login'}>
          Log in
        </button>{' '}
        <button onClick={() => setMode('signup')} disabled={mode === 'signup'}>
          Sign up
        </button>
      </nav>
      {mode === 'login' ? <LoginForm say={say} /> : <SignupForm say={say} />}
    </section>
  )
}

function LoginForm({ say }: { say: (t: string, d?: unknown) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (err) {
      setError(err.message)
      say(`login failed: ${err.message}`)
      return
    }
    say('login ok', { user: data.user?.id })
  }

  return (
    <form onSubmit={submit}>
      <h2>Log in</h2>
      <p>
        <label>
          Email
          <br />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
      </p>
      <p>
        <label>
          Password
          <br />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
      </p>
      <button type="submit" disabled={busy}>
        {busy ? 'working…' : 'Log in'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}

function SignupForm({ say }: { say: (t: string, d?: unknown) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')

    // 1. Supabase Auth owns the credential.
    const { data, error: err } = await supabase.auth.signUp({ email, password })
    if (err) {
      setBusy(false)
      setError(err.message)
      say(`signup failed: ${err.message}`)
      return
    }
    say('supabase signUp ok', { user: data.user?.id, session: Boolean(data.session) })

    // 2. The profile row is ours, and needs a session to write.
    if (!data.session) {
      setBusy(false)
      setNotice('Signed up. Confirm your email, then log in — you will be asked for a username.')
      return
    }

    const res = await api('/api/me', {
      method: 'POST',
      token: data.session.access_token,
      body: { username, first_name: firstName, last_name: lastName },
    })
    setBusy(false)
    say(`POST /api/me -> ${res.status}`, res.data)
    if (!res.ok) setError(`profile not created (${res.status}) — see log`)
  }

  return (
    <form onSubmit={submit}>
      <h2>Sign up</h2>
      <p>
        <label>
          Email
          <br />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
      </p>
      <p>
        <label>
          Password
          <br />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </label>
      </p>
      <p>
        <label>
          Username
          <br />
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            pattern="[a-z0-9_]{2,20}"
            title="2-20 chars: a-z, 0-9, underscore"
            required
          />
        </label>
      </p>
      <p>
        <label>
          First name
          <br />
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </label>
      </p>
      <p>
        <label>
          Last name (optional)
          <br />
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>
      </p>
      <button type="submit" disabled={busy}>
        {busy ? 'working…' : 'Sign up'}
      </button>
      {error && <p role="alert">{error}</p>}
      {notice && <p>{notice}</p>}
    </form>
  )
}

/* ------------------------------------------------------------- signed in */

/** Reached when GET /api/me returns 404 — an auth user with no profile row yet. */
function CreateProfile({
  token,
  say,
  onCreated,
}: {
  token: string
  say: (t: string, d?: unknown) => void
  onCreated: () => void
}) {
  const [username, setUsername] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await api('/api/me', {
      method: 'POST',
      token,
      body: { username, first_name: firstName, last_name: lastName },
    })
    setBusy(false)
    say(`POST /api/me -> ${res.status}`, res.data)
    if (res.ok) onCreated()
    else setError(res.status === 409 ? 'Username taken' : `Failed (${res.status}) — see log`)
  }

  return (
    <section>
      <h2>Pick a username</h2>
      <p>Logged in, but there is no profile row yet.</p>
      <form onSubmit={submit}>
        <p>
          <label>
            Username
            <br />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              pattern="[a-z0-9_]{2,20}"
              required
            />
          </label>
        </p>
        <p>
          <label>
            First name
            <br />
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </label>
        </p>
        <p>
          <label>
            Last name (optional)
            <br />
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
        </p>
        <button type="submit" disabled={busy}>
          {busy ? 'working…' : 'Create profile'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      <button onClick={() => supabase.auth.signOut()}>Log out</button>
    </section>
  )
}

function SignedIn({
  session,
  profile,
  say,
}: {
  session: Session
  profile: Record<string, unknown>
  say: (t: string, d?: unknown) => void
}) {
  async function checkStats() {
    const res = await api('/api/me/stats', { token: session.access_token })
    say(`GET /api/me/stats -> ${res.status}`, res.data)
  }

  return (
    <section>
      <h2>Logged in as @{String(profile.username)}</h2>
      <pre>{JSON.stringify(profile, null, 2)}</pre>
      <p>
        <button onClick={checkStats}>GET /api/me/stats</button>{' '}
        <button onClick={() => supabase.auth.signOut()}>Log out</button>
      </p>
      <details>
        <summary>access token</summary>
        <pre>{session.access_token}</pre>
      </details>
    </section>
  )
}

/* -------------------------------------------------------------------- log */

function Log({ log, onClear }: { log: LogLine[]; onClear: () => void }) {
  return (
    <section>
      <h2>Log</h2>
      <button onClick={onClear}>clear</button>
      {log.length === 0 && <p>nothing yet</p>}
      <ul>
        {log.map((line) => (
          <li key={line.id}>
            <code>
              {line.at} {line.text}
            </code>
            {line.detail && <pre>{line.detail}</pre>}
          </li>
        ))}
      </ul>
    </section>
  )
}
