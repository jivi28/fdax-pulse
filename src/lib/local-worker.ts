import type {
  DataSufficiency,
  MinuteBar,
  ReplaySignal,
  SessionSourceMode,
  SessionStatus,
  SourceHealth,
  WorkerSession,
} from "@/lib/domain";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : {};
}

function workerUrl() {
  const configured = process.env.NEXT_PUBLIC_FDAX_LOCAL_WORKER_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "http://127.0.0.1:8787";
  }
  return null;
}

async function call(path: string, init?: RequestInit) {
  const base = workerUrl();
  if (!base) throw new Error("Local worker is available only from a local dashboard or through optional sync.");
  const response = await fetch(`${base}${path}`, init);
  const body = (await response.json()) as JsonRecord;
  if (!response.ok) throw new Error(String(body.error ?? "Local worker request failed."));
  return body;
}

function sourceHealth(value: unknown): SourceHealth {
  const payload = record(value);
  const selected = record(payload.selected_contract);
  return {
    sourceName: String(payload.source_name ?? "Deutsche Boerse / Eurex delayed data"),
    sourceMode: payload.source_mode as SessionSourceMode | undefined,
    delayMinutes: payload.delay_minutes === null ? null : Number(payload.delay_minutes ?? 15),
    sufficiency: String(payload.sufficiency ?? "terms_required") as DataSufficiency,
    message: String(payload.message ?? ""),
    latestExchangeTimestamp: payload.latest_exchange_timestamp
      ? String(payload.latest_exchange_timestamp)
      : undefined,
    latestReceivedTimestamp: payload.latest_received_timestamp
      ? String(payload.latest_received_timestamp)
      : undefined,
    selectedContract: selected.maturity_date
      ? {
          productIsin: String(selected.product_isin),
          maturityDate: String(selected.maturity_date),
          symbol: "FDAX",
          pointValueEur: Number(selected.point_value_eur),
          minimumPriceIncrement: Number(selected.minimum_price_increment),
          tickValueEur: Number(selected.tick_value_eur),
        }
      : undefined,
    rowsReceived: Number(payload.rows_received ?? 0),
    rowsAccepted: Number(payload.rows_accepted ?? 0),
    rowsQuarantined: Number(payload.rows_quarantined ?? 0),
  };
}

function minuteTime(startsAt: string) {
  return new Date(startsAt).toLocaleTimeString("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function normalizeSession(value: unknown): WorkerSession | null {
  const payload = record(value);
  if (!payload.session_id || !Array.isArray(payload.bars)) return null;
  const bars: MinuteBar[] = payload.bars.map((input, index) => {
    const bar = record(input);
    return {
      id: `${String(bar.starts_at)}-${index}`,
      localTime: minuteTime(String(bar.starts_at)),
      close: Number(bar.close_price),
      bid: Number(bar.last_bid),
      ask: Number(bar.last_ask),
      orderflow: Number(bar.orderflow),
      volume: Number(bar.volume),
      buyVolume: Number(bar.buy_volume),
      sellVolume: Number(bar.sell_volume),
      unclassifiedVolume: Number(bar.unclassified_volume),
    };
  });
  const signals: ReplaySignal[] = Array.isArray(payload.signals)
    ? payload.signals.map((input) => {
        const signal = record(input);
        return {
          id: String(signal.id),
          time: minuteTime(String(signal.timestamp)),
          action: signal.action as ReplaySignal["action"],
          reason: String(signal.reason),
          orderflow: Number(signal.orderflow),
          volume: Number(signal.volume),
          status: signal.status as ReplaySignal["status"],
        };
      })
    : [];
  const fills = Array.isArray(payload.fills)
    ? payload.fills.map((input, index) => {
        const fill = record(input);
        return {
          id: `${String(fill.timestamp)}-${index}`,
          time: minuteTime(String(fill.timestamp)),
          side: fill.side as "buy" | "sell",
          price: Number(fill.price),
          reason: String(fill.reason),
        };
      })
    : [];
  return {
    sessionId: String(payload.session_id),
    status: payload.status as SessionStatus,
    sourceMode: payload.source_mode as SessionSourceMode,
    source: String(payload.source),
    bars,
    signals,
    fills,
    realizedPnlEur: Number(payload.realized_pnl_eur),
    grossPnlEur: Number(payload.gross_pnl_eur),
    issues: Array.isArray(payload.issues)
      ? payload.issues.map((input) => {
          const issue = record(input);
          return { code: String(issue.code), message: String(issue.message) };
        })
      : [],
  };
}

export async function fetchLocalSources() {
  const payload = await call("/api/sources");
  return {
    health: sourceHealth(payload.delayed_paper),
    termsAcknowledged: payload.terms_acknowledged === true,
  };
}

export async function fetchLatestLocalSession() {
  return normalizeSession(await call("/api/sessions/latest"));
}

export async function acknowledgeOfficialTerms() {
  await call("/api/sources/deutsche-boerse/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accepted: true }),
  });
}

export async function qualifyOfficialFiles(pretrade: File, posttrade: File, maturityDate: string) {
  const body = new FormData();
  body.append("maturityDate", maturityDate);
  body.append("pretradeFile", pretrade);
  body.append("posttradeFile", posttrade);
  const payload = await call("/api/sources/deutsche-boerse/qualify", { method: "POST", body });
  return { health: sourceHealth(payload.health), preview: normalizeSession(payload.preview) };
}

interface SessionSettings {
  decisionMode: "automatic" | "recommendation";
  commissionPerSideEur: number;
  slippageTicks: number;
  dailyLossLimitEur: number;
}

export async function startDelayedSession(maturityDate: string, settings: SessionSettings) {
  return normalizeSession(
    await call("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceMode: "delayed_paper", maturityDate, ...settings }),
    }),
  );
}

export async function importCsvSession(csvFile: File, settings: SessionSettings) {
  const body = new FormData();
  body.append("csvFile", csvFile);
  body.append("decisionMode", settings.decisionMode);
  body.append("commissionPerSideEur", String(settings.commissionPerSideEur));
  body.append("slippageTicks", String(settings.slippageTicks));
  body.append("dailyLossLimitEur", String(settings.dailyLossLimitEur));
  return normalizeSession(await call("/api/imports/csv", { method: "POST", body }));
}

export async function stopDelayedSession(sessionId: string) {
  return commandDelayedSession(sessionId, "stop");
}

export async function commandDelayedSession(
  sessionId: string,
  kind: "approve_entry" | "approve_exit" | "skip_signal" | "stop",
) {
  const payload = await call(`/api/sessions/${sessionId}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, idempotencyKey: crypto.randomUUID() }),
  });
  return normalizeSession(payload.session);
}
