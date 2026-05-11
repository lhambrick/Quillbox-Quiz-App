import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";

interface Branding {
  primary?: string;
  background?: string;
  fontColor?: string;
  fontFamily?: string;
  buttonStyle?: "rounded" | "pill" | "square";
  logo_url?: string;
  logo_position?: "left" | "center" | "right";
  button_label?: string;
}

const FONT_OPTIONS = ["Inter", "Roboto", "Poppins", "Merriweather", "Playfair Display", "Montserrat", "Lato"];

export function BrandingTab({ quizId }: { quizId: string }) {
  const [branding, setBranding] = useState<Branding>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; branding_config: Branding }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: q }, { data: t }] = await Promise.all([
        supabase.from("quizzes").select("branding").eq("id", quizId).single(),
        supabase.from("branding_templates").select("id,name,branding_config").eq("is_stock", true),
      ]);
      setBranding(((q as any)?.branding ?? {}) as Branding);
      setTemplates((t ?? []) as any);
      setLoading(false);
    })();
  }, [quizId]);

  const save = async (next: Branding) => {
    setBranding(next);
    const { error } = await supabase.from("quizzes").update({ branding: next }).eq("id", quizId);
    if (error) toast.error(error.message);
  };

  const update = (patch: Partial<Branding>) => save({ ...branding, ...patch });

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Logo must be an image");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2MB");
      return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/${quizId}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("quiz-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("quiz-assets").getPublicUrl(path);
      await save({ ...branding, logo_url: pub.publicUrl });
      toast.success("Logo uploaded");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <Section title="Logo">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) uploadFile(f);
          }}
          className={`rounded-lg border-2 border-dashed p-6 text-center transition ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}
        >
          {branding.logo_url ? (
            <div className="flex items-center justify-center gap-3">
              <img src={branding.logo_url} alt="Logo" className="max-h-20" />
              <Button size="sm" variant="ghost" onClick={() => update({ logo_url: undefined })}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
              <div className="text-sm text-muted-foreground">Drag & drop a logo, or</div>
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : "Browse"}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
              />
            </div>
          )}
        </div>
        <div>
          <Label className="text-xs">Or paste a logo URL</Label>
          <Input
            placeholder="https://example.com/logo.png"
            defaultValue={branding.logo_url ?? ""}
            onBlur={(e) => update({ logo_url: e.target.value || undefined })}
          />
        </div>
        <div>
          <Label className="text-xs">Logo position on quiz pages</Label>
          <select
            value={branding.logo_position ?? "center"}
            onChange={(e) => update({ logo_position: e.target.value as any })}
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="left">Top left</option>
            <option value="center">Top center</option>
            <option value="right">Top right</option>
          </select>
          <p className="text-xs text-muted-foreground mt-1">On the intro screen the logo is always centered above the title.</p>
        </div>
      </Section>

      <Section title="Colors & font">
        <div className="grid grid-cols-3 gap-3">
          <ColorField label="Primary" value={branding.primary ?? "#2563eb"} onChange={(v) => update({ primary: v })} />
          <ColorField label="Background" value={branding.background ?? "#ffffff"} onChange={(v) => update({ background: v })} />
          <ColorField label="Text" value={branding.fontColor ?? "#0f172a"} onChange={(v) => update({ fontColor: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Font</Label>
            <select
              value={branding.fontFamily ?? "Inter"}
              onChange={(e) => update({ fontFamily: e.target.value })}
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            >
              {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Button style</Label>
            <select
              value={branding.buttonStyle ?? "rounded"}
              onChange={(e) => update({ buttonStyle: e.target.value as any })}
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="rounded">Rounded</option>
              <option value="pill">Pill</option>
              <option value="square">Square</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="CTA button">
        <div>
          <Label className="text-xs">Default button label (used if no tier-specific CTA)</Label>
          <Input
            defaultValue={branding.button_label ?? ""}
            placeholder="Book a discovery call"
            onBlur={(e) => update({ button_label: e.target.value || undefined })}
          />
        </div>
      </Section>

      <Section title="Stock templates">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {templates.map((t) => {
            const c = t.branding_config;
            return (
              <button
                key={t.id}
                onClick={() => save({ ...branding, ...c })}
                className="rounded-md border p-3 text-left hover:border-primary transition"
              >
                <div className="flex gap-1 mb-2">
                  <span className="h-4 w-4 rounded" style={{ background: c.primary }} />
                  <span className="h-4 w-4 rounded border" style={{ background: c.background }} />
                  <span className="h-4 w-4 rounded" style={{ background: c.fontColor }} />
                </div>
                <div className="text-xs font-medium">{t.name}</div>
              </button>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 rounded border" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      </div>
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
