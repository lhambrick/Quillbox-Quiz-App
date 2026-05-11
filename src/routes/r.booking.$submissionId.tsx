import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/r/booking/$submissionId")({
  component: BookingRedirect,
});

/**
 * Tracked redirect: logs a `booking_clicks` row for the submission, then
 * forwards to the quiz's configured booking URL (Calendly, Cal.com, HubSpot, etc.).
 */
function BookingRedirect() {
  const { submissionId } = Route.useParams();

  useEffect(() => {
    (async () => {
      try {
        // Look up the submission's quiz to get the booking URL.
        const { data: sub } = await supabase
          .from("submissions")
          .select("quiz_id, quizzes(settings)")
          .eq("id", submissionId)
          .maybeSingle();

        const url = (sub as any)?.quizzes?.settings?.booking_url;

        // Best-effort: log the click. Non-blocking if RLS rejects.
        await supabase.from("booking_clicks").insert({ submission_id: submissionId });

        if (url) {
          window.location.replace(url);
        } else {
          window.location.replace("/");
        }
      } catch {
        window.location.replace("/");
      }
    })();
  }, [submissionId]);

  return (
    <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">
      Redirecting to booking…
    </div>
  );
}
