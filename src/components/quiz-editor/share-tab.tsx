import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Copy, Mail, Pencil, Check, X } from "lucide-react";
import { sendInviteEmail } from "@/lib/email.functions";

interface Collaborator {
  id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  invited_at: string;
  accepted_at: string | null;
  email?: string;
  full_name?: string | null;
}

interface Invite {
  id: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  token: string;
  expires_at: string;
  created_at: string;
}

export function ShareTab({ quizId }: { quizId: string }) {
  const { user } = useAuth();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [collabs, setCollabs] = useState<Collaborator[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [inviting, setInviting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const isOwner = !!user && !!ownerId && user.id === ownerId;

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  async function load() {
    setLoading(true);
    const [{ data: quiz }, { data: cs }, { data: ivs }] = await Promise.all([
      supabase.from("quizzes").select("owner_id").eq("id", quizId).single(),
      supabase.from("quiz_collaborators").select("*").eq("quiz_id", quizId),
      supabase.from("quiz_invites").select("*").eq("quiz_id", quizId).order("created_at", { ascending: false }),
    ]);
    setOwnerId((quiz as any)?.owner_id ?? null);

    const csList = (cs ?? []) as Collaborator[];
    const ownerRow: Collaborator | null = (quiz as any)?.owner_id
      ? {
          id: "owner",
          user_id: (quiz as any).owner_id,
          role: "owner",
          invited_at: "",
          accepted_at: new Date().toISOString(),
        }
      : null;

    const ids = Array.from(new Set([...(ownerRow ? [ownerRow.user_id] : []), ...csList.map((c) => c.user_id)]));
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id,email,full_name")
        .in("id", ids);
      const pMap = new Map<string, { email: string; full_name?: string | null }>();
      (profiles ?? []).forEach((p: any) => pMap.set(p.id, { email: p.email, full_name: p.full_name }));
      csList.forEach((c) => {
        const p = pMap.get(c.user_id);
        if (p) { c.email = p.email; c.full_name = p.full_name; }
      });
      if (ownerRow) {
        const p = pMap.get(ownerRow.user_id);
        if (p) { ownerRow.email = p.email; ownerRow.full_name = p.full_name; }
      }
    }

    setCollabs(ownerRow ? [ownerRow, ...csList] : csList);
    setInvites((ivs ?? []) as Invite[]);
    setLoading(false);
  }

  const onInvite = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/.+@.+\..+/.test(trimmed)) { toast.error("Enter a valid email"); return; }
    setInviting(true);
    try {
      // Try to find an existing user with this email in profiles
      const { data: prof } = await supabase
        .from("profiles")
        .select("id,email")
        .eq("email", trimmed)
        .maybeSingle();

      if (prof?.id) {
        if (prof.id === ownerId) { toast.error("That user already owns this quiz"); return; }
        const { error } = await supabase
          .from("quiz_collaborators")
          .insert({
            quiz_id: quizId,
            user_id: prof.id,
            role,
            accepted_at: new Date().toISOString(),
          });
        if (error) throw error;
        toast.success(`Added ${trimmed} as ${role}`);
      } else {
        const { data: created, error } = await supabase
          .from("quiz_invites")
          .insert({ quiz_id: quizId, email: trimmed, role })
          .select("id, token")
          .single();
        if (error) throw error;
        // Best-effort: email the invite link to the recipient.
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const acceptUrl = `${window.location.origin}/invite/${(created as any).token}`;
          const result = await sendInviteEmail({
            data: {
              invite_id: (created as any).id,
              accept_url: acceptUrl,
              access_token: session?.access_token ?? "",
            },
          });
          if ((result as any)?.skipped) {
            toast.success(`Invite created. ${(result as any).reason ?? "Copy the link to share manually."}`);
          } else {
            toast.success(`Invite emailed to ${trimmed}`);
          }
        } catch (e: any) {
          toast.success(`Invite created for ${trimmed}. Email failed: ${e.message ?? "unknown"} — copy the link below.`);
        }
      }
      setEmail("");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  const updateRole = async (id: string, newRole: "editor" | "viewer") => {
    const { error } = await supabase.from("quiz_collaborators").update({ role: newRole }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setCollabs((prev) => prev.map((c) => (c.id === id ? { ...c, role: newRole } : c)));
  };

  const removeCollab = async (id: string) => {
    if (!confirm("Remove this collaborator?")) return;
    const { error } = await supabase.from("quiz_collaborators").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setCollabs((prev) => prev.filter((c) => c.id !== id));
  };

  const revokeInvite = async (id: string) => {
    const { error } = await supabase.from("quiz_invites").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setInvites((prev) => prev.filter((i) => i.id !== id));
  };

  const copyInviteLink = async (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  };

  const startEditName = (c: Collaborator) => {
    setEditingId(c.user_id);
    setEditingName(c.full_name ?? "");
  };

  const cancelEditName = () => {
    setEditingId(null);
    setEditingName("");
  };

  const saveName = async (userId: string) => {
    const trimmed = editingName.trim();
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: trimmed || null })
      .eq("id", userId);
    if (error) { toast.error(error.message); return; }
    setCollabs((prev) => prev.map((c) => (c.user_id === userId ? { ...c, full_name: trimmed || null } : c)));
    toast.success("Name updated");
    cancelEditName();
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h3 className="font-semibold">Invite a collaborator</h3>
        {!isOwner && (
          <p className="text-xs text-muted-foreground">Only the quiz owner can manage collaborators.</p>
        )}
        <div className="grid grid-cols-[1fr_140px_auto] gap-2 items-end">
          <div>
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!isOwner}
            />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              disabled={!isOwner}
              className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <Button onClick={onInvite} disabled={!isOwner || inviting}>
            {inviting ? "Inviting…" : "Invite"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          If they already have an account, they'll get instant access. Otherwise we'll generate an invite link you can send them.
        </p>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold">People with access</h3>
          <span className="text-xs text-muted-foreground">{collabs.length}</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left p-3">User</th>
              <th className="text-left p-3">Role</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {collabs.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-3">
                  {editingId === c.user_id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveName(c.user_id);
                          if (e.key === "Escape") cancelEditName();
                        }}
                        className="h-8"
                        placeholder="Full name"
                      />
                      <Button size="sm" variant="ghost" onClick={() => void saveName(c.user_id)}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEditName}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <div>
                        <div>{c.full_name || c.email || c.user_id}</div>
                        {c.email && c.full_name && <div className="text-xs text-muted-foreground">{c.email}</div>}
                      </div>
                      {isOwner && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100 h-7 w-7 p-0"
                          onClick={() => startEditName(c)}
                          title="Edit name"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  )}
                </td>
                <td className="p-3">
                  {c.role === "owner" ? (
                    <span className="text-xs uppercase tracking-wide">Owner</span>
                  ) : isOwner ? (
                    <select
                      value={c.role}
                      onChange={(e) => updateRole(c.id, e.target.value as any)}
                      className="h-8 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span className="capitalize">{c.role}</span>
                  )}
                </td>
                <td className="p-3 text-right">
                  {c.role !== "owner" && isOwner && (
                    <Button size="sm" variant="ghost" onClick={() => removeCollab(c.id)} className="text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invites.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><Mail className="h-4 w-4" />Pending invites</h3>
            <span className="text-xs text-muted-foreground">{invites.length}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Role</th>
                <th className="text-left p-3">Expires</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="p-3 font-mono text-xs">{i.email}</td>
                  <td className="p-3 capitalize">{i.role}</td>
                  <td className="p-3 text-xs text-muted-foreground">{new Date(i.expires_at).toLocaleDateString()}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => copyInviteLink(i.token)}>
                      <Copy className="h-3.5 w-3.5 mr-1" />Copy link
                    </Button>
                    {isOwner && (
                      <Button size="sm" variant="ghost" onClick={() => revokeInvite(i.id)} className="text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
