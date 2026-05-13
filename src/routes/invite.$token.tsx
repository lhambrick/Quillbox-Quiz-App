import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/invite/$token")({
  component: AcceptInvite,
});

interface InviteRow {
  id: string;
  quiz_id: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  expires_at: string;
  quiz_title?: string;
}

function AcceptInvite() {
  const { token } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InviteRow | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "expired" | "notfound" | "wrongemail" | "accepted" | "accepting">("loading");

  useEffect(() => {
    // Persist the token so signup/login can redirect back here after auth.
    try { localStorage.setItem("pendingInviteToken", token); } catch {}
    (async () => {
      const { data } = await supabase
        .from("quiz_invites")
        .select("id,quiz_id,email,role,expires_at, quizzes(title)")
        .eq("token", token)
        .maybeSingle();
      if (!data) { setStatus("notfound"); return; }
      const inv: InviteRow = {
        id: (data as any).id,
        quiz_id: (data as any).quiz_id,
        email: (data as any).email,
        role: (data as any).role,
        expires_at: (data as any).expires_at,
        quiz_title: (data as any).quizzes?.title,
      };
      setInvite(inv);
      if (new Date(inv.expires_at) < new Date()) { setStatus("expired"); return; }
      setStatus("ready");
    })();
  }, [token]);

  const accept = async () => {
    if (!invite || !user) return;
    if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      setStatus("wrongemail");
      return;
    }
    setStatus("accepting");
    try {
      const { error } = await supabase.rpc("accept_quiz_invite", { _token: token });
      if (error) throw error;
      try { localStorage.removeItem("pendingInviteToken"); } catch {}
      setStatus("accepted");
      toast.success("Invite accepted");
      setTimeout(() => navigate({ to: "/quizzes/$quizId", params: { quizId: invite.quiz_id } }), 800);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to accept");
      setStatus("ready");
    }
  };

  // Auto-accept as soon as the user becomes authenticated with the invited email.
  useEffect(() => {
    if (status === "ready" && user && invite && user.email?.toLowerCase() === invite.email.toLowerCase()) {
      void accept();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, invite, status]);

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="max-w-md w-full rounded-lg border bg-card p-8 text-center space-y-4">
        {status === "loading" || authLoading ? (
          <p className="text-sm text-muted-foreground">Loading invite…</p>
        ) : status === "notfound" ? (
          <>
            <h1 className="text-xl font-semibold">Invite not found</h1>
            <p className="text-sm text-muted-foreground">This invite link is invalid or has been revoked.</p>
            <Link to="/dashboard" className="text-sm text-primary">Go to dashboard</Link>
          </>
        ) : status === "expired" ? (
          <>
            <h1 className="text-xl font-semibold">Invite expired</h1>
            <p className="text-sm text-muted-foreground">Ask the quiz owner to send you a new invite.</p>
          </>
        ) : status === "wrongemail" && invite ? (
          <>
            <h1 className="text-xl font-semibold">Wrong account</h1>
            <p className="text-sm text-muted-foreground">
              This invite was sent to <span className="font-mono">{invite.email}</span>, but you're signed in as <span className="font-mono">{user?.email}</span>.
            </p>
            <Button onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}>
              Sign in with the right account
            </Button>
          </>
        ) : status === "accepted" ? (
          <>
            <h1 className="text-xl font-semibold">You're in!</h1>
            <p className="text-sm text-muted-foreground">Redirecting…</p>
          </>
        ) : invite ? (
          <>
            <h1 className="text-xl font-semibold">Join "{invite.quiz_title ?? "this quiz"}"</h1>
            <p className="text-sm text-muted-foreground">
              You've been invited as <span className="font-medium capitalize">{invite.role}</span>.
            </p>
            {!user ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Sign in or create an account with <span className="font-mono">{invite.email}</span> to accept.</p>
                <div className="flex gap-2 justify-center">
                  <Link to="/login"><Button variant="outline" size="sm">Sign in</Button></Link>
                  <Link to="/signup"><Button size="sm">Create account</Button></Link>
                </div>
              </div>
            ) : (
              <Button onClick={accept} disabled={status === "accepting" as any}>
                {status === "accepting" as any ? "Accepting…" : "Accept invite"}
              </Button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
