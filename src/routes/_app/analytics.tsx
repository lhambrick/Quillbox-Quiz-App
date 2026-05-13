import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { BarChart3, FileText, Users as UsersIcon, TrendingUp, MousePointerClick } from "lucide-react";

export const Route = createFileRoute("/_app/analytics")({
  component: AnalyticsPage,
});

interface QuizOpt {
  id: string;
  title: string;
}

interface Stats {
  totalSubs: number;
  completedSubs: number;
  avgScore: number;
  avgPct: number;
  completionRate: number;
  bookingClicks: number;
  bookingRate: number;
  byTier: Array<{ name: string; count: number; color?: string }>;
  byDay: Array<{ date: string; count: number }>;
  perQuestion: Array<{
    id: string;
    text: string;
    type: string;
    avgPoints: number;
    maxPoints: number;
    optionCounts: Array<{ label: string; text: string; count: number }>;
  }>;
}

const RANGE_DAYS: Record<string, number> = { "7": 7, "30": 30, "90": 90, all: 10000 };

function AnalyticsPage() {
  const { user } = useAuth();
  const [quizzes, setQuizzes] = useState<QuizOpt[]>([]);
  const [quizId, setQuizId] = useState<string>("all");
  const [range, setRange] = useState<string>("30");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("quizzes")
        .select("id,title")
        .order("updated_at", { ascending: false });
      setQuizzes((data ?? []) as any);
    })();
  }, [user?.id]);

  useEffect(() => {
    void loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId, range]);

  async function loadStats() {
    setLoading(true);
    try {
      const days = RANGE_DAYS[range] ?? 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      // Submissions
      let subQ = supabase
        .from("submissions")
        .select("id,quiz_id,total_score,max_score,percentage,tier_id,started_at,completed_at")
        .gte("started_at", since);
      if (quizId !== "all") subQ = subQ.eq("quiz_id", quizId);
      const { data: subs, error: subErr } = await subQ;
      if (subErr) throw subErr;
      const subList = (subs ?? []) as any[];

      // Tiers
      let tierQ = supabase.from("result_tiers").select("id,name,quiz_id");
      if (quizId !== "all") tierQ = tierQ.eq("quiz_id", quizId);
      const { data: tiers } = await tierQ;
      const tierMap = new Map<string, string>();
      (tiers ?? []).forEach((t: any) => tierMap.set(t.id, t.name));

      // Booking clicks
      const subIds = subList.map((s) => s.id);
      let clickCount = 0;
      if (subIds.length > 0) {
        const { count } = await supabase
          .from("booking_clicks")
          .select("id", { count: "exact", head: true })
          .in("submission_id", subIds);
        clickCount = count ?? 0;
      }

      // Per-question stats (only when a single quiz is selected)
      const perQuestion: Stats["perQuestion"] = [];
      if (quizId !== "all" && subIds.length > 0) {
        const { data: qs } = await supabase
          .from("questions")
          .select("id,text,type,options")
          .eq("quiz_id", quizId)
          .order("order_index");
        const { data: ans } = await supabase
          .from("submission_answers")
          .select("question_id,answer_value,points_earned")
          .in("submission_id", subIds);
        const ansList = (ans ?? []) as any[];
        const byQ = new Map<string, any[]>();
        ansList.forEach((a) => {
          const arr = byQ.get(a.question_id) ?? [];
          arr.push(a);
          byQ.set(a.question_id, arr);
        });
        (qs ?? []).forEach((q: any) => {
          if (q.type === "category_description") return;
          const arr = byQ.get(q.id) ?? [];
          const opts: Array<{ label: string; text: string; points?: number | null }> = q.options ?? [];
          const maxPts = opts.reduce((m, o, i) => {
            const fallback = i + 1;
            const pts = typeof o.points === "number" ? o.points : fallback;
            return Math.max(m, pts);
          }, 0);
          const avgPts = arr.length
            ? arr.reduce((s, a) => s + Number(a.points_earned ?? 0), 0) / arr.length
            : 0;
          const counts = new Map<string, number>();
          arr.forEach((a) => {
            const label = String(a.answer_value ?? "").split(":")[0].trim();
            if (!label) return;
            counts.set(label, (counts.get(label) ?? 0) + 1);
          });
          perQuestion.push({
            id: q.id,
            text: q.text || "(untitled)",
            type: q.type,
            avgPoints: avgPts,
            maxPoints: maxPts,
            optionCounts: opts.map((o) => ({
              label: o.label,
              text: o.text,
              count: counts.get(o.label) ?? 0,
            })),
          });
        });
      }

      // Aggregate
      const completed = subList.filter((s) => s.completed_at);
      const totalSubs = subList.length;
      const completedSubs = completed.length;
      const completionRate = totalSubs > 0 ? Math.round((completedSubs / totalSubs) * 100) : 0;
      const avgScore = completed.length
        ? completed.reduce((a, s) => a + Number(s.total_score ?? 0), 0) / completed.length
        : 0;
      const avgPct = completed.length
        ? completed.reduce((a, s) => a + Number(s.percentage ?? 0), 0) / completed.length
        : 0;
      const bookingRate = completedSubs > 0 ? Math.round((clickCount / completedSubs) * 100) : 0;

      const tierCounts = new Map<string, number>();
      completed.forEach((s) => {
        const name = (s.tier_id && tierMap.get(s.tier_id)) || "No tier";
        tierCounts.set(name, (tierCounts.get(name) ?? 0) + 1);
      });
      const byTier = Array.from(tierCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      const dayCounts = new Map<string, number>();
      const dayWindow = Math.min(days, 90);
      for (let i = dayWindow - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        dayCounts.set(d.toISOString().slice(0, 10), 0);
      }
      completed.forEach((s) => {
        const d = String(s.completed_at).slice(0, 10);
        if (dayCounts.has(d)) dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
      });
      const byDay = Array.from(dayCounts.entries()).map(([date, count]) => ({ date, count }));

      setStats({
        totalSubs,
        completedSubs,
        avgScore,
        avgPct,
        completionRate,
        bookingClicks: clickCount,
        bookingRate,
        byTier,
        byDay,
        perQuestion,
      });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground">Submission trends, tier breakdown, and per-question stats.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={quizId}
            onChange={(e) => setQuizId(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="all">All quizzes</option>
            {quizzes.map((q) => (
              <option key={q.id} value={q.id}>{q.title}</option>
            ))}
          </select>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>

      {loading || !stats ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : stats.totalSubs === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <BarChart3 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <h3 className="font-semibold">No submissions in this range</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Once people start completing your quiz, you'll see trends and breakdowns here.
          </p>
          <Link to="/dashboard" className="text-sm text-primary inline-block mt-3">Back to dashboard</Link>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat icon={<UsersIcon className="h-4 w-4" />} label="Submissions" value={stats.totalSubs.toString()} sub={`${stats.completedSubs} completed`} />
            <Stat icon={<TrendingUp className="h-4 w-4" />} label="Completion rate" value={`${stats.completionRate}%`} />
            <Stat icon={<FileText className="h-4 w-4" />} label="Avg score" value={`${stats.avgScore.toFixed(1)}`} sub={`${stats.avgPct.toFixed(0)}% avg`} />
            <Stat icon={<MousePointerClick className="h-4 w-4" />} label="Booking clicks" value={stats.bookingClicks.toString()} sub={`${stats.bookingRate}% of completions`} />
          </div>

          <Card title="Submissions over time">
            <Sparkline data={stats.byDay} />
          </Card>

          <Card title="Tier breakdown">
            <TierBars items={stats.byTier} total={stats.completedSubs} />
          </Card>

          {quizId === "all" ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Select a specific quiz above to see per-question stats.
            </div>
          ) : stats.perQuestion.length === 0 ? null : (
            <Card title="Per-question stats">
              <div className="space-y-5">
                {stats.perQuestion.map((q) => (
                  <div key={q.id} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="font-medium text-sm">{q.text}</div>
                      {q.type === "multiple_choice" && q.maxPoints > 0 && (
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          avg {q.avgPoints.toFixed(1)} / {q.maxPoints} pts
                        </div>
                      )}
                    </div>
                    {q.type === "multiple_choice" ? (
                      <OptionBars options={q.optionCounts} />
                    ) : (
                      <div className="text-xs text-muted-foreground">Free-text answers — view in submissions tab.</div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Sparkline({ data }: { data: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div>
      <div className="flex items-end gap-0.5 h-32">
        {data.map((d) => (
          <div
            key={d.date}
            className="flex-1 bg-primary/70 hover:bg-primary rounded-t transition"
            style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 2 : 0 }}
            title={`${d.date}: ${d.count}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function TierBars({ items, total }: { items: Array<{ name: string; count: number }>; total: number }) {
  if (items.length === 0) return <div className="text-sm text-muted-foreground">No tier data yet.</div>;
  return (
    <div className="space-y-2">
      {items.map((t) => {
        const pct = total > 0 ? Math.round((t.count / total) * 100) : 0;
        return (
          <div key={t.name}>
            <div className="flex justify-between text-xs mb-0.5">
              <span>{t.name}</span>
              <span className="text-muted-foreground">{t.count} ({pct}%)</span>
            </div>
            <div className="h-2 rounded bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OptionBars({ options }: { options: Array<{ label: string; text: string; count: number }> }) {
  const total = options.reduce((s, o) => s + o.count, 0);
  return (
    <div className="space-y-1.5">
      {options.map((o) => {
        const pct = total > 0 ? Math.round((o.count / total) * 100) : 0;
        return (
          <div key={o.label} className="flex items-center gap-2 text-xs">
            <span className="w-6 font-mono text-muted-foreground">{o.label}</span>
            <span className="flex-1 truncate">{o.text}</span>
            <div className="w-32 h-1.5 rounded bg-muted overflow-hidden shrink-0">
              <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-14 text-right tabular-nums text-muted-foreground">{o.count} ({pct}%)</span>
          </div>
        );
      })}
    </div>
  );
}
