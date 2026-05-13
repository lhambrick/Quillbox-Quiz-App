import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function PreviewTab({ quizId }: { quizId: string }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("quizzes").select("slug,is_published").eq("id", quizId).single();
      setSlug((data as any)?.slug ?? null);
      setPublished(!!(data as any)?.is_published);
    })();
  }, [quizId]);

  if (!slug) {
    return <div className="text-sm text-muted-foreground">Add a URL slug in the Settings tab to preview.</div>;
  }

  const url = `/q/${slug}?preview=1`;
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Live preview ({published ? "published" : "draft — only visible to you"}):{" "}
        <a className="underline" href={url} target="_blank" rel="noreferrer">{url}</a>
      </div>
      <div className="rounded-lg border bg-card overflow-hidden h-[70vh]">
        <iframe src={url} title="Quiz preview" className="w-full h-full" />
      </div>
    </div>
  );
}
