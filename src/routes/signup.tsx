import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const { signUp, signIn } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signUp(email, password, fullName);
      // If email confirmation is disabled in Supabase settings, signIn works immediately.
      try {
        await signIn(email, password);
        toast.success("Welcome!");
        const pending = (() => { try { return localStorage.getItem("pendingInviteToken"); } catch { return null; } })();
        if (pending) {
          navigate({ to: "/invite/$token", params: { token: pending } });
        } else {
          navigate({ to: "/dashboard" });
        }
      } catch {
        toast.success("Check your email to confirm your account.");
        navigate({ to: "/login" });
      }
    } catch (err: any) {
      toast.error(err.message ?? "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="h-10 w-10 rounded-md bg-primary text-primary-foreground grid place-items-center font-bold mx-auto">Q</div>
          <h1 className="mt-4 text-2xl font-semibold">Create your account</h1>
          <p className="text-sm text-muted-foreground">Start building branded quizzes</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-6">
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating..." : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account? <Link to="/login" className="underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
