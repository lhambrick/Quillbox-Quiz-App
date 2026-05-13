// Supabase Edge Function: send-quiz-result
// ----------------------------------------------------------------------------
// Renders a branded HTML email for a quiz submission and sends it via the
// tenant's own Resend API key (stored in `email_provider_configs`).
//
// Deploy with:
//   supabase functions deploy send-quiz-result --no-verify-jwt
//
// No global Resend key is needed — the function uses the SUPABASE_SERVICE_ROLE_KEY
// (auto-injected by Supabase) to read the per-tenant key.
// ----------------------------------------------------------------------------

// @ts-nocheck — Deno runtime, types resolved at deploy time
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Branding {
  primary?: string;
  background?: string;
  fontColor?: string;
  fontFamily?: string;
  logo_url?: string;
  button_label?: string;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderEmail(opts: {
  branding: Branding;
  quizTitle: string;
  recipientName: string;
  score: number;
  max: number;
  pct: number;
  tierName: string;
  intro: string;
  body: string;
  ctaUrl?: string;
  ctaLabel?: string;
}): string {
  const primary = opts.branding.primary || "#2563eb";
  const bg = opts.branding.background || "#ffffff";
  const fg = opts.branding.fontColor || "#0f172a";
  const fontFamily = opts.branding.fontFamily
    ? `${opts.branding.fontFamily}, system-ui, sans-serif`
    : "system-ui, -apple-system, Segoe UI, sans-serif";

  const logo = opts.branding.logo_url
    ? `<img src="${escapeHtml(opts.branding.logo_url)}" alt="" style="max-height:48px;margin-bottom:24px"/>`
    : "";

  const cta =
    opts.ctaUrl && opts.ctaLabel
      ? `<div style="text-align:center;margin:32px 0">
          <a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;background:${primary};color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600">${escapeHtml(opts.ctaLabel)}</a>
        </div>`
      : "";

  // Convert simple newlines in body/intro to <br>
  const introHtml = escapeHtml(opts.intro).replace(/\n/g, "<br>");
  const bodyHtml = escapeHtml(opts.body).replace(/\n/g, "<br>");

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:${fontFamily};color:${fg}">
  <div style="max-width:600px;margin:0 auto;background:${bg};padding:40px 32px">
    ${logo}
    <h1 style="margin:0 0 8px;font-size:22px">${escapeHtml(opts.quizTitle)}</h1>
    <p style="margin:0 0 24px;color:#666;font-size:14px">Hi ${escapeHtml(opts.recipientName)}, here are your results.</p>

    <div style="background:${primary}10;border-left:4px solid ${primary};padding:16px 20px;margin:0 0 24px;border-radius:4px">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#666">Your result</div>
      <div style="font-size:28px;font-weight:700;margin-top:4px">${opts.score} / ${opts.max} <span style="font-size:16px;color:#666;font-weight:400">(${opts.pct}%)</span></div>
      <div style="margin-top:8px;display:inline-block;background:${primary};color:#fff;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:600">${escapeHtml(opts.tierName)}</div>
    </div>

    ${introHtml ? `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">${introHtml}</p>` : ""}
    ${bodyHtml ? `<div style="font-size:15px;line-height:1.6;margin:0 0 16px">${bodyHtml}</div>` : ""}

    ${cta}

    <hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0"/>
    <p style="font-size:12px;color:#999;margin:0">You received this because you completed the assessment.</p>
  </div>
</body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { submission_id } = await req.json();
    if (!submission_id) throw new Error("submission_id required");

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) Load submission + quiz + tier
    const { data: sub, error: sErr } = await sb
      .from("submissions")
      .select("*, quizzes(*), result_tiers(*)")
      .eq("id", submission_id)
      .single();
    if (sErr || !sub) throw new Error(sErr?.message || "Submission not found");

    const quiz = (sub as any).quizzes;
    const tier = (sub as any).result_tiers;
    const branding: Branding = quiz?.branding ?? {};

    // 2) Look up the per-tenant Resend config (quiz-specific first, then owner default)
    const { data: cfg } = await sb
      .from("email_provider_configs")
      .select("*")
      .eq("provider", "resend")
      .or(`quiz_id.eq.${quiz.id},and(owner_id.eq.${quiz.owner_id},quiz_id.is.null)`)
      .order("quiz_id", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (!cfg?.api_key) {
      return new Response(
        JSON.stringify({
          ok: false,
          skipped: true,
          reason: "No Resend API key configured for this quiz/owner.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3) Build the public results / booking redirect URL
    const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/q\/.*$/, "") || "";
    const ctaUrl =
      quiz.settings?.booking_url
        ? `${origin}/r/booking/${submission_id}`
        : undefined;
    const ctaLabel =
      tier?.cta_text || branding.button_label || "Book a discovery call";

    // 4) Render
    const subject =
      tier?.email_subject || `Your ${quiz.title} results`;
    const intro =
      tier?.email_intro || "Thanks for completing the assessment. Here's a summary of your results.";
    const body =
      tier?.email_body || tier?.description || "";

    const html = renderEmail({
      branding,
      quizTitle: quiz.title,
      recipientName: (sub as any).prospect_name || "there",
      score: Number((sub as any).total_score),
      max: Number((sub as any).max_score),
      pct: Number((sub as any).percentage),
      tierName: tier?.name || "Your result",
      intro,
      body,
      ctaUrl,
      ctaLabel: ctaUrl ? ctaLabel : undefined,
    });

    // 5) Send via Resend
    const fromEmail = cfg.from_email || "onboarding@resend.dev";
    const fromName = cfg.from_name || quiz.title;
    const fromHeader = `${fromName} <${fromEmail}>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromHeader,
        to: [(sub as any).prospect_email],
        subject,
        html,
      }),
    });

    const resendBody = await resendRes.text();
    if (!resendRes.ok) {
      console.error("Resend error", resendRes.status, resendBody);
      return new Response(
        JSON.stringify({ ok: false, error: `Resend ${resendRes.status}: ${resendBody}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
