import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { pointsForOption, maxPointsForQuestion, pickTier, type Tier } from "@/lib/scoring";
import { sendQuizResult } from "@/lib/email.functions";

export const Route = createFileRoute("/q/$slug")({
  component: PublicQuiz,
});

interface Quiz {
  id: string; title: string; description: string | null; is_published: boolean;
  branding: any; settings: any;
}
interface Question {
  id: string;
  type: "multiple_choice" | "fill_in" | "category_description";
  text: string;
  scoring_direction: "asc" | "desc" | null;
  options: Array<{ label: string; text: string; points?: number | null; is_other?: boolean }>;
}
type Stage = "intro" | "lead" | "questions" | "results" | "loading" | "notfound";

function isLikertQuestion(q: Question): boolean {
  if (q.type !== "multiple_choice") return false;
  if (!q.options || q.options.length !== 5) return false;
  const first = (q.options[0]?.text ?? "").trim().toLowerCase();
  return first === "strongly agree";
}

function PublicQuiz() {
  const { slug } = Route.useParams();
  const [stage, setStage] = useState<Stage>("loading");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [lead, setLead] = useState({ name: "", email: "", company: "", custom: {} as Record<string, string> });
  // For multiple_choice: stores the selected option's label (e.g. "A").
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // For "Other" option free-text input keyed by question id.
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [submission, setSubmission] = useState<{ id: string; score: number; max: number; pct: number; tier: Tier | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: q } = await supabase
        .from("quizzes")
        .select("id,title,description,is_published,branding,settings")
        .eq("slug", slug)
        .maybeSingle();
      if (!q) { setStage("notfound"); return; }
      const [{ data: qs }, { data: ts }] = await Promise.all([
        supabase.from("questions").select("id,type,text,scoring_direction,options").eq("quiz_id", (q as any).id).order("order_index"),
        supabase.from("result_tiers").select("*").eq("quiz_id", (q as any).id).order("min_value"),
      ]);
      setQuiz(q as any);
      setQuestions((qs ?? []) as any);
      setTiers((ts ?? []) as any);
      setStage("intro");
    })();
  }, [slug]);

  if (stage === "loading") return <FullCenter>Loading…</FullCenter>;
  if (stage === "notfound" || !quiz) return <FullCenter>Quiz not found.</FullCenter>;

  const branding = quiz.branding ?? {};
  const styleVars = {
    "--brand-primary": branding.primary ?? "#2563eb",
    "--brand-bg": branding.background ?? "#ffffff",
    "--brand-fg": branding.fontColor ?? "#0f172a",
    fontFamily: branding.fontFamily ? `${branding.fontFamily}, system-ui, sans-serif` : undefined,
  } as React.CSSProperties;
  const buttonRadius = branding.buttonStyle === "pill" ? "9999px" : branding.buttonStyle === "square" ? "0px" : "0.5rem";
  const customFields = (quiz.settings?.custom_fields ?? []) as Array<{ key: string; label: string; required: boolean }>;
  const bookingUrl: string | undefined = quiz.settings?.booking_url || undefined;

  const startQuiz = () => setStage("lead");

  const submitLead = (e: FormEvent) => {
    e.preventDefault();
    setStage("questions");
  };

  const submitAnswers = async () => {
    setSubmitting(true);
    try {
      // Compute score (skip category descriptions)
      let total = 0;
      const mc = questions.filter((q) => q.type === "multiple_choice");
      const max = mc.reduce(
        (sum, q) => sum + maxPointsForQuestion(q.options, q.scoring_direction ?? "asc"),
        0,
      );
      const ansRows: Array<{ question_id: string; answer_value: string; points_earned: number }> = [];
      for (const q of questions) {
        if (q.type === "category_description") continue;
        const a = answers[q.id] ?? "";
        if (q.type === "multiple_choice") {
          const idx = q.options.findIndex((o) => o.label === a);
          const pts = idx >= 0 ? pointsForOption(idx, (q.scoring_direction ?? "asc"), q.options) : 0;
          total += pts;
          // If the chosen option is an "Other", store the user-typed text alongside the label.
          const chosen = idx >= 0 ? q.options[idx] : null;
          const value =
            chosen?.is_other
              ? `${a}: ${(otherText[q.id] ?? "").trim()}`
              : a;
          ansRows.push({ question_id: q.id, answer_value: value, points_earned: pts });
        } else {
          ansRows.push({ question_id: q.id, answer_value: a, points_earned: 0 });
        }
      }
      const pct = max > 0 ? Math.round((total / max) * 100) : 0;
      const tier = pickTier(tiers, total, pct);

      const { data: sub, error: subErr } = await supabase
        .from("submissions")
        .insert({
          quiz_id: quiz.id,
          prospect_name: lead.name,
          prospect_email: lead.email,
          prospect_company: lead.company || null,
          custom_fields: lead.custom,
          total_score: total,
          max_score: max,
          percentage: pct,
          tier_id: tier?.id ?? null,
          completed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (subErr) throw subErr;

      if (ansRows.length > 0) {
        const { error: aErr } = await supabase
          .from("submission_answers")
          .insert(ansRows.map((r) => ({ ...r, submission_id: (sub as any).id })));
        if (aErr) throw aErr;
      }

      setSubmission({ id: (sub as any).id, score: total, max, pct, tier });
      setStage("results");

      void sendQuizResult({
        data: { submission_id: (sub as any).id, origin: window.location.origin },
      }).catch((e: unknown) => console.warn("[send-quiz-result] failed:", e));
    } catch (err: any) {
      toast.error(err.message ?? "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const logoUrl: string | undefined = branding.logo_url || undefined;
  const logoPosition: "left" | "center" | "right" = branding.logo_position ?? "center";
  const logoJustify =
    logoPosition === "left" ? "justify-start" : logoPosition === "right" ? "justify-end" : "justify-center";
  const resultsDisplay: "both" | "points" | "percent" = quiz.settings?.results_display ?? "both";

  return (
    <div style={{ ...styleVars, background: "var(--brand-bg)", color: "var(--brand-fg)", minHeight: "100vh" }}>
      <div className="mx-auto max-w-2xl p-6 md:p-12">
        {/* Header logo on lead/questions — intro and results render their own centered logo */}
        {logoUrl && (stage === "lead" || stage === "questions") && (
          <div className={`mb-6 flex ${logoJustify}`}>
            <img src={logoUrl} alt="Logo" className="max-h-16" />
          </div>
        )}
        {/* Results page: always top-center, slightly larger than quiz pages */}
        {logoUrl && stage === "results" && (
          <div className="mb-8 flex justify-center">
            <img src={logoUrl} alt="Logo" className="max-h-24" />
          </div>
        )}

        {stage === "intro" && (
          <div className="text-center space-y-6 pt-16">
            {logoUrl && (
              <div className="flex justify-center">
                <div className="w-64 h-48 flex items-center justify-center">
                  <img src={logoUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                </div>
              </div>
            )}
            <h1 className="text-3xl md:text-4xl font-bold">{quiz.title}</h1>
            {quiz.description && <p className="opacity-80">{quiz.description}</p>}
            <button
              onClick={startQuiz}
              className="px-6 py-3 font-medium text-white"
              style={{ background: "var(--brand-primary)", borderRadius: buttonRadius }}
            >
              Start Assessment
            </button>
          </div>
        )}

        {stage === "lead" && (
          <form onSubmit={submitLead} className="space-y-4 max-w-md mx-auto">
            <h2 className="text-xl font-semibold">A little about you</h2>
            <div><Label>Name</Label><Input required value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} /></div>
            <div><Label>Email</Label><Input required type="email" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} /></div>
            <div><Label>Company</Label><Input required value={lead.company} onChange={(e) => setLead({ ...lead, company: e.target.value })} /></div>
            {customFields.map((f) => (
              <div key={f.key}>
                <Label>{f.label}{f.required ? " *" : ""}</Label>
                <Input
                  required={f.required}
                  value={lead.custom[f.key] ?? ""}
                  onChange={(e) => setLead({ ...lead, custom: { ...lead.custom, [f.key]: e.target.value } })}
                />
              </div>
            ))}
            <button
              type="submit"
              className="w-full py-3 font-medium text-white"
              style={{ background: "var(--brand-primary)", borderRadius: buttonRadius }}
            >
              Continue
            </button>
          </form>
        )}

        {stage === "questions" && (
          <AllQuestions
            questions={questions}
            answers={answers}
            setAnswers={setAnswers}
            otherText={otherText}
            setOtherText={setOtherText}
            onSubmit={submitAnswers}
            submitting={submitting}
            buttonRadius={buttonRadius}
          />
        )}

        {stage === "results" && submission && (
          <ResultScreen
            submission={submission}
            bookingUrl={bookingUrl}
            brandingButtonLabel={branding.button_label}
            buttonRadius={buttonRadius}
            displayMode={resultsDisplay}
          />
        )}
      </div>
    </div>
  );
}

function AllQuestions({
  questions, answers, setAnswers, otherText, setOtherText, onSubmit, submitting, buttonRadius,
}: {
  questions: Question[];
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  otherText: Record<string, string>;
  setOtherText: (a: Record<string, string>) => void;
  onSubmit: () => void;
  submitting: boolean;
  buttonRadius: string;
}) {
  const answerable = useMemo(
    () => questions.filter((q) => q.type !== "category_description"),
    [questions],
  );

  const allAnswered = answerable.every((q) => {
    const v = answers[q.id];
    if (!v || !v.toString().trim()) return false;
    if (q.type === "multiple_choice") {
      const opt = q.options.find((o) => o.label === v);
      if (opt?.is_other) {
        return (otherText[q.id] ?? "").trim().length > 0;
      }
    }
    return true;
  });

  if (questions.length === 0) {
    return <div className="text-center opacity-70">This quiz has no questions yet.</div>;
  }

  // Numbering counter that skips category descriptions.
  let qNum = 0;

  return (
    <div className="space-y-8">
      {questions.map((q) => {
        if (q.type === "category_description") {
          return (
            <section
              key={q.id}
              className="rounded-lg p-5 whitespace-pre-wrap"
              style={{ background: "color-mix(in oklab, var(--brand-primary) 6%, transparent)" }}
            >
              {q.text || "(category description)"}
            </section>
          );
        }
        qNum += 1;
        const value = answers[q.id] ?? "";
        const likert = isLikertQuestion(q);

        return (
          <section key={q.id} className="space-y-3">
            <div className="text-xs opacity-60">Question {qNum}</div>
            <h2 className="text-lg md:text-xl font-semibold">{q.text || "(no question text)"}</h2>

            {q.type === "fill_in" ? (
              <Textarea
                rows={4}
                placeholder="Your answer…"
                value={value}
                onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              />
            ) : likert ? (
              <LikertRow
                question={q}
                value={value}
                onChange={(label) => setAnswers({ ...answers, [q.id]: label })}
              />
            ) : (
              <div className="space-y-1">
                {q.options.map((o) => {
                  const selected = value === o.label;
                  return (
                    <div key={o.label}>
                      <button
                        onClick={() => setAnswers({ ...answers, [q.id]: o.label })}
                        className="w-full text-left px-3 py-2 border-2 transition flex items-center gap-3"
                        style={{
                          borderRadius: buttonRadius,
                          borderColor: selected ? "var(--brand-primary)" : "rgba(0,0,0,0.1)",
                          background: selected
                            ? "color-mix(in oklab, var(--brand-primary) 8%, transparent)"
                            : "transparent",
                        }}
                      >
                        <span
                          className="w-7 h-7 rounded-full grid place-items-center text-sm font-semibold shrink-0"
                          style={{ background: "var(--brand-primary)", color: "white" }}
                        >
                          {o.label}
                        </span>
                        <span>{o.text || `(option ${o.label})`}</span>
                      </button>
                      {selected && o.is_other && (
                        <Input
                          className="mt-2"
                          placeholder="Please specify…"
                          value={otherText[q.id] ?? ""}
                          onChange={(e) => setOtherText({ ...otherText, [q.id]: e.target.value })}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <div className="pt-2 flex justify-end">
        <button
          onClick={onSubmit}
          disabled={!allAnswered || submitting}
          className="px-6 py-3 font-medium text-white disabled:opacity-50"
          style={{ background: "var(--brand-primary)", borderRadius: buttonRadius }}
        >
          {submitting ? "Submitting…" : "See my results"}
        </button>
      </div>
    </div>
  );
}

function LikertRow({
  question, value, onChange,
}: {
  question: Question;
  value: string;
  onChange: (label: string) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {question.options.map((o) => {
        const selected = value === o.label;
        return (
          <button
            key={o.label}
            onClick={() => onChange(o.label)}
            className="flex flex-col items-center gap-1 py-1 px-1 rounded-md transition"
            style={{
              background: selected
                ? "color-mix(in oklab, var(--brand-primary) 8%, transparent)"
                : "transparent",
            }}
          >
            <span className="text-xs font-medium text-center leading-tight min-h-[2.5em]">
              {o.text}
            </span>
            <span
              className="grid place-items-center rounded-full border-2 transition"
              style={{
                width: 26,
                height: 26,
                borderColor: selected ? "var(--brand-primary)" : "var(--brand-fg)",
              }}
            >
              <span
                className="rounded-full transition"
                style={{
                  width: 14,
                  height: 14,
                  background: selected ? "var(--brand-primary)" : "transparent",
                }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ResultScreen({
  submission, bookingUrl, brandingButtonLabel, buttonRadius, displayMode,
}: {
  submission: { id: string; score: number; max: number; pct: number; tier: Tier | null };
  bookingUrl?: string; brandingButtonLabel?: string; buttonRadius: string;
  displayMode: "both" | "points" | "percent";
}) {
  const trackedHref = `/r/booking/${submission.id}`;
  const ctaLabel = submission.tier?.cta_text || brandingButtonLabel || "Book a discovery call";

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="text-sm opacity-60 uppercase tracking-wide">Your result</div>
        {displayMode === "percent" ? (
          <div className="text-5xl font-bold">{submission.pct}%</div>
        ) : displayMode === "points" ? (
          <div className="text-5xl font-bold">{submission.score} / {submission.max}</div>
        ) : (
          <>
            <div className="text-5xl font-bold">{submission.score} / {submission.max}</div>
            <div className="opacity-70">{submission.pct}%</div>
          </>
        )}
        {submission.tier && (
          <div className="mt-4 inline-block px-3 py-1 rounded-full text-sm font-medium text-white" style={{ background: "var(--brand-primary)" }}>
            {submission.tier.name}
          </div>
        )}
      </div>

      {submission.tier?.image_url && (
        <div className="flex justify-center">
          <img src={submission.tier.image_url} alt="" className="max-h-32 rounded-lg" />
        </div>
      )}

      {submission.tier?.description && (
        <div className="rounded-lg p-5 whitespace-pre-wrap" style={{ background: "color-mix(in oklab, var(--brand-primary) 6%, transparent)" }}>
          {submission.tier.description}
        </div>
      )}

      <div className="text-center text-xs opacity-60">A copy of your results will be emailed to you.</div>

      {bookingUrl && (
        <div className="pt-4 text-center">
          <a href={trackedHref}>
            <button
              className="px-6 py-3 font-medium text-white"
              style={{ background: "var(--brand-primary)", borderRadius: buttonRadius }}
            >
              {ctaLabel}
            </button>
          </a>
        </div>
      )}
    </div>
  );
}

function FullCenter({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">{children}</div>;
}
