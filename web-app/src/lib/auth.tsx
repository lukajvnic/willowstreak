import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { api } from "./api";

export type Profile = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
};

/** `null` while unknown, `'none'` when the API says 404 (no profile row yet). */
type ProfileState = Profile | "none" | null;

type Auth = {
  session: Session | null;
  /** the initial getSession() has resolved — until then, render nothing */
  ready: boolean;
  profile: ProfileState;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<ProfileState>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setProfile(null);
      return;
    }
    const res = await api("/api/me", { token });
    setProfile(res.status === 404 ? "none" : (res.data as { user: Profile }).user);
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    void refreshProfile();
  }, [session, refreshProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ session, ready, profile, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside <AuthProvider>");
  return ctx;
}
