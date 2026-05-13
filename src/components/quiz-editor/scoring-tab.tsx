import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { validateTiers, maxPointsForQuestion, type Tier } from "@/lib/scoring";

export function ScoringTab({ quizId }: { quizId: string }) {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [questionCount, setQuestionCount] = useState(0);
  const [maxPoints, setMaxPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rangeType, setRangeType] = useState<"points" | "percent">("percent");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: t }, { data: qs }] = await Promise.all([
        supabase.from("result_tiers").select("*").eq("quiz_id", quizId).order("min_value"),
        supabase
          .from("questions")
          .select("options,scoring_direction")
          .eq("quiz_id", quizId)
          .eq("type", "multiple_choice"),
      ]);
      const list = (t ?? []) as any as Tier[];
      setTiers(list);
      const mc = (qs ?? []) as any as Array<{
        options: Array<{ points?: number | null }>;
        scoring_direction: "asc" | "desc" | null;
      }>;
      setQuestionCount(mc.length);
      setMaxPoints(
        mc.reduce(
          (sum, q) => sum + maxPointsForQuestion(q.options ?? [], q.scoring_direction ?? "asc"),
          0,
        ),
      );
      if (list.length > 0) setRangeType(list[0].range_type);
      setLoading(false);
    })();
  }, [quizId]);


  const addTier = async () => {
    const last = [...tiers].sort((a, b) => a.min_value - b.min_value).at(-1);
    const start = last ? Number(last.max_value) + 1 : 0;
    const max = rangeType === "percent" ? 100 : maxPoints;
    const { data, error } = await supabase
      .from("result_tiers")
      .insert({
        quiz_id: quizId,
        name: "New tier",
        min_value: Math.min(start, max),
        max_value: max,
        range_type: rangeType,
        order_index: tiers.length,
      })
      .select()
      .single();
    if (error) { toast.error(error.message); return; }
    setTiers((prev) => [...prev, data as any]);
  };

  const updateTier = (id: string, patch: Partial<Tier>) => {
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };
  const persistTier = async (id: string) => {
    const t = tiers.find((x) => x.id === id);
    if (!t) return;
    const { error } = await supabase
      .from("result_tiers")
      .update({
        name: t.name,
        min_value: t.min_value,
        max_value: t.max_value,
        range_type: t.range_type,
        description: t.description,
        cta_text: t.cta_text,
        image_url: t.image_url ?? null,
      })
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const uploadTierImage = async (id: string, file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Image required"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Max 2MB"); return; }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/tier-${id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("quiz-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("quiz-assets").getPublicUrl(path);
      const url = pub.publicUrl;
      setTiers((prev) => prev.map((x) => (x.id === id ? { ...x, image_url: url } : x)));
      const { error } = await supabase.from("result_tiers").update({ image_url: url }).eq("id", id);
      if (error) throw error;
      toast.success("Image uploaded");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    }
  };

  const deleteTier = async (id: string) => {
    if (!confirm("Delete this tier?")) return;
    const { error } = await supabase.from("result_tiers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setTiers((prev) => prev.filter((t) => t.id !== id));
  };

  const switchType = async (next: "points" | "percent") => {
    setRangeType(next);
    // Convert all tier range_types
    const updated = tiers.map((t) => ({ ...t, range_type: next }));
    setTiers(updated);
    await Promise.all(
      updated.map((t) => supabase.from("result_tiers").update({ range_type: next }).eq("id", t.id)),
    );
  };

  const validation = useMemo(() => validateTiers(tiers), [tiers]);

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <div><span className="text-muted-foreground">Scored questions:</span> <strong>{questionCount}</strong></div>
          <div><span className="text-muted-foreground">Max possible points:</span> <strong>{maxPoints}</strong></div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Range type:</span>
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            <button onClick={() => switchType("percent")} className={`px-2 py-1 rounded ${rangeType === "percent" ? "bg-primary text-primary-foreground" : ""}`}>Percent</button>
            <button onClick={() => switchType("points")} className={`px-2 py-1 rounded ${rangeType === "points" ? "bg-primary text-primary-foreground" : ""}`}>Points</button>
          </div>
        </div>
        <Button size="sm" onClick={addTier}><Plus className="h-4 w-4 mr-1" />Add tier</Button>
      </div>

      {!validation.ok && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm p-3">
          {validation.error}
        </div>
      )}

      <div className="space-y-3">
        {tiers
          .sort((a, b) => a.min_value - b.min_value)
          .map((t) => (
            <div key={t.id} className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  className="font-medium"
                  value={t.name}
                  onChange={(e) => updateTier(t.id, { name: e.target.value })}
                  onBlur={() => persistTier(t.id)}
                />
                <Button variant="ghost" size="sm" onClick={() => deleteTier(t.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Min ({rangeType === "percent" ? "%" : "pts"})</Label>
                  <Input
                    type="number"
                    value={t.min_value}
                    onChange={(e) => updateTier(t.id, { min_value: Number(e.target.value) })}
                    onBlur={() => persistTier(t.id)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Max ({rangeType === "percent" ? "%" : "pts"})</Label>
                  <Input
                    type="number"
                    value={t.max_value}
                    onChange={(e) => updateTier(t.id, { max_value: Number(e.target.value) })}
                    onBlur={() => persistTier(t.id)}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Result message</Label>
                <Textarea
                  rows={3}
                  value={t.description ?? ""}
                  onChange={(e) => updateTier(t.id, { description: e.target.value })}
                  onBlur={() => persistTier(t.id)}
                />
              </div>
              <div>
                <Label className="text-xs">Tier image (optional, shown on results page between title and description)</Label>
                {t.image_url ? (
                  <div className="flex items-center gap-3 mt-1">
                    <img src={t.image_url} alt="" className="max-h-20 rounded border" />
                    <Button size="sm" variant="ghost" onClick={async () => {
                      setTiers((prev) => prev.map((x) => x.id === t.id ? { ...x, image_url: null } : x));
                      await supabase.from("result_tiers").update({ image_url: null }).eq("id", t.id);
                    }}>Remove</Button>
                  </div>
                ) : (
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadTierImage(t.id, f); }}
                  />
                )}
              </div>
              <div>
                <Label className="text-xs">CTA text (optional)</Label>
                <Input
                  value={t.cta_text ?? ""}
                  onChange={(e) => updateTier(t.id, { cta_text: e.target.value })}
                  onBlur={() => persistTier(t.id)}
                  placeholder="Book a discovery call"
                />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
