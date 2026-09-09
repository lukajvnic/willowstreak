import { useState } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

/** Signed out, or signed in without a profile row yet — everything before the
 * app proper. Supabase Auth owns credentials; POST /api/me owns the profile. */
export default function AuthGate() {
  const { session, profile } = useAuth();

  return (
    <main className="page auth-page">
      <h1 className="wordmark">willo</h1>
      <div className="auth-card">
        {session && profile === "none" ? <PickUsername /> : <SignedOut />}
      </div>
    </main>
  );
}

function SignedOut() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  return (
    <>
      <div className="auth-tabs">
        <button type="button" data-active={mode === "login"} onClick={() => setMode("login")}>
          log in
        </button>
        <button type="button" data-active={mode === "signup"} onClick={() => setMode("signup")}>
          sign up
        </button>
      </div>
      {mode === "login" ? <LoginForm /> : <SignupForm />}
    </>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
    // success: onAuthStateChange flips the session and the gate unmounts
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-row">
        <span>email</span>
        <input
          className="new-input"
          type="email"
          value={email}
          autoComplete="username"
          required
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="auth-row">
        <span>password</span>
        <input
          className="new-input"
          type="password"
          value={password}
          autoComplete="current-password"
          required
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button className="auth-submit" type="submit" disabled={busy}>
        {busy ? "working…" : "log in"}
      </button>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function SignupForm() {
  const { refreshProfile } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    // 1. Supabase Auth owns the credential.
    const { data, error: err } = await supabase.auth.signUp({ email, password });
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }

    // 2. The profile row is ours, and needs a session to write.
    if (!data.session) {
      setBusy(false);
      setNotice("signed up — confirm your email, then log in to pick a username.");
      return;
    }

    const res = await api("/api/me", {
      method: "POST",
      token: data.session.access_token,
      body: { username, first_name: firstName, last_name: lastName },
    });
    setBusy(false);
    if (!res.ok) {
      setError(`profile not created (${res.status})`);
      return;
    }
    await refreshProfile();
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="auth-row">
        <span>email</span>
        <input
          className="new-input"
          type="email"
          value={email}
          autoComplete="email"
          required
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="auth-row">
        <span>password</span>
        <input
          className="new-input"
          type="password"
          value={password}
          autoComplete="new-password"
          minLength={6}
          required
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className="auth-row">
        <span>username</span>
        <input
          className="new-input"
          value={username}
          pattern="[a-z0-9_]{2,20}"
          title="2-20 chars: a-z, 0-9, underscore"
          required
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
        />
      </label>
      <label className="auth-row">
        <span>first name</span>
        <input
          className="new-input"
          value={firstName}
          required
          onChange={(e) => setFirstName(e.target.value)}
        />
      </label>
      <label className="auth-row">
        <span>last name</span>
        <input
          className="new-input"
          value={lastName}
          required
          onChange={(e) => setLastName(e.target.value)}
        />
      </label>
      <button className="auth-submit" type="submit" disabled={busy}>
        {busy ? "working…" : "sign up"}
      </button>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="auth-notice">{notice}</p>}
    </form>
  );
}

/** Logged in (e.g. after email confirmation) but GET /api/me is a 404. */
function PickUsername() {
  const { session, refreshProfile, signOut } = useAuth();
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    setError("");
    const res = await api("/api/me", {
      method: "POST",
      token: session.access_token,
      body: { username, first_name: firstName, last_name: lastName },
    });
    setBusy(false);
    if (!res.ok) {
      setError(`profile not created (${res.status})`);
      return;
    }
    await refreshProfile();
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <p className="auth-notice">almost there — pick a username.</p>
      <label className="auth-row">
        <span>username</span>
        <input
          className="new-input"
          value={username}
          pattern="[a-z0-9_]{2,20}"
          title="2-20 chars: a-z, 0-9, underscore"
          required
          autoFocus
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
        />
      </label>
      <label className="auth-row">
        <span>first name</span>
        <input
          className="new-input"
          value={firstName}
          required
          onChange={(e) => setFirstName(e.target.value)}
        />
      </label>
      <label className="auth-row">
        <span>last name</span>
        <input
          className="new-input"
          value={lastName}
          required
          onChange={(e) => setLastName(e.target.value)}
        />
      </label>
      <button className="auth-submit" type="submit" disabled={busy}>
        {busy ? "working…" : "create profile"}
      </button>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <button className="auth-alt" type="button" onClick={() => void signOut()}>
        use a different account
      </button>
    </form>
  );
}
