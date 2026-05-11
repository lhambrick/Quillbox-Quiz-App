import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Paperclip, X } from "lucide-react";
import type { Tier } from "@/lib/scoring";

type Attachment = { filename: string; url: string };

interface Config {
  id?: string;
  api_key?: string;
  from_email?: string;
  from_name?: string;
}

export function EmailTab({ quizId }: { quizId: string }) {
  const [cfg, setCfg] = useState<Config>({});
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [quizOwnerId, setQuizOwnerId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      const [{ data: q }, { data: c }, { data: t }] = await Promise.all([
        supabase.from("quizzes").select("owner_id").eq("id", quizId).maybeSingle(),
        supabase
          .from("email_provider_configs")
          .select("*")
          .eq("quiz_id", quizId)
          .eq("provider", "resend")
          .maybeSingle(),
        supabase.from("result_tiers").select("*").eq("quiz_id", quizId).order("min_value"),
      ]);
      setQuizOwnerId(((q as any)?.owner_id ?? null));
      setCfg((c as any) ?? {});
      setTiers((t ?? []) as any);
      setLoading(false);
      (window as any).__uid = user?.id;
    })();
  }, [quizId]);

  const saveCfg = async (patch: Partial<Config>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    if (cfg.id) {
      const { error } = await supabase
        .from("email_provider_configs")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", cfg.id);
      if (error) toast.error(error.message);
    } else {
      // Always insert as the quiz owner so editors editing the config don't
      // create a duplicate row owned by themselves (RLS would also block it).
      const ownerId = quizOwnerId;
      if (!ownerId) { toast.error("Quiz owner unknown"); return; }
      const { data, error } = await supabase
        .from("email_provider_configs")
        .insert({
          owner_id: ownerId,
          quiz_id: quizId,
          provider: "resend",
          ...patch,
        })
        .select()
        .single();
      if (error) toast.error(error.message);
      else setCfg(data as any);
    }
  };

  const updateTier = (id: string, patch: Partial<Tier>) =>
    setTiers((p) => p.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const persistTier = async (id: string) => {
    const t = tiers.find((x) => x.id === id);
    if (!t) return;
    const { error } = await supabase
      .from("result_tiers")
      .update({
        email_subject: (t as any).email_subject ?? null,
        email_intro: (t as any).email_intro ?? null,
        email_body: (t as any).email_body ?? null,
      })
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const persistAttachments = async (id: string, list: Attachment[]) => {
    const { error } = await supabase
      .from("result_tiers")
      .update({ email_attachments: list as any })
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const uploadAttachment = async (tierId: string, file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10MB");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${user.id}/tier-${tierId}-${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from("quiz-assets")
      .upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" });
    if (upErr) { toast.error(upErr.message); return; }
    const { data: pub } = supabase.storage.from("quiz-assets").getPublicUrl(path);
    const current: Attachment[] = ((tiers.find((x) => x.id === tierId) as any)?.email_attachments ?? []) as Attachment[];
    const next = [...current, { filename: file.name, url: pub.publicUrl }];
    updateTier(tierId, { email_attachments: next } as any);
    await persistAttachments(tierId, next);
    toast.success("Attachment added");
  };

  const removeAttachment = async (tierId: string, idx: number) => {
    const current: Attachment[] = ((tiers.find((x) => x.id === tierId) as any)?.email_attachments ?? []) as Attachment[];
    const next = current.filter((_, i) => i !== idx);
    updateTier(tierId, { email_attachments: next } as any);
    await persistAttachments(tierId, next);
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-lg border bg-card p-5 space-y-3">
        <h3 className="font-semibold">Resend (sender)</h3>
        <p className="text-xs text-muted-foreground">
          Each tenant connects their own <a href="https://resend.com/api-keys" className="underline" target="_blank" rel="noreferrer">Resend account</a>.
          Use a verified domain in production; <code>onboarding@resend.dev</code> works for testing.
        </p>
        <div>
          <Label>API key</Label>
          <div className="flex items-center gap-2">
            <Input
              type={showKey ? "text" : "password"}
              placeholder="re_xxxxxxxx"
              defaultValue={cfg.api_key ?? ""}
              onBlur={(e) => saveCfg({ api_key: e.target.value || undefined })}
            />
            <Button size="sm" variant="ghost" onClick={() => setShowKey((s) => !s)}>{showKey ? "Hide" : "Show"}</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>From name</Label>
            <Input
              defaultValue={cfg.from_name ?? ""}
              placeholder="Acme Co"
              onBlur={(e) => saveCfg({ from_name: e.target.value || undefined })}
            />
          </div>
          <div>
            <Label>From email</Label>
            <Input
              defaultValue={cfg.from_email ?? ""}
              placeholder="hello@yourdomain.com"
              onBlur={(e) => saveCfg({ from_email: e.target.value || undefined })}
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-5 space-y-3">
        <h3 className="font-semibold">Per-tier email content</h3>
        <p className="text-xs text-muted-foreground">
          Branding (colors/logo) is applied automatically. Customize subject + content per tier.
        </p>
        {tiers.length === 0 && <div className="text-sm text-muted-foreground">Add tiers in the Scoring tab first.</div>}
        {tiers.map((t: any) => (
          <div key={t.id} className="rounded-md border p-3 space-y-2">
            <div className="font-medium text-sm">{t.name}</div>
            <div>
              <Label className="text-xs">Subject</Label>
              <Input
                defaultValue={t.email_subject ?? ""}
                placeholder={`Your ${t.name} results`}
                onChange={(e) => updateTier(t.id, { email_subject: e.target.value } as any)}
                onBlur={() => persistTier(t.id)}
              />
            </div>
            <div>
              <Label className="text-xs">Intro paragraph</Label>
              <Textarea
                rows={2}
                defaultValue={t.email_intro ?? ""}
                placeholder="Thanks for completing the assessment…"
                onChange={(e) => updateTier(t.id, { email_intro: e.target.value } as any)}
                onBlur={() => persistTier(t.id)}
              />
            </div>
            <div>
              <Label className="text-xs">Body content</Label>
              <Textarea
                rows={5}
                defaultValue={t.email_body ?? ""}
                placeholder={t.description || "Detailed feedback for this tier…"}
                onChange={(e) => updateTier(t.id, { email_body: e.target.value } as any)}
                onBlur={() => persistTier(t.id)}
              />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1"><Paperclip className="h-3 w-3" />Attachments (PDF, etc.)</Label>
              <div className="space-y-1 mt-1">
                {(((t as any).email_attachments ?? []) as Attachment[]).map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs rounded border bg-muted/30 px-2 py-1">
                    <a href={a.url} target="_blank" rel="noreferrer" className="truncate underline">{a.filename}</a>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeAttachment(t.id, i)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <Input
                type="file"
                className="mt-2 text-xs"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadAttachment(t.id, f);
                  e.target.value = "";
                }}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Files are sent as email attachments to recipients in this tier. Max 10MB each.</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
