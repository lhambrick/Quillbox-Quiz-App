import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Plus, FileText, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

interface QuizRow {
  id: string;
  title: string;
  description: string | null;
  is_published: boolean;
  updated_at: string;
  owner_id: string;
  question_count: number;
  submission_count: number;
  is_shared: boolean;
  owner_email?: string | null;
}

function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: qs, error } = await supabase
      .from("quizzes")
      .select("id,title,description,is_published,updated_at,owner_id")
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const list = qs ?? [];
    // counts
    const ids = list.map((q) => q.id);
    const [{ data: qCounts }, { data: sCounts }, { data: profiles }] = await Promise.all([
      ids.length
        ? supabase.from("questions").select("quiz_id").in("quiz_id", ids)
        : Promise.resolve({ data: [] as any[] }),
      ids.length
        ? supabase.from("submissions").select("quiz_id").in("quiz_id", ids)
        : Promise.resolve({ data: [] as any[] }),
      list.length
        ? supabase
            .from("profiles")
            .select("id,email")
            .in("id", Array.from(new Set(list.map((q) => q.owner_id))))
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const qMap = new Map<string, number>();
    (qCounts ?? []).forEach((r: any) => qMap.set(r.quiz_id, (qMap.get(r.quiz_id) ?? 0) + 1));
    const sMap = new Map<string, number>();
    (sCounts ?? []).forEach((r: any) => sMap.set(r.quiz_id, (sMap.get(r.quiz_id) ?? 0) + 1));
    const pMap = new Map<string, string>();
    (profiles ?? []).forEach((p: any) => pMap.set(p.id, p.email));

    setQuizzes(
      list.map((q) => ({
        ...q,
        question_count: qMap.get(q.id) ?? 0,
        submission_count: sMap.get(q.id) ?? 0,
        is_shared: q.owner_id !== user.id,
        owner_email: pMap.get(q.owner_id) ?? null,
      })),
    );
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const createQuiz = async () => {
    if (!user) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("quizzes")
      .insert({ owner_id: user.id, title: "Untitled Quiz" })
      .select("id")
      .single();
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    navigate({ to: "/quizzes/$quizId", params: { quizId: data.id } });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Your quizzes</h1>
          <p className="text-sm text-muted-foreground">Create and manage your branded assessments</p>
        </div>
        <Button onClick={createQuiz} disabled={creating}>
          <Plus className="h-4 w-4 mr-2" />
          {creating ? "Creating…" : "New quiz"}
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : quizzes.length === 0 ? (
        <EmptyState onCreate={createQuiz} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quizzes.map((q) => (
            <Link
              key={q.id}
              to="/quizzes/$quizId"
              params={{ quizId: q.id }}
              className="rounded-lg border bg-card p-5 hover:border-primary/40 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between">
                <h3 className="font-semibold leading-tight line-clamp-2">{q.title}</h3>
                <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${q.is_published ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                  {q.is_published ? "Live" : "Draft"}
                </span>
              </div>
              {q.description ? (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{q.description}</p>
              ) : null}
              <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{q.question_count} q</span>
                <span className="flex items-center gap-1"><UsersIcon className="h-3.5 w-3.5" />{q.submission_count} subs</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Edited {formatDistanceToNow(new Date(q.updated_at), { addSuffix: true })}</span>
                {q.is_shared && q.owner_email ? (
                  <span className="rounded bg-accent text-accent-foreground px-1.5 py-0.5">Shared by {q.owner_email}</span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <h3 className="font-semibold">No quizzes yet</h3>
      <p className="text-sm text-muted-foreground mt-1">Create your first assessment to start qualifying leads.</p>
      <Button onClick={onCreate} className="mt-4">
        <Plus className="h-4 w-4 mr-2" />Create quiz
      </Button>
    </div>
  );
}
