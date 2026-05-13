import { useEffect, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

import { defaultPointsForOption } from "@/lib/scoring";

interface Question {
  id: string;
  quiz_id: string;
  type: "multiple_choice" | "fill_in" | "category_description";
  text: string;
  order_index: number;
  scoring_direction: "asc" | "desc" | null;
  options: Array<{ label: string; text: string; points?: number | null; is_other?: boolean }>;
  keywords: string[];
}

const ALPHA = ["A", "B", "C", "D", "E"];

export function QuestionsTab({ quizId }: { quizId: string }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultDirection, setDefaultDirection] = useState<"asc" | "desc">("asc");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("quiz_id", quizId)
      .order("order_index");
    if (error) toast.error(error.message);
    setQuestions((data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [quizId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const addQuestion = async (type: "multiple_choice" | "fill_in" | "likert" | "category_description") => {
    const order_index = questions.length;
    const isLikert = type === "likert";
    const isCategory = type === "category_description";
    const dbType = isLikert ? "multiple_choice" : type;
    const base: any = {
      quiz_id: quizId,
      type: dbType,
      text: "",
      order_index,
      scoring_direction: isLikert ? "desc" : dbType === "multiple_choice" ? defaultDirection : null,
      options: isLikert
        ? [
            { label: "A", text: "Strongly Agree" },
            { label: "B", text: "Agree" },
            { label: "C", text: "Neutral" },
            { label: "D", text: "Disagree" },
            { label: "E", text: "Strongly Disagree" },
          ]
        : isCategory
          ? []
          : dbType === "multiple_choice"
            ? [
                { label: "A", text: "" },
                { label: "B", text: "" },
                { label: "C", text: "" },
              ]
            : [],
      keywords: [],
    };
    const { data, error } = await supabase.from("questions").insert(base).select().single();
    if (error) { toast.error(error.message); return; }
    setQuestions((prev) => [...prev, data as any]);
  };

  const deleteQuestion = async (id: string) => {
    if (!confirm("Delete this question?")) return;
    const { error } = await supabase.from("questions").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  const updateQuestion = async (id: string, patch: Partial<Question>) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } as Question : q)));
    const { error } = await supabase.from("questions").update(patch as any).eq("id", id);
    if (error) toast.error(error.message);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = questions.findIndex((q) => q.id === active.id);
    const newIdx = questions.findIndex((q) => q.id === over.id);
    const reordered = arrayMove(questions, oldIdx, newIdx).map((q, i) => ({ ...q, order_index: i }));
    setQuestions(reordered);
    // batch update
    await Promise.all(
      reordered.map((q) =>
        supabase.from("questions").update({ order_index: q.order_index }).eq("id", q.id),
      ),
    );
  };

  const applyDefaultDirection = async () => {
    const mc = questions.filter((q) => q.type === "multiple_choice");
    setQuestions((prev) =>
      prev.map((q) => (q.type === "multiple_choice" ? { ...q, scoring_direction: defaultDirection } : q)),
    );
    await Promise.all(
      mc.map((q) =>
        supabase.from("questions").update({ scoring_direction: defaultDirection }).eq("id", q.id),
      ),
    );
    toast.success(`Set all multiple-choice questions to ${defaultDirection}`);
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border bg-card p-3">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Default scoring:</span>
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            <button
              onClick={() => setDefaultDirection("asc")}
              className={`px-2 py-1 text-xs rounded ${defaultDirection === "asc" ? "bg-primary text-primary-foreground" : ""}`}
            >Asc (A=1…E=5)</button>
            <button
              onClick={() => setDefaultDirection("desc")}
              className={`px-2 py-1 text-xs rounded ${defaultDirection === "desc" ? "bg-primary text-primary-foreground" : ""}`}
            >Desc (A=5…E=1)</button>
          </div>
          <Button size="sm" variant="outline" onClick={applyDefaultDirection}>Apply to all</Button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => addQuestion("category_description")}>
            <Plus className="h-4 w-4 mr-1" />Category Description
          </Button>
          <Button size="sm" variant="outline" onClick={() => addQuestion("fill_in")}>
            <Plus className="h-4 w-4 mr-1" />Fill-in
          </Button>
          <Button size="sm" variant="outline" onClick={() => addQuestion("likert")}>
            <Plus className="h-4 w-4 mr-1" />Agree/Disagree
          </Button>
          <Button size="sm" onClick={() => addQuestion("multiple_choice")}>
            <Plus className="h-4 w-4 mr-1" />Multiple choice
          </Button>
        </div>
      </div>

      {questions.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          No questions yet. Add one above.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {questions.map((q, i) => (
                <SortableQuestion
                  key={q.id}
                  index={i}
                  question={q}
                  onDelete={() => deleteQuestion(q.id)}
                  onUpdate={(patch) => updateQuestion(q.id, patch)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableQuestion({
  question, index, onDelete, onUpdate,
}: {
  question: Question;
  index: number;
  onDelete: () => void;
  onUpdate: (patch: Partial<Question>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: question.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const setOption = (i: number, text: string) => {
    const next = [...question.options];
    next[i] = { ...next[i], text };
    onUpdate({ options: next });
  };
  const setOptionPoints = (i: number, points: number | null) => {
    const next = [...question.options];
    next[i] = { ...next[i], points };
    onUpdate({ options: next });
  };
  const toggleOptionOther = (i: number) => {
    const next = [...question.options];
    const isOther = !next[i].is_other;
    next[i] = {
      ...next[i],
      is_other: isOther,
      text: isOther ? (next[i].text || "Other (please specify)") : next[i].text,
    };
    onUpdate({ options: next });
  };
  const addOption = () => {
    if (question.options.length >= 5) return;
    onUpdate({
      options: [...question.options, { label: ALPHA[question.options.length], text: "" }],
    });
  };
  const removeOption = (i: number) => {
    if (question.options.length <= 2) return;
    const next = question.options.filter((_, idx) => idx !== i).map((o, idx) => ({ ...o, label: ALPHA[idx] }));
    onUpdate({ options: next });
  };
  const moveOption = (from: number, to: number) => {
    if (to < 0 || to >= question.options.length || from === to) return;
    const next = [...question.options];
    const a = next[from];
    const b = next[to];
    // Swap text + custom points + is_other, but keep each slot's label (position) intact
    next[from] = { ...a, text: b.text, points: b.points ?? null, is_other: b.is_other ?? false };
    next[to] = { ...b, text: a.text, points: a.points ?? null, is_other: a.is_other ?? false };
    onUpdate({ options: next });
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border bg-card p-4">
      <div className="flex items-start gap-2">
        <button {...attributes} {...listeners} className="mt-2 cursor-grab text-muted-foreground hover:text-foreground">
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1 space-y-3 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Q{index + 1} ·{" "}
              {question.type === "multiple_choice"
                ? "Multiple choice"
                : question.type === "category_description"
                  ? "Category Description"
                  : "Fill in the blank"}
            </span>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {question.type === "category_description" ? (
            <Textarea
              rows={3}
              placeholder="Short paragraph introducing the next set of questions…"
              value={question.text}
              onChange={(e) => onUpdate({ text: e.target.value })}
            />
          ) : (
            <Input
              placeholder="Question text"
              value={question.text}
              onChange={(e) => onUpdate({ text: e.target.value })}
              onBlur={(e) => onUpdate({ text: e.target.value })}
            />
          )}

          {question.type === "multiple_choice" ? (
            <>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Scoring:</span>
                <button
                  onClick={() => onUpdate({ scoring_direction: "asc" })}
                  className={`flex items-center gap-1 px-2 py-1 rounded border ${question.scoring_direction === "asc" ? "border-primary text-primary" : ""}`}
                >
                  <ChevronUp className="h-3 w-3" />Asc
                </button>
                <button
                  onClick={() => onUpdate({ scoring_direction: "desc" })}
                  className={`flex items-center gap-1 px-2 py-1 rounded border ${question.scoring_direction === "desc" ? "border-primary text-primary" : ""}`}
                >
                  <ChevronDown className="h-3 w-3" />Desc
                </button>
              </div>
              <div className="space-y-2">
                {question.options.map((opt, i) => {
                  const dir = question.scoring_direction ?? "asc";
                  const defaultPts = defaultPointsForOption(i, dir);
                  const isCustom =
                    typeof opt.points === "number" && Number.isFinite(opt.points);
                  const displayPts = isCustom ? (opt.points as number) : defaultPts;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded bg-muted text-xs grid place-items-center font-medium">{opt.label}</span>
                      <Input
                        placeholder={`Option ${opt.label}`}
                        value={opt.text}
                        onChange={(e) => setOption(i, e.target.value)}
                      />
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          className="w-16 h-9 text-xs"
                          value={displayPts}
                          onChange={(e) => {
                            const v = e.target.value;
                            setOptionPoints(i, v === "" ? null : Number(v));
                          }}
                          title={isCustom ? "Custom points" : `Default: ${defaultPts}`}
                        />
                        <span className="text-xs text-muted-foreground">pt</span>
                        {isCustom && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setOptionPoints(i, null)}
                            title="Reset to default"
                          >
                            ↺
                          </Button>
                        )}
                      </div>
                      <div className="flex items-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={i === 0}
                          onClick={() => moveOption(i, i - 1)}
                          title="Move up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={i === question.options.length - 1}
                          onClick={() => moveOption(i, i + 1)}
                          title="Move down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <label
                        className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none px-1"
                        title="Treat this option as 'Other' — quiz takers will see a text box to type their own answer."
                      >
                        <input
                          type="checkbox"
                          checked={!!opt.is_other}
                          onChange={() => toggleOptionOther(i)}
                          className="h-3.5 w-3.5"
                        />
                        Other
                      </label>
                      {question.options.length > 2 && (
                        <Button variant="ghost" size="sm" onClick={() => removeOption(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      )}
                    </div>
                  );
                })}
                {question.options.length < 5 && (
                  <Button variant="outline" size="sm" onClick={addOption}>
                    <Plus className="h-3.5 w-3.5 mr-1" />Add option
                  </Button>
                )}
              </div>
            </>
          ) : question.type === "category_description" ? (
            <div className="text-xs text-muted-foreground">
              Shown to the quiz taker as an introduction before the next questions. Not scored.
            </div>
          ) : (
            <FillInEditor question={question} onUpdate={onUpdate} />
          )}
        </div>
      </div>
    </div>
  );
}

function FillInEditor({ question, onUpdate }: { question: Question; onUpdate: (p: Partial<Question>) => void }) {
  const [keywordsText, setKeywordsText] = useState(question.keywords.join(", "));
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">Informational only — not scored.</div>
      <Label className="text-xs">Keywords for internal tagging (comma-separated, optional)</Label>
      <Input
        placeholder="e.g. budget, urgency, b2b"
        value={keywordsText}
        onChange={(e) => setKeywordsText(e.target.value)}
        onBlur={() =>
          onUpdate({
            keywords: keywordsText.split(",").map((s) => s.trim()).filter(Boolean),
          })
        }
      />
    </div>
  );
}
