import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Eye, Trash2, Download } from "lucide-react";
import { pickTier, type Tier } from "@/lib/scoring";
import * as XLSX from "xlsx";

interface Submission {
  id: string;
  prospect_name: string;
  prospect_email: string;
  prospect_company: string | null;
  total_score: number;
  max_score: number;
  percentage: number;
  tier_id: string | null;
  completed_at: string | null;
  custom_fields: any;
}

export function SubmissionsTab({ quizId }: { quizId: string }) {
  const [subs, setSubs] = useState<Submission[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => { void load(); }, [quizId]);

  async function load() {
    setLoading(true);
    const [{ data: s, error }, { data: t }] = await Promise.all([
      supabase.from("submissions").select("*").eq("quiz_id", quizId).order("completed_at", { ascending: false }),
      supabase.from("result_tiers").select("*").eq("quiz_id", quizId),
    ]);
    if (error) toast.error(error.message);
    setSubs((s ?? []) as any);
    setTiers((t ?? []) as any);
    setLoading(false);
  }

  const onDelete = async (id: string) => {
    if (!confirm("Delete this submission? This cannot be undone.")) return;
    const { error } = await supabase.from("submissions").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setSubs((prev) => prev.filter((s) => s.id !== id));
    toast.success("Submission deleted");
  };

  const exportXlsx = async () => {
    // Fetch the questions (ordered) and every answer for this quiz's submissions.
    const [{ data: qs }, { data: answers }] = await Promise.all([
      supabase
        .from("questions")
        .select("id,text,type,options,order_index")
        .eq("quiz_id", quizId)
        .order("order_index"),
      supabase
        .from("submission_answers")
        .select("submission_id,question_id,answer_value")
        .in("submission_id", subs.map((s) => s.id)),
    ]);

    const questions = (qs ?? []) as Array<{
      id: string; text: string; type: string;
      options: Array<{ label: string; text: string }>; order_index: number;
    }>;

    // Index answers by submission + question for quick lookup.
    const ansBy = new Map<string, string>();
    for (const a of (answers ?? []) as any[]) {
      ansBy.set(`${a.submission_id}::${a.question_id}`, a.answer_value ?? "");
    }

    // ---- Sheet 1: Submissions (one row per submission, Q1..Qn columns) ----
    const subHeaders = [
      "Date", "Name", "Email", "Company", "Score", "Max", "Percentage", "Tier",
      ...questions.map((_, i) => `Q${i + 1}`),
      "Custom Fields",
    ];
    const subRows = subs.map((s) => {
      const tier = tiers.find((t) => t.id === s.tier_id) ?? pickTier(tiers, s.total_score, s.percentage);
      const qCols = questions.map((q) => {
        const raw = ansBy.get(`${s.id}::${q.id}`) ?? "";
        if (q.type === "multiple_choice" && raw) {
          // Stored as "A" or "A: custom text" — keep just the letter for the grid.
          return String(raw).split(":")[0].trim();
        }
        return raw;
      });
      return [
        s.completed_at ? new Date(s.completed_at).toISOString() : "",
        s.prospect_name,
        s.prospect_email,
        s.prospect_company ?? "",
        s.total_score,
        s.max_score,
        s.percentage,
        tier?.name ?? "",
        ...qCols,
        s.custom_fields ? JSON.stringify(s.custom_fields) : "",
      ];
    });
    const ws1 = XLSX.utils.aoa_to_sheet([subHeaders, ...subRows]);

    // ---- Sheet 2: Questions key (Question #, Question text, Option A..) ----
    const maxOptions = questions.reduce((m, q) => Math.max(m, q.options?.length ?? 0), 0);
    const optionLetters = Array.from({ length: maxOptions }, (_, i) =>
      `Option ${String.fromCharCode(65 + i)}`,
    );
    const qHeaders = ["Question #", "Question text", "Type", ...optionLetters];
    const qRows = questions.map((q, i) => {
      const opts = (q.options ?? []).map((o) => o?.text ?? "");
      while (opts.length < maxOptions) opts.push("");
      return [`Q${i + 1}`, q.text, q.type, ...opts];
    });
    const ws2 = XLSX.utils.aoa_to_sheet([qHeaders, ...qRows]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Submissions");
    XLSX.utils.book_append_sheet(wb, ws2, "Questions");
    XLSX.writeFile(wb, `submissions-${quizId}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  if (subs.length === 0) {
    return <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">No submissions yet.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={exportXlsx}>
          <Download className="h-3.5 w-3.5 mr-1.5" />Export Excel
        </Button>
      </div>
      <div className="rounded-lg border bg-card overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left p-3">Date</th>
            <th className="text-left p-3">Name</th>
            <th className="text-left p-3">Email</th>
            <th className="text-left p-3">Company</th>
            <th className="text-left p-3">Score</th>
            <th className="text-left p-3">Tier</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {subs.map((s) => {
            const tier = tiers.find((t) => t.id === s.tier_id) ?? pickTier(tiers, s.total_score, s.percentage);
            return (
              <tr key={s.id} className="border-t hover:bg-muted/30">
                <td className="p-3 whitespace-nowrap text-xs">{s.completed_at ? new Date(s.completed_at).toLocaleString() : "—"}</td>
                <td className="p-3">{s.prospect_name}</td>
                <td className="p-3 font-mono text-xs">{s.prospect_email}</td>
                <td className="p-3">{s.prospect_company ?? "—"}</td>
                <td className="p-3">{s.total_score}/{s.max_score} <span className="text-xs text-muted-foreground">({s.percentage}%)</span></td>
                <td className="p-3">{tier?.name ?? "—"}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(s.id)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(s.id)} className="text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {openId && <SubmissionDetail submissionId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function SubmissionDetail({ submissionId, onClose }: { submissionId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const [{ data: sub }, { data: ans }] = await Promise.all([
        supabase.from("submissions").select("*").eq("id", submissionId).single(),
        supabase
          .from("submission_answers")
          .select("id,answer_value,points_earned,question_id, questions(text,type,options)")
          .eq("submission_id", submissionId),
      ]);
      setData({ sub, answers: ans ?? [] });
    })();
  }, [submissionId]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-background rounded-lg border max-w-2xl w-full max-h-[85vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Submission detail</h3>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {!data ? <div className="text-sm text-muted-foreground">Loading…</div> : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs text-muted-foreground">Name</div><div>{data.sub.prospect_name}</div></div>
              <div><div className="text-xs text-muted-foreground">Email</div><div className="font-mono text-xs">{data.sub.prospect_email}</div></div>
              <div><div className="text-xs text-muted-foreground">Company</div><div>{data.sub.prospect_company ?? "—"}</div></div>
              <div><div className="text-xs text-muted-foreground">Score</div><div>{data.sub.total_score}/{data.sub.max_score} ({data.sub.percentage}%)</div></div>
            </div>
            {data.sub.custom_fields && Object.keys(data.sub.custom_fields).length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Custom fields</div>
                <pre className="text-xs bg-muted p-2 rounded">{JSON.stringify(data.sub.custom_fields, null, 2)}</pre>
              </div>
            )}
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Answers</div>
              {data.answers.map((a: any) => {
                const opts: Array<{ label: string; text: string }> = a.questions?.options ?? [];
                let displayValue: string = a.answer_value ?? "—";
                if (a.questions?.type === "multiple_choice" && a.answer_value) {
                  // answer_value is either "A" or "A: custom text" (for "Other")
                  const [labelPart, ...rest] = String(a.answer_value).split(":");
                  const label = labelPart.trim();
                  const customText = rest.join(":").trim();
                  const opt = opts.find((o) => o.label === label);
                  if (opt) {
                    displayValue = customText
                      ? `${label} – "${customText}" (${opt.text})`
                      : `${label} – "${opt.text}"`;
                  }
                }
                return (
                <div key={a.id} className="rounded border p-3">
                  <div className="text-xs text-muted-foreground">{a.questions?.type === "fill_in" ? "Fill-in" : "Multiple choice"}</div>
                  <div className="font-medium">{a.questions?.text}</div>
                  <div className="mt-1 text-sm">Answer: <span className="font-mono">{displayValue}</span></div>
                  {a.questions?.type === "multiple_choice" && (
                    <div className="text-xs text-muted-foreground mt-1">Points: {a.points_earned}</div>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
