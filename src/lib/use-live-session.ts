"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ConnectionStatus, DecisionMode, ExchangeId } from "@/lib/domain";
import { LIVE_INSTRUMENTS } from "@/lib/domain";
import { connectFeed, type FeedConnection } from "@/lib/live-feed";
import { LiveEngine, type LiveSnapshot } from "@/lib/live-engine";

const EXCHANGE_ORDER: ExchangeId[] = ["binance", "bybit"];
const SNAPSHOT_INTERVAL_MS = 750;
const MAX_ATTEMPTS = 6;
const DEFAULT_LOSS_LIMIT_USD = 100_000; // effectively off for normal 1-minute moves

export interface LiveSessionApi {
  snapshot: LiveSnapshot;
  connection: ConnectionStatus;
  exchange: ExchangeId;
  instrumentSymbol: string;
  decisionMode: DecisionMode;
  setDecisionMode: (mode: DecisionMode) => void;
  setInstrument: (symbol: string) => void;
  approve: () => void;
  skip: () => void;
  reset: () => void;
}

function emptySnapshot(): LiveSnapshot {
  return {
    status: "running",
    bars: [],
    signals: [],
    fills: [],
    trades: [],
    thresholds: { orderflow: 0, volume: 0, sample: 0, calibrated: false },
    realizedPnl: 0,
    openPnl: 0,
    position: null,
    pending: null,
    lastBid: null,
    lastAsk: null,
    lastPrice: null,
  };
}

export function useLiveSession(initialSymbol = "BTCUSDT", initialMode: DecisionMode = "automatic"): LiveSessionApi {
  const [instrumentSymbol, setInstrumentSymbol] = useState(initialSymbol);
  const [decisionMode, setDecisionModeState] = useState<DecisionMode>(initialMode);
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(emptySnapshot);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [exchange, setExchange] = useState<ExchangeId>("binance");

  const engineRef = useRef<LiveEngine | null>(null);
  const feedRef = useRef<FeedConnection | null>(null);
  const exchangeIndexRef = useRef(0);
  const attemptsRef = useRef(0);
  const openedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  // (Re)build the engine and connect the feed whenever the instrument changes.
  useEffect(() => {
    aliveRef.current = true;
    const instrument = LIVE_INSTRUMENTS[instrumentSymbol] ?? LIVE_INSTRUMENTS.BTCUSDT;
    const engine = new LiveEngine({ instrument, decisionMode, dailyLossLimitUsd: DEFAULT_LOSS_LIMIT_USD });
    engineRef.current = engine;
    exchangeIndexRef.current = 0;
    attemptsRef.current = 0;

    function clearRetry() {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    }

    function connect() {
      if (!aliveRef.current) return;
      const nextExchange = EXCHANGE_ORDER[exchangeIndexRef.current % EXCHANGE_ORDER.length];
      openedRef.current = false;
      setExchange(nextExchange);
      setConnection(attemptsRef.current === 0 ? "connecting" : nextExchange === "binance" ? "reconnecting" : "fallback");

      feedRef.current = connectFeed(nextExchange, instrument.symbol, {
        onTick: (tick) => engineRef.current?.ingest(tick),
        onOpen: () => {
          if (!aliveRef.current) return;
          openedRef.current = true;
          attemptsRef.current = 0;
          setConnection(nextExchange === "binance" ? "live" : "fallback");
        },
        onError: () => {
          /* close handler drives retry */
        },
        onClose: () => {
          if (!aliveRef.current) return;
          // If this venue never opened, advance to the fallback venue.
          if (!openedRef.current) exchangeIndexRef.current += 1;
          attemptsRef.current += 1;
          if (attemptsRef.current > MAX_ATTEMPTS) {
            setConnection("unreachable");
            return;
          }
          const backoff = Math.min(1_000 * 2 ** Math.min(attemptsRef.current, 4), 15_000);
          setConnection("reconnecting");
          clearRetry();
          retryTimerRef.current = setTimeout(connect, backoff);
        },
      });
    }

    connect();
    const poll = setInterval(() => {
      if (engineRef.current) setSnapshot(engineRef.current.snapshot());
    }, SNAPSHOT_INTERVAL_MS);

    return () => {
      aliveRef.current = false;
      clearRetry();
      clearInterval(poll);
      feedRef.current?.close();
      feedRef.current = null;
    };
    // decisionMode handled separately so toggling it never drops the feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentSymbol]);

  // Apply decision-mode changes without resetting the engine or feed.
  useEffect(() => {
    engineRef.current?.setDecisionMode(decisionMode);
  }, [decisionMode]);

  const setDecisionMode = useCallback((mode: DecisionMode) => setDecisionModeState(mode), []);
  const setInstrument = useCallback((symbol: string) => {
    // Reset the view here (event handler) so the instrument effect stays free of
    // synchronous setState. The new engine starts empty until the first poll.
    setSnapshot(emptySnapshot());
    setInstrumentSymbol(symbol);
  }, []);
  const approve = useCallback(() => {
    engineRef.current?.resolve(true);
    if (engineRef.current) setSnapshot(engineRef.current.snapshot());
  }, []);
  const skip = useCallback(() => {
    engineRef.current?.resolve(false);
    if (engineRef.current) setSnapshot(engineRef.current.snapshot());
  }, []);
  const reset = useCallback(() => {
    // Rebuild by nudging the instrument effect: briefly clear then restore.
    setInstrumentSymbol((current) => current);
    const instrument = LIVE_INSTRUMENTS[instrumentSymbol] ?? LIVE_INSTRUMENTS.BTCUSDT;
    engineRef.current = new LiveEngine({ instrument, decisionMode, dailyLossLimitUsd: DEFAULT_LOSS_LIMIT_USD });
    setSnapshot(emptySnapshot());
  }, [instrumentSymbol, decisionMode]);

  return {
    snapshot,
    connection,
    exchange,
    instrumentSymbol,
    decisionMode,
    setDecisionMode,
    setInstrument,
    approve,
    skip,
    reset,
  };
}
