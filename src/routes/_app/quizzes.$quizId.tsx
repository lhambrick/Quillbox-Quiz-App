import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { QuestionsTab } from "@/components/quiz-editor/questions-tab";
import { ScoringTab } from "@/components/quiz-editor/scoring-tab";
import { SettingsTab } from "@/components/quiz-editor/settings-tab";
import { PreviewTab } from "@/components/quiz-editor/preview-tab";
import { SubmissionsTab } from "@/components/quiz-editor/submissions-tab";
import { BrandingTab } from "@/components/quiz-editor/branding-tab";
import { EmailTab } from "@/components/quiz-editor/email-tab";
import { ShareTab } from "@/components/quiz-editor/share-tab";

export const Route = createFileRoute("/_app/quizzes/$quizId")({
  component: QuizEditorPage,
});

type Tab = "questions" | "scoring" | "branding" | "email" | "settings" | "preview" | "submissions" | "share";
const TABS: { id: Tab; label: string }[] = [
  { id: "questions", label: "Questions" },
  { id: "scoring", label: "Scoring & Tiers" },
  { id: "branding", label: "Branding" },
  { id: "email", label: "Email" },
  { id: "settings", label: "Settings" },
  { id: "preview", label: "Preview" },
  { id: "submissions", label: "Submissions" },
  { id: "share", label: "Share" },
];

function QuizEditorPage() {
  const { quizId } = Route.useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState<string>("");
  const [tab, setTab] = useState<Tab>("questions");

  const loadTitle = async () => {
    const { data } = await supabase.from("quizzes").select("title").eq("id", quizId).single();
    setTitle((data as any)?.title ?? "");
  };
  useEffect(() => { loadTitle(); }, [quizId]);

  const onDelete = async () => {
    if (!confirm("Delete this quiz and all its data? This cannot be undone.")) return;
    const { error } = await supabase.from("quizzes").delete().eq("id", quizId);
    if (error) { toast.error(error.message); return; }
    toast.success("Quiz deleted");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <Link to="/dashboard"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Button></Link>
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive">
          <Trash2 className="h-4 w-4 mr-1" />Delete quiz
        </Button>
      </div>
      <h1 className="text-2xl font-semibold mb-4">{title || "Untitled Quiz"}</h1>

      <div className="flex gap-1 border-b mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === t.id ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "questions" && <QuestionsTab quizId={quizId} />}
      {tab === "scoring" && <ScoringTab quizId={quizId} />}
      {tab === "branding" && <BrandingTab quizId={quizId} />}
      {tab === "email" && <EmailTab quizId={quizId} />}
      {tab === "settings" && <SettingsTab quizId={quizId} onChange={loadTitle} />}
      {tab === "preview" && <PreviewTab quizId={quizId} />}
      {tab === "submissions" && <SubmissionsTab quizId={quizId} />}
      {tab === "share" && <ShareTab quizId={quizId} />}
    </div>
  );
}
