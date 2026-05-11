import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Confirming your email…");

  useEffect(() => {
    let cancelled = false;

    const finish = (to: string, params?: Record<string, string>) => {
      if (cancelled) return;
      // Clean the URL so tokens don't linger
      try {
        window.history.replaceState({}, "", window.location.pathname);
      } catch {}
      if (to === "/invite/$token" && params?.token) {
        navigate({ to: "/invite/$token", params: { token: params.token } });
      } else {
        navigate({ to: to as any });
      }
    };

    const route = (hasSession: boolean) => {
      const pending = (() => {
        try {
          return localStorage.getItem("pendingInviteToken");
        } catch {
          return null;
        }
      })();
      if (hasSession) {
        if (pending) finish("/invite/$token", { token: pending });
        else finish("/dashboard");
      } else {
        // Couldn't establish a session — send them to login so they can sign in
        finish("/login");
      }
    };

    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const errorDesc =
          url.searchParams.get("error_description") ||
          new URLSearchParams(window.location.hash.replace(/^#/, "")).get(
            "error_description"
          );

        if (errorDesc) {
          setMessage(errorDesc);
          setTimeout(() => finish("/login"), 1500);
          return;
        }

        // PKCE / magic-link style: ?code=...
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(
            window.location.href
          );
          if (error) {
            setMessage(error.message);
            setTimeout(() => finish("/login"), 1500);
            return;
          }
        }

        // Implicit flow leaves tokens in the hash; getSession picks them up.
        const { data } = await supabase.auth.getSession();
        route(!!data.session);
      } catch (e: any) {
        setMessage(e?.message ?? "Something went wrong");
        setTimeout(() => finish("/login"), 1500);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-background">
      <div className="text-sm text-muted-foreground">{message}</div>
    </div>
  );
}
