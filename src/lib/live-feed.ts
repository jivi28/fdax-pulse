"use client";

import type { ExchangeId, LiveTick } from "@/lib/domain";

/**
 * Public futures market-data adapters. Both venues stream real tick trades plus
 * best bid/ask over a keyless WebSocket reachable directly from the browser
 * (wss over https, no CORS, no entitlement). This is the TAQ structure the
 * Pecchiari orderflow method needs.
 */

export interface FeedHandlers {
  onTick: (tick: LiveTick) => void;
  onOpen: () => void;
  onClose: () => void;
  onError: () => void;
}

export interface FeedConnection {
  close: () => void;
}

interface VenueState {
  bid: number | null;
  ask: number | null;
}

function emit(state: VenueState, partial: Omit<LiveTick, "bid" | "ask">, onTick: (tick: LiveTick) => void) {
  if (state.bid === null || state.ask === null) return;
  onTick({ ...partial, bid: state.bid, ask: state.ask });
}

/**
 * Binance USD-M Futures: btcusdt@trade + btcusdt@bookTicker.
 * Note: the futures `@aggTrade` stream does not deliver reliably; `@trade`
 * carries the same fields (price, qty, buyer-is-maker, time) and floods normally.
 */
function connectBinance(symbol: string, handlers: FeedHandlers): FeedConnection {
  const lower = symbol.toLowerCase();
  const url = `wss://fstream.binance.com/stream?streams=${lower}@trade/${lower}@bookTicker`;
  const socket = new WebSocket(url);
  const state: VenueState = { bid: null, ask: null };

  socket.onopen = handlers.onOpen;
  socket.onerror = handlers.onError;
  socket.onclose = handlers.onClose;
  socket.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data as string) as { stream?: string; data?: Record<string, unknown> };
      const data = frame.data;
      if (!data) return;
      if (frame.stream?.endsWith("@bookTicker")) {
        state.bid = Number(data.b);
        state.ask = Number(data.a);
      } else if (frame.stream?.endsWith("@trade")) {
        // `m` true => buyer is the maker => the seller was the aggressor.
        const buyerIsMaker = Boolean(data.m);
        emit(
          state,
          {
            time: Number(data.T),
            price: Number(data.p),
            size: Number(data.q),
            aggressor: buyerIsMaker ? "sell" : "buy",
          },
          handlers.onTick,
        );
      }
    } catch {
      // Ignore malformed frames; the feed self-heals on the next message.
    }
  };

  return { close: () => socket.close() };
}

/** Bybit v5 linear: publicTrade + orderbook.1 (best bid/ask). */
function connectBybit(symbol: string, handlers: FeedHandlers): FeedConnection {
  const url = "wss://stream.bybit.com/v5/public/linear";
  const socket = new WebSocket(url);
  const state: VenueState = { bid: null, ask: null };

  socket.onopen = () => {
    socket.send(JSON.stringify({ op: "subscribe", args: [`publicTrade.${symbol}`, `orderbook.1.${symbol}`] }));
    handlers.onOpen();
  };
  socket.onerror = handlers.onError;
  socket.onclose = handlers.onClose;
  socket.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data as string) as {
        topic?: string;
        type?: string;
        data?: unknown;
      };
      if (!frame.topic) return;
      if (frame.topic.startsWith("orderbook.1.")) {
        const book = frame.data as { b?: [string, string][]; a?: [string, string][] };
        if (book.b?.length) state.bid = Number(book.b[0][0]);
        if (book.a?.length) state.ask = Number(book.a[0][0]);
      } else if (frame.topic.startsWith("publicTrade.")) {
        const trades = frame.data as Array<{ T: number; p: string; v: string; S: string }>;
        for (const trade of trades) {
          emit(
            state,
            {
              time: Number(trade.T),
              price: Number(trade.p),
              size: Number(trade.v),
              aggressor: trade.S === "Buy" ? "buy" : "sell",
            },
            handlers.onTick,
          );
        }
      }
    } catch {
      // Ignore malformed frames.
    }
  };

  return { close: () => socket.close() };
}

export function connectFeed(exchange: ExchangeId, symbol: string, handlers: FeedHandlers): FeedConnection {
  return exchange === "binance" ? connectBinance(symbol, handlers) : connectBybit(symbol, handlers);
}
