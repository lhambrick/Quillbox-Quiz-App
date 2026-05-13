import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Copy, ExternalLink, Plus, Trash2 } from "lucide-react";

interface Quiz {
  id: string;
  title: string;
  description: string | null;
  slug: string | null;
  is_published: boolean;
  settings: any;
}

interface CustomField { key: string; label: string; required: boolean }

export function SettingsTab({ quizId, onChange }: { quizId: string; onChange?: () => void }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("quizzes")
        .select("id,title,description,slug,is_published,settings")
        .eq("id", quizId)
        .single();
      if (error) toast.error(error.message);
      setQuiz(data as any);
      setLoading(false);
    })();
  }, [quizId]);

  const save = async (patch: Partial<Quiz>) => {
    if (!quiz) return;
    setSaving(true);
    const { error } = await supabase.from("quizzes").update(patch).eq("id", quiz.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setQuiz({ ...quiz, ...patch });
    onChange?.();
  };

  if (loading || !quiz) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const settings = quiz.settings ?? {};
  const customFields: CustomField[] = settings.custom_fields ?? [];
  const bookingUrl: string = settings.booking_url ?? "";
  

  const updateSettings = (patch: any) => save({ settings: { ...settings, ...patch } });

  const publicUrl = quiz.slug ? `${window.location.origin}/q/${quiz.slug}` : null;

  return (
    <div className="space-y-6 max-w-2xl">
      <Section title="Basics">
        <div>
          <Label>Title</Label>
          <Input
            value={quiz.title}
            onChange={(e) => setQuiz({ ...quiz, title: e.target.value })}
            onBlur={(e) => save({ title: e.target.value })}
          />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea
            rows={2}
            value={quiz.description ?? ""}
            onChange={(e) => setQuiz({ ...quiz, description: e.target.value })}
            onBlur={(e) => save({ description: e.target.value })}
          />
        </div>
      </Section>

      <Section title="Public URL">
        <div>
          <Label>Slug</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">/q/</span>
            <Input
              placeholder="assessment"
              value={quiz.slug ?? ""}
              onChange={(e) =>
                setQuiz({ ...quiz, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })
              }
              onBlur={(e) => save({ slug: e.target.value || null })}
            />
          </div>
          {publicUrl && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono truncate">{publicUrl}</span>
              <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success("Copied"); }}>
                <Copy className="h-3 w-3" />
              </Button>
              <a href={publicUrl} target="_blank" rel="noreferrer">
                <Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button>
              </a>
            </div>
          )}
        </div>
      </Section>

      <Section title="Lead capture">
        <p className="text-xs text-muted-foreground">Name, Email, Company are always required. Add optional custom fields below.</p>
        <div className="space-y-2">
          {customFields.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="Field key (e.g. role)"
                value={f.key}
                onChange={(e) => {
                  const next = [...customFields]; next[i] = { ...f, key: e.target.value };
                  updateSettings({ custom_fields: next });
                }}
              />
              <Input
                placeholder="Label"
                value={f.label}
                onChange={(e) => {
                  const next = [...customFields]; next[i] = { ...f, label: e.target.value };
                  updateSettings({ custom_fields: next });
                }}
              />
              <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) => {
                    const next = [...customFields]; next[i] = { ...f, required: e.target.checked };
                    updateSettings({ custom_fields: next });
                  }}
                />
                Required
              </label>
              <Button variant="ghost" size="sm" onClick={() => updateSettings({ custom_fields: customFields.filter((_, idx) => idx !== i) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => updateSettings({ custom_fields: [...customFields, { key: "", label: "", required: false }] })}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add field
          </Button>
        </div>
      </Section>

      <Section title="Booking link">
        <p className="text-xs text-muted-foreground">
          Works with Calendly, Cal.com, HubSpot Meetings, SavvyCal, Tidycal, and any other booking link.
          Clicks are tracked through <code>/r/booking/:submission_id</code> before redirecting.
        </p>
        <div>
          <Label>URL</Label>
          <Input
            placeholder="https://calendly.com/your-name/intro"
            defaultValue={bookingUrl}
            onBlur={(e) => updateSettings({ booking_url: e.target.value })}
          />
        </div>
      </Section>

      <Section title="Results display">
        <Label className="text-xs">How should the score be shown to the quiz taker?</Label>
        <select
          value={settings.results_display ?? "both"}
          onChange={(e) => updateSettings({ results_display: e.target.value })}
          className="w-full h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="both">Points and percentage (e.g. 18 / 25 — 72%)</option>
          <option value="points">Points only (e.g. 18 / 25)</option>
          <option value="percent">Percentage only (e.g. 72%)</option>
        </select>
      </Section>

      <Section title="Publish">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-sm">{quiz.is_published ? "Live" : "Draft"}</div>
            <div className="text-xs text-muted-foreground">{quiz.is_published ? "Anyone with the link can take this quiz." : "Only you can see it."}</div>
          </div>
          <Switch
            checked={quiz.is_published}
            onCheckedChange={(v) => {
              if (v && !quiz.slug) { toast.error("Add a URL slug before publishing."); return; }
              save({ is_published: v });
            }}
          />
        </div>
      </Section>

      {saving && <div className="text-xs text-muted-foreground">Saving…</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-5 space-y-3">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </div>
  );
}
