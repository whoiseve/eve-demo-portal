import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const SC_OEMBED = "https://soundcloud.com/oembed"; // returns embeddable HTML

export default function SubmitPage() {
  const [portalOpen, setPortalOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [url, setUrl] = useState("");
  const [wantsFeedback, setWantsFeedback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [message, setMessage] = useState("");

  // 1) read portal flag
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "portal")
        .single();
      if (!mounted) return;
      if (error) console.error(error);
      setPortalOpen(Boolean(data?.value?.open));
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  // 2) fetch SoundCloud oEmbed preview when URL changes
  useEffect(() => {
    if (!url) {
      setPreviewHtml("");
      return;
    }
    const controller = new AbortController();
    const run = async () => {
      try {
        const q = new URLSearchParams({ url, format: "json" }).toString();
        const res = await fetch(`${SC_OEMBED}?${q}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error("oEmbed failed");
        const j = await res.json();
        setPreviewHtml(j.html || "");
      } catch (e) {
        setPreviewHtml("");
      }
    };
    run();
    return () => controller.abort();
  }, [url]);

  const canSubmit = useMemo(() => {
    const looksLikeSc =
      /^https?:\/\/(soundcloud\.com|on\.soundcloud\.com)\//i.test(url);
    return portalOpen && displayName.trim().length >= 2 && looksLikeSc;
  }, [portalOpen, displayName, url]);

  // 3) insert into submissions
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setMessage("");
    const { error } = await supabase.from("submissions").insert({
      display_name: displayName.trim(),
      soundcloud_url: url.trim(),
      wants_feedback: wantsFeedback,
      // user_twitch_id: null // (later)
    });
    setSubmitting(false);

    if (error) {
      console.error(error);
      setMessage("Something went wrong. Please try again.");
      return;
    }
    setMessage("Submitted! Thanks for sending your track.");
    setDisplayName("");
    setUrl("");
    setWantsFeedback(false);
    setPreviewHtml("");
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-2xl font-semibold mb-2">Submit your demo</h1>
        <p className="opacity-80">
          Paste a SoundCloud track link. We’ll preview it and add it to the queue.
        </p>

        {!portalOpen && (
          <div className="mt-4 rounded-xl border border-uxred/50 bg-uxred/10 px-4 py-3 text-uxoffwhite">
            Portal is currently <span className="text-uxred font-semibold">closed</span>. Check back during stream.
          </div>
        )}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block mb-1 text-sm opacity-70">Display name</label>
            <input
              className="input"
              placeholder="Your name as you want it shown"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
            />
          </div>

          <div>
            <label className="block mb-1 text-sm opacity-70">SoundCloud URL</label>
            <input
              className="input"
              placeholder="https://soundcloud.com/artist/track"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm opacity-90">
            <input
              type="checkbox"
              checked={wantsFeedback}
              onChange={(e) => setWantsFeedback(e.target.checked)}
            />
            I’d like written feedback if possible
          </label>

          <button className="btn" disabled={!canSubmit || submitting}>
            {submitting ? "Submitting…" : "Submit"}
          </button>

          {message && <div className="mt-3 text-sm opacity-80">{message}</div>}
        </form>
      </div>

      {!!previewHtml && (
        <div className="card">
          <div className="mb-2 text-sm opacity-70">Preview</div>
          {/* oEmbed returns an iframe string */}
          <div
            className="aspect-video w-full overflow-hidden rounded-xl border border-uxgray/60"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      )}
    </div>
  );
}
