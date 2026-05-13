import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || (import.meta as any).env?.VITE_SUPABASE_URL;
const SUPABASE_ANON =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;

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

function renderResultEmail(opts: {
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
  displayMode: "both" | "points" | "percent";
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
      ? `<div style="text-align:center;margin:32px 0"><a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;background:${primary};color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600">${escapeHtml(opts.ctaLabel)}</a></div>`
      : "";
  const introHtml = escapeHtml(opts.intro).replace(/\n/g, "<br>");
  const bodyHtml = escapeHtml(opts.body).replace(/\n/g, "<br>");
  const scoreHtml =
    opts.displayMode === "percent"
      ? `<div style="font-size:28px;font-weight:700;margin-top:4px">${opts.pct}%</div>`
      : opts.displayMode === "points"
      ? `<div style="font-size:28px;font-weight:700;margin-top:4px">${opts.score} / ${opts.max}</div>`
      : `<div style="font-size:28px;font-weight:700;margin-top:4px">${opts.score} / ${opts.max} <span style="font-size:16px;color:#666;font-weight:400">(${opts.pct}%)</span></div>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:${fontFamily};color:${fg}"><div style="max-width:600px;margin:0 auto;background:${bg};padding:40px 32px">${logo}<h1 style="margin:0 0 8px;font-size:22px">${escapeHtml(opts.quizTitle)}</h1><p style="margin:0 0 24px;color:#666;font-size:14px">Hi ${escapeHtml(opts.recipientName)}, here are your results.</p><div style="background:${primary}10;border-left:4px solid ${primary};padding:16px 20px;margin:0 0 24px;border-radius:4px"><div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#666">Your result</div>${scoreHtml}<div style="margin-top:8px;display:inline-block;background:${primary};color:#fff;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:600">${escapeHtml(opts.tierName)}</div></div>${introHtml ? `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">${introHtml}</p>` : ""}${bodyHtml ? `<div style="font-size:15px;line-height:1.6;margin:0 0 16px">${bodyHtml}</div>` : ""}${cta}<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0"/><p style="font-size:12px;color:#999;margin:0">You received this because you completed the assessment.</p></div></body></html>`;
}

// Replace {{merge_field}} tokens with values. Unknown tokens are left intact.
function applyMergeFields(text: string, vars: Record<string, string>): string {
  if (!text) return text;
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) => {
    const v = vars[key.toLowerCase()];
    return v == null ? m : v;
  });
}

export const sendQuizResult = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { submission_id: string; origin?: string }) => input,
  )
  .handler(async ({ data }) => {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
    const { data: payload, error } = await sb.rpc(
      "get_quiz_result_email_payload",
      { _submission_id: data.submission_id },
    );
    if (error) throw new Error(error.message);
    const p = payload as any;
    const sub = p.submission;
    const quiz = p.quiz;
    const tier = p.tier;
    const cfg = p.config;
    if (!cfg?.api_key) {
      return { ok: false, skipped: true, reason: "No Resend API key configured." };
    }
    const branding: Branding = quiz?.branding ?? {};
    const displayMode: "both" | "points" | "percent" =
      quiz?.settings?.results_display ?? "both";
    const ctaUrl = quiz.settings?.booking_url && data.origin
      ? `${data.origin}/r/booking/${data.submission_id}`
      : undefined;
    const ctaLabel = tier?.cta_text || branding.button_label || "Book a discovery call";

    const firstName: string =
      sub.prospect_first_name ||
      (sub.prospect_name ? String(sub.prospect_name).split(" ")[0] : "") ||
      "";
    const lastName: string =
      sub.prospect_last_name ||
      (sub.prospect_name
        ? String(sub.prospect_name).split(" ").slice(1).join(" ")
        : "") ||
      "";
    const fullName =
      `${firstName} ${lastName}`.trim() || sub.prospect_name || "";
    const scoreLabel =
      displayMode === "percent"
        ? `${Number(sub.percentage)}%`
        : displayMode === "points"
        ? `${Number(sub.total_score)} / ${Number(sub.max_score)}`
        : `${Number(sub.total_score)} / ${Number(sub.max_score)} (${Number(sub.percentage)}%)`;
    const mergeVars: Record<string, string> = {
      first_name: firstName,
      last_name: lastName,
      name: fullName,
      full_name: fullName,
      email: sub.prospect_email || "",
      company: sub.prospect_company || "",
      score: scoreLabel,
      points: `${Number(sub.total_score)} / ${Number(sub.max_score)}`,
      percentage: `${Number(sub.percentage)}%`,
      tier: tier?.name || "",
      quiz_title: quiz.title || "",
    };

    const subject = applyMergeFields(
      tier?.email_subject || `Your ${quiz.title} results`,
      mergeVars,
    );
    const intro = applyMergeFields(
      tier?.email_intro ||
        "Thanks for completing the assessment. Here's a summary of your results.",
      mergeVars,
    );
    const body = applyMergeFields(
      tier?.email_body || tier?.description || "",
      mergeVars,
    );

    const html = renderResultEmail({
      branding,
      quizTitle: quiz.title,
      recipientName: firstName || fullName || "there",
      score: Number(sub.total_score),
      max: Number(sub.max_score),
      pct: Number(sub.percentage),
      tierName: tier?.name || "Your result",
      intro,
      body,
      ctaUrl,
      ctaLabel: ctaUrl ? ctaLabel : undefined,
      displayMode,
    });
    const fromEmail = cfg.from_email || "onboarding@resend.dev";
    const fromName = cfg.from_name || quiz.title;

    // Per-tier attachments: fetch each URL and inline as base64 so Resend
    // attaches the file regardless of host CORS / signed-URL restrictions.
    const rawAtt = Array.isArray(tier?.email_attachments) ? tier.email_attachments : [];
    const attachments: Array<{ filename: string; content: string }> = [];
    for (const a of rawAtt) {
      if (!a?.url) continue;
      try {
        const r = await fetch(a.url);
        if (!r.ok) continue;
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        const b64 = btoa(bin);
        const fname = a.filename || a.url.split("/").pop() || "attachment";
        attachments.push({ filename: fname, content: b64 });
      } catch {
        // skip failed attachment
      }
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [sub.prospect_email],
        subject,
        html,
        ...(attachments.length ? { attachments } : {}),
      }),
    });
    const respText = await res.text();
    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${respText}`);
    }
    return { ok: true };
  });

export const sendInviteEmail = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { invite_id: string; accept_url: string; access_token: string }) => input,
  )
  .handler(async ({ data }) => {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${data.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: payload, error } = await sb.rpc("get_invite_email_payload", {
      _invite_id: data.invite_id,
    });
    if (error) throw new Error(error.message);
    const p = payload as any;
    const inv = p.invite;
    const quiz = p.quiz;
    const cfg = p.config;
    if (!cfg?.api_key) {
      return {
        ok: false,
        skipped: true,
        reason: "No Resend API key configured. Add one under the Email tab to send invite emails.",
      };
    }
    const branding = quiz?.branding ?? {};
    const primary = branding.primary || "#2563eb";
    const url = data.accept_url;
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,Segoe UI,sans-serif;color:#0f172a"><div style="max-width:560px;margin:0 auto;background:#fff;padding:40px 32px"><h1 style="margin:0 0 12px;font-size:22px">You're invited to collaborate</h1><p style="margin:0 0 16px;font-size:15px;line-height:1.5">You've been invited to join <strong>${escapeHtml(quiz.title)}</strong> as <strong>${escapeHtml(inv.role)}</strong>.</p><div style="text-align:center;margin:28px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:${primary};color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600">Accept invite</a></div><p style="font-size:13px;color:#666;line-height:1.5">Or paste this link in your browser:<br><span style="word-break:break-all">${escapeHtml(url)}</span></p><hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0"/><p style="font-size:12px;color:#999;margin:0">This invite expires on ${new Date(inv.expires_at).toLocaleDateString()}.</p></div></body></html>`;
    const fromEmail = cfg.from_email || "onboarding@resend.dev";
    const fromName = cfg.from_name || quiz.title;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [inv.email],
        subject: `You're invited to ${quiz.title}`,
        html,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${body}`);
    }
    return { ok: true };
  });
