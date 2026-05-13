import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Users, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_app/team")({
  component: TeamPage,
});

interface Row {
  quizId: string;
  quizTitle: string;
  collaborators: Array<{ email: string; full_name: string | null; role: string }>;
  pendingInvites: Array<{ email: string; role: string }>;
}

function TeamPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      const { data: quizzes } = await supabase
        .from("quizzes")
        .select("id,title,owner_id")
        .eq("owner_id", user.id)
        .order("updated_at", { ascending: false });

      const list = (quizzes ?? []) as any[];
      const ids = list.map((q) => q.id);
      if (ids.length === 0) { setRows([]); setLoading(false); return; }

      const [{ data: cs }, { data: ivs }] = await Promise.all([
        supabase.from("quiz_collaborators").select("quiz_id,user_id,role").in("quiz_id", ids),
        supabase.from("quiz_invites").select("quiz_id,email,role").in("quiz_id", ids),
      ]);

      const userIds = Array.from(new Set((cs ?? []).map((c: any) => c.user_id)));
      const pMap = new Map<string, { email: string; full_name: string | null }>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id,email,full_name")
          .in("id", userIds);
        (profiles ?? []).forEach((p: any) => pMap.set(p.id, { email: p.email, full_name: p.full_name }));
      }

      setRows(
        list.map((q) => ({
          quizId: q.id,
          quizTitle: q.title,
          collaborators: (cs ?? [])
            .filter((c: any) => c.quiz_id === q.id)
            .map((c: any) => ({
              email: pMap.get(c.user_id)?.email ?? c.user_id,
              full_name: pMap.get(c.user_id)?.full_name ?? null,
              role: c.role,
            })),
          pendingInvites: (ivs ?? [])
            .filter((i: any) => i.quiz_id === q.id)
            .map((i: any) => ({ email: i.email, role: i.role })),
        })),
      );
      setLoading(false);
    })();
  }, [user?.id]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground">
          People you've shared your quizzes with. Manage collaborators on each quiz's <span className="font-medium">Share</span> tab.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <h3 className="font-semibold">No quizzes yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Create a quiz, then invite collaborators from its Share tab.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const total = r.collaborators.length + r.pendingInvites.length;
            return (
              <div key={r.quizId} className="rounded-lg border bg-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{r.quizTitle}</h3>
                    <p className="text-xs text-muted-foreground">
                      {total === 0 ? "No collaborators yet" : `${total} ${total === 1 ? "person" : "people"}`}
                    </p>
                  </div>
                  <Link
                    to="/quizzes/$quizId"
                    params={{ quizId: r.quizId }}
                    className="text-sm text-primary inline-flex items-center gap-1 hover:underline"
                  >
                    Manage <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                {total === 0 ? null : (
                  <div className="flex flex-wrap gap-2">
                    {r.collaborators.map((c, i) => (
                      <span key={`c-${i}`} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs">
                        {c.full_name || c.email}
                        <span className="text-muted-foreground">· {c.role}</span>
                      </span>
                    ))}
                    {r.pendingInvites.map((i, idx) => (
                      <span key={`i-${idx}`} className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground">
                        {i.email}
                        <span>· {i.role} · pending</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
