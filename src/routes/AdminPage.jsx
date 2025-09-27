import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

/** ---------- weighting (manual now; Twitch later) ---------- */
function score(sub) {
  const base = 1;
  const feedbackBonus = sub.wants_feedback ? 0.35 : 0;
  const manual = Number(sub.manual_weight || 0);
  return Math.max(0, base + feedbackBonus + manual); // never negative
}

function weightedPick(items, getWeight) {
  const weights = items.map(getWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items.at(-1);
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [portalOpen, setPortalOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);

  const [queue, setQueue] = useState([]);         // status = QUEUED (active session only)
  const [playing, setPlaying] = useState(null);   // { now, submission } (current now_playing)
  const [previous, setPrevious] = useState([]);   // DENIED/FINALIST from active session
  const [finalists, setFinalists] = useState([]); // FINALIST (active session)

  // --- AUTH ------------------------------------------------------------------
  useEffect(() => {
    const init = async () => {
      const { data: s } = await supabase.auth.getSession();
      setSession(s.session);

      if (!s.session) {
        setLoading(false);
        return;
      }
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) {
        setLoading(false);
        return;
      }
      const { data: adminRow } = await supabase
        .from("admins")
        .select("user_id")
        .eq("user_id", uid)
        .maybeSingle();

      setIsAdmin(Boolean(adminRow));
      setLoading(false);
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- LOADERS ---------------------------------------------------------------
  const fetchPortal = useCallback(async () => {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "portal")
      .single();
    setPortalOpen(Boolean(data?.value?.open));
  }, []);

  const fetchActiveSession = useCallback(async () => {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "session")
      .maybeSingle();
    const sid = data?.value?.active_session_id || null;
    setActiveSessionId(sid);
    return sid;
  }, []);

  const fetchPlaying = useCallback(async () => {
    const { data: np, error: npErr } = await supabase
      .from("now_playing")
      .select("submission_id, started_at")
      .maybeSingle();
    if (npErr) {
      console.error("fetchPlaying error:", npErr);
      setPlaying(null);
      return;
    }
    if (np?.submission_id) {
      const { data: subm, error: subErr } = await supabase
        .from("submissions")
        .select("*")
        .eq("id", np.submission_id)
        .single();
      if (subErr) {
        console.error("fetchPlaying join error:", subErr);
        setPlaying(null);
      } else {
        setPlaying({ now: np, submission: subm });
      }
    } else {
      setPlaying(null);
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    if (!activeSessionId) return;
    const { data: q } = await supabase
      .from("submissions")
      .select("*")
      .eq("session_id", activeSessionId)
      .eq("status", "QUEUED")
      .order("created_at", { ascending: true });
    setQueue(q || []);
  }, [activeSessionId]);

  const fetchPrevious = useCallback(async () => {
    if (!activeSessionId) return;
    const { data: prev } = await supabase
      .from("submissions")
      .select("*")
      .eq("session_id", activeSessionId)
      .in("status", ["FINALIST", "DENIED"])
      .order("created_at", { ascending: false })
      .limit(50);
    setPrevious(prev || []);
  }, [activeSessionId]);

  const fetchFinalists = useCallback(async () => {
    if (!activeSessionId) return;
    const { data } = await supabase
      .from("submissions")
      .select("*")
      .eq("session_id", activeSessionId)
      .eq("status", "FINALIST")
      .order("created_at", { ascending: false });
    setFinalists(data || []);
  }, [activeSessionId]);

  // Master refresh
  const refreshAll = useCallback(async () => {
    const sid = activeSessionId || (await fetchActiveSession());
    await Promise.all([
      fetchPortal(),
      fetchPlaying(),
      sid ? fetchQueue() : Promise.resolve(),
      sid ? fetchPrevious() : Promise.resolve(),
      sid ? fetchFinalists() : Promise.resolve(),
    ]);
  }, [activeSessionId, fetchActiveSession, fetchPortal, fetchPlaying, fetchQueue, fetchPrevious, fetchFinalists]);

  // initial load + realtime
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      await refreshAll();
    })();

    const chSubmissions = supabase
      .channel("submissions-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submissions" },
        () => {
          fetchQueue();
          fetchPrevious();
          fetchFinalists();
          fetchPlaying();
        }
      )
      .subscribe();

    const chNow = supabase
      .channel("now-playing-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "now_playing" },
        fetchPlaying
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chSubmissions);
      supabase.removeChannel(chNow);
    };
  }, [isAdmin, refreshAll, fetchQueue, fetchPrevious, fetchFinalists, fetchPlaying]);

  // --- ACTIONS ---------------------------------------------------------------
  const signIn = async () => {
    const email = prompt("Enter email for magic link sign-in:");
    if (!email) return;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + "/admin" },
    });
    if (error) alert(error.message);
    else alert("Check your email for a magic link.");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setIsAdmin(false);
  };

  const togglePortal = async () => {
    const next = !portalOpen;
    setPortalOpen(next);
    await supabase
      .from("settings")
      .upsert({ key: "portal", value: { open: next } });
    await supabase.from("admin_actions").insert({
      action: "TOGGLE_PORTAL",
      payload: { open: next },
    });
  };

  const pickNext = async () => {
    if (!activeSessionId) {
      alert("No active session.");
      return;
    }
    const { data: q } = await supabase
      .from("submissions")
      .select("*")
      .eq("session_id", activeSessionId)
      .eq("status", "QUEUED")
      .order("created_at", { ascending: true });

    const items = q || [];
    if (!items.length) return alert("No submissions in queue.");

    const picked = weightedPick(items, score);
    if (!picked) return alert("Couldn’t pick a submission.");

    await supabase.from("submissions").update({ status: "PLAYING" }).eq("id", picked.id);
    await supabase.from("now_playing").upsert({
      id: true,
      submission_id: picked.id,
      started_at: new Date().toISOString(),
    });
    await supabase.from("admin_actions").insert({
      action: "PICK_NEXT",
      payload: { submission_id: picked.id },
    });

    await Promise.all([fetchPlaying(), fetchQueue()]);
  };

  const acceptNowPlaying = async () => {
    const id = playing?.submission?.id;
    if (!id) return;
    await supabase.from("submissions").update({ status: "FINALIST" }).eq("id", id);
    await supabase.from("admin_actions").insert({ action: "ACCEPT", payload: { submission_id: id } });
    await Promise.all([fetchFinalists(), fetchPrevious(), fetchPlaying()]);
  };

  const denyNowPlaying = async () => {
    const id = playing?.submission?.id;
    if (!id) return;
    await supabase.from("submissions").update({ status: "DENIED" }).eq("id", id);
    await supabase.from("admin_actions").insert({ action: "DENY", payload: { submission_id: id } });
    await Promise.all([fetchPrevious(), fetchPlaying()]);
  };

  const nudgeWeight = async (submissionId, delta) => {
    const next = Math.max(
      0,
      Number((queue.find((s) => s.id === submissionId) ||
              previous.find((s) => s.id === submissionId) ||
              finalists.find((s) => s.id === submissionId) ||
              { manual_weight: 0 }).manual_weight) + delta
    );
    await supabase.from("submissions").update({ manual_weight: next }).eq("id", submissionId);
    await Promise.all([fetchQueue(), fetchPrevious(), fetchFinalists()]);
  };

  const requeue = async (submissionId) => {
    await supabase.from("submissions").update({ status: "QUEUED" }).eq("id", submissionId);
    await Promise.all([fetchQueue(), fetchPrevious()]);
  };

  // Play helper (opens SoundCloud in new tab for now)
  const openExternal = (url) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
    // later: window.location.href = `uxviz://play?url=${encodeURIComponent(url)}`;
  };

  // NEW: End current session & start fresh
  const newSession = async () => {
    if (!confirm("End current session and start a new one? This hides all current items from the admin view (they stay archived).")) {
      return;
    }

    // 1) read current active session id
    const { data: cur } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "session")
      .maybeSingle();
    const currentId = cur?.value?.active_session_id || null;

    // 2) end it
    if (currentId) {
      await supabase
        .from("sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", currentId);
    }

    // 3) create a new one
    const { data: ins, error: insErr } = await supabase
      .from("sessions")
      .insert({ name: `Session ${new Date().toLocaleDateString()}` })
      .select("id")
      .single();
    if (insErr) {
      alert("Could not create a new session.");
      return;
    }
    const newId = ins.id;

    // 4) set as active in settings
    await supabase
      .from("settings")
      .upsert({ key: "session", value: { active_session_id: newId } });

    // 5) clear now_playing
    await supabase.from("now_playing").upsert({
      id: true,
      submission_id: null,
      started_at: null,
    });

    setActiveSessionId(newId);
    await refreshAll();
    alert("New session started. Queue is now empty for this session.");
  };

  // --- UI --------------------------------------------------------------------
  if (loading) return <div>Loading…</div>;

  if (!session || !isAdmin) {
    return (
      <div className="card">
        <h2 className="text-xl font-semibold mb-2">Admin sign-in</h2>
        <p className="opacity-80 mb-4">Use your email (must be in the <code>admins</code> table).</p>
        <button className="btn" onClick={async () => {
          const email = prompt("Enter email for magic link sign-in:");
          if (!email) return;
          const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: window.location.origin + "/admin" },
          });
          if (error) alert(error.message);
          else alert("Check your email for a magic link.");
        }}>Send magic link</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ADMIN HEADER */}
      <div className="card flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold">Admin</div>
          <div className="opacity-70 text-sm">
            Portal:{" "}
            <span className={portalOpen ? "text-uxorange" : "text-uxred"}>
              {portalOpen ? "OPEN" : "CLOSED"}
            </span>
            {" · "}
            Session: <span className="opacity-100">{activeSessionId ? activeSessionId.slice(0, 8) : "…"}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={refreshAll}>Refresh</button>
          <button className="btn" onClick={togglePortal}>
            {portalOpen ? "Close portal" : "Open portal"}
          </button>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </div>

      {/* NOW PLAYING */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Now playing</h3>
          <button className="btn" onClick={pickNext}>Pick next</button>
        </div>
        {playing ? (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium">{playing.submission.display_name}</div>
              <div className="text-sm opacity-80 break-all">{playing.submission.soundcloud_url}</div>
              <div className="text-xs opacity-60">
                started {new Date(playing.now.started_at).toLocaleTimeString()}
              </div>
            </div>
            <div className="shrink-0 flex gap-2">
              <button className="btn" onClick={() => openExternal(playing.submission.soundcloud_url)}>Play</button>
              <button className="btn" onClick={acceptNowPlaying}>Accept → Finalists</button>
              <button className="btn" onClick={denyNowPlaying}>Deny → Previous</button>
            </div>
          </div>
        ) : (
          <div className="opacity-70 text-sm">Nothing playing.</div>
        )}
      </div>

      {/* QUEUE */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Queue ({queue.length})</h3>
        <div className="space-y-2">
          {queue.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-4 border-b border-uxgray/50 pb-2">
              <div className="min-w-0">
                <div className="font-medium">{s.display_name}</div>
                <div className="text-sm opacity-80 break-all">{s.soundcloud_url}</div>
                <div className="text-xs opacity-60">
                  feedback: {s.wants_feedback ? "yes" : "no"} · weight: {Number(s.manual_weight || 0).toFixed(2)}
                </div>
              </div>
              <div className="shrink-0 flex flex-wrap gap-2">
                <button className="btn" onClick={() => nudgeWeight(s.id, +0.25)}>+ weight</button>
                <button className="btn" onClick={() => nudgeWeight(s.id, -0.25)}>- weight</button>
              </div>
            </div>
          ))}
          {!queue.length && <div className="opacity-70 text-sm">Queue is empty.</div>}
        </div>
      </div>

      {/* FINALISTS */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Finalists ({finalists.length})</h3>
        <div className="space-y-2">
          {finalists.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-4 border-b border-uxgray/50 pb-2">
              <div className="min-w-0">
                <div className="font-medium">{s.display_name}</div>
                <div className="text-sm opacity-80 break-all">{s.soundcloud_url}</div>
                <div className="text-xs opacity-60">
                  weight: {Number(s.manual_weight || 0).toFixed(2)} · {new Date(s.created_at).toLocaleString()}
                </div>
              </div>
              <div className="shrink-0 flex flex-wrap gap-2">
                <button className="btn" onClick={() => nudgeWeight(s.id, +0.25)}>+ weight</button>
                <button className="btn" onClick={() => nudgeWeight(s.id, -0.25)}>- weight</button>
                <button className="btn" onClick={() => requeue(s.id)}>Re-queue</button>
              </div>
            </div>
          ))}
          {!finalists.length && <div className="opacity-70 text-sm">No finalists yet.</div>}
        </div>
      </div>

      {/* PREVIOUS */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Previous (Denied & Accepted history)</h3>
        <div className="space-y-2">
          {previous.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-4 border-b border-uxgray/50 pb-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {s.display_name} <span className="text-xs opacity-70">[{s.status}]</span>
                </div>
                <div className="text-sm opacity-80 break-all">{s.soundcloud_url}</div>
                <div className="text-xs opacity-60">
                  weight: {Number(s.manual_weight || 0).toFixed(2)} · {new Date(s.created_at).toLocaleString()}
                </div>
              </div>
              <div className="shrink-0 flex flex-wrap gap-2">
                <button className="btn" onClick={() => requeue(s.id)}>Re-queue</button>
                <button className="btn" onClick={() => nudgeWeight(s.id, +0.25)}>+ weight</button>
                <button className="btn" onClick={() => nudgeWeight(s.id, -0.25)}>- weight</button>
              </div>
            </div>
          ))}
          {!previous.length && <div className="opacity-70 text-sm">Nothing yet.</div>}
        </div>
      </div>

      {/* NEW SESSION / CLEAR */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Session controls</h3>
        <p className="opacity-80 mb-3">
          Start a fresh session at the end of stream. Old items are archived under their session and won’t show here.
        </p>
        <div className="flex gap-2">
          <button className="btn" onClick={newSession}>End current session & start new</button>
        </div>
      </div>
    </div>
  );
}
