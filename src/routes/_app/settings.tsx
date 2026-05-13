import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      setFullName((data as any)?.full_name ?? "");
    })();
  }, [user]);

  const saveName = async () => {
    if (!user) return;
    setSavingName(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim() || null })
      .eq("id", user.id);
    setSavingName(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Profile updated");
  };

  const changePassword = async () => {
    if (pw.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (pw !== pw2) { toast.error("Passwords do not match"); return; }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSavingPw(false);
    if (error) { toast.error(error.message); return; }
    setPw(""); setPw2("");
    toast.success("Password changed");
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Profile</h2>
        <div>
          <Label>Email</Label>
          <Input value={user?.email ?? ""} disabled />
          <p className="text-xs text-muted-foreground mt-1">Contact support to change your sign-in email.</p>
        </div>
        <div>
          <Label>Full name</Label>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jane Doe"
          />
        </div>
        <div>
          <Button onClick={saveName} disabled={savingName}>
            {savingName ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Change password</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>New password</Label>
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div>
            <Label>Confirm password</Label>
            <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
        </div>
        <div>
          <Button onClick={changePassword} disabled={savingPw || !pw}>
            {savingPw ? "Updating…" : "Update password"}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-5 space-y-2">
        <h2 className="font-semibold">Email provider</h2>
        <p className="text-sm text-muted-foreground">
          Resend API keys, sender name, and per-tier email content are configured per quiz on the
          quiz editor's <span className="font-medium text-foreground">Email</span> tab.
        </p>
        <Link to="/dashboard" className="text-sm underline">Go to your quizzes</Link>
      </section>
    </div>
  );
}
