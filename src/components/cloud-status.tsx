"use client";

import { useEffect, useState } from "react";
import { CloudOff, Radio, Send } from "lucide-react";

import { createOptionalBrowserClient } from "@/lib/supabase/client";

interface CloudSession {
  id: string;
  status: string;
  mode: "automatic" | "recommendation";
}

export function CloudStatus() {
  const [state, setState] = useState<"unconfigured" | "connecting" | "connected">(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ? "connecting"
      : "unconfigured",
  );
  const [latestEvent, setLatestEvent] = useState<string>("Local fixture active");
  const [session, setSession] = useState<CloudSession | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [pendingAction, setPendingAction] = useState<"buy" | "sell" | "risk_halt" | null>(null);
  const [localWorker, setLocalWorker] = useState(false);

  useEffect(() => {
    const localWorkerUrl =
      process.env.NEXT_PUBLIC_FDAX_LOCAL_WORKER_URL ??
      (["localhost", "127.0.0.1"].includes(window.location.hostname) ? "http://127.0.0.1:8787" : undefined);
    if (
      localWorkerUrl &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ) {
      void fetch(`${localWorkerUrl}/api/health`)
        .then((response) => response.ok && setLocalWorker(true))
        .catch(() => undefined);
    }
    const supabase = createOptionalBrowserClient();
    if (!supabase) return;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setLatestEvent("Sign in to control a synchronized Mac worker.");
        return;
      }
      const { data } = await supabase
        .from("replay_sessions")
        .select("id,status,mode")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setSession(data as CloudSession);
    })();
    const channel = supabase
      .channel("fdax-dashboard")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "signals" },
        (payload) => {
          const action = String(payload.new.action);
          setLatestEvent(`Cloud signal received: ${action.toUpperCase()}`);
          if (action === "buy" || action === "sell" || action === "risk_halt") {
            setPendingAction(action);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "replay_sessions" },
        (payload) => {
          const current = payload.new as CloudSession | undefined;
          if (current?.id) setSession(current);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setState("connected");
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  async function command(kind: string) {
    const supabase = createOptionalBrowserClient();
    if (!supabase || !session) return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setFeedback("Sign in before sending commands.");
      return;
    }
    const { error } = await supabase.from("worker_commands").insert({
      session_id: session.id,
      user_id: data.user.id,
      kind,
      idempotency_key: crypto.randomUUID(),
    });
    setFeedback(error ? error.message : `${kind.replaceAll("_", " ")} command queued.`);
  }

  return (
    <article className="panel cloud-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Worker Connection</p>
          <h2>{state === "connected" ? "Supabase realtime ready" : localWorker ? "Local worker ready" : "Local-first paper sessions"}</h2>
        </div>
        <span className={`badge ${state === "connected" ? "safe" : "warn"}`}>
          {state === "connected" ? <Radio size={13} /> : <CloudOff size={13} />}
          {state === "connected" ? "Connected" : "Sync not configured"}
        </span>
      </div>
      <p className="muted">
        {state === "connected"
          ? "Compact worker updates appear through owner-protected realtime channels."
          : "Delayed and CSV paper sessions run on your Mac. Configure Supabase only when you want compact remote dashboard sync."}
      </p>
      <div className="activity-line">{localWorker && state !== "connected" ? "Loopback worker API detected." : latestEvent}</div>
      {state === "connected" && session && (
        <div className="cloud-controls">
          <p>
            Remote session <code>{session.id.slice(0, 8)}</code> / {session.status.replaceAll("_", " ")}
          </p>
          <div className="buttons">
            {session.status === "created" && (
              <button className="primary" onClick={() => void command("start")}>
                <Send size={14} /> Start worker
              </button>
            )}
            {session.status === "paused_for_action" && (
              <>
                {pendingAction === "buy" ? (
                  <button className="primary" onClick={() => void command("approve_entry")}>
                    Approve entry
                  </button>
                ) : (
                  <button className="primary" onClick={() => void command("approve_exit")}>
                    Approve exit
                  </button>
                )}
                <button className="ghost" onClick={() => void command("skip_signal")}>
                  Skip
                </button>
              </>
            )}
            {session.status !== "completed" && session.status !== "stopped" && (
              <button className="ghost" onClick={() => void command("stop")}>
                Stop
              </button>
            )}
          </div>
          {feedback && <small className="muted">{feedback}</small>}
        </div>
      )}
    </article>
  );
}
