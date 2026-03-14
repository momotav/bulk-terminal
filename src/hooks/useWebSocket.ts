import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSSubscription, WSMessage } from '@/types';

const WS_URL = 'wss://exchange-wss1.northstarlabs.xyz';

interface UseWebSocketOptions {
  onMessage?: (message: WSMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    autoReconnect = true,
    reconnectInterval = 3000,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const [connected, setConnected] = useState(false);
  const [subscriptions, setSubscriptions] = useState<WSSubscription[]>([]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        onConnect?.();
        
        // Resubscribe to previous subscriptions
        if (subscriptions.length > 0) {
          ws.send(JSON.stringify({
            method: 'subscribe',
            subscription: subscriptions,
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WSMessage;
          onMessage?.(message);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        onDisconnect?.();
        
        if (autoReconnect) {
          reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      if (autoReconnect) {
        reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
      }
    }
  }, [onMessage, onConnect, onDisconnect, autoReconnect, reconnectInterval, subscriptions]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  const subscribe = useCallback((subs: WSSubscription[]) => {
    setSubscriptions(prev => [...prev, ...subs]);
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        method: 'subscribe',
        subscription: subs,
      }));
    }
  }, []);

  const unsubscribe = useCallback((topic: string) => {
    setSubscriptions(prev => prev.filter(s => {
      const subTopic = `${s.type}.${s.symbol || s.user || ''}`;
      return subTopic !== topic;
    }));

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        method: 'unsubscribe',
        topic,
      }));
    }
  }, []);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);

  return {
    connected,
    subscribe,
    unsubscribe,
    send,
    disconnect,
    reconnect: connect,
  };
}

// Hook for market data subscriptions
export function useMarketData(symbols: string[] = ['BTC-USD', 'ETH-USD', 'SOL-USD']) {
  const [tickers, setTickers] = useState<Record<string, any>>({});
  const [trades, setTrades] = useState<any[]>([]);
  const [orderbook, setOrderbook] = useState<{ bids: any[]; asks: any[] }>({ bids: [], asks: [] });

  const handleMessage = useCallback((message: WSMessage) => {
    switch (message.type) {
      case 'ticker':
        if (message.data?.ticker) {
          setTickers(prev => ({
            ...prev,
            [message.data.ticker.symbol]: message.data.ticker,
          }));
        }
        break;

      case 'trades':
        if (message.data?.trades) {
          setTrades(prev => [
            ...message.data.trades.map((t: any) => ({ ...t, id: `${t.time}-${Math.random()}` })),
            ...prev,
          ].slice(0, 100));
        }
        break;

      case 'l2Delta':
      case 'l2Snapshot':
        if (message.data?.book) {
          const book = message.data.book;
          if (book.updateType === 'snapshot') {
            setOrderbook({
              bids: book.levels[0] || [],
              asks: book.levels[1] || [],
            });
          } else {
            setOrderbook(prev => {
              const newBids = [...prev.bids];
              const newAsks = [...prev.asks];

              (book.levels[0] || []).forEach((level: any) => {
                const idx = newBids.findIndex(b => b.px === level.px);
                if (level.sz === 0) {
                  if (idx >= 0) newBids.splice(idx, 1);
                } else {
                  if (idx >= 0) newBids[idx] = level;
                  else newBids.push(level);
                }
              });

              (book.levels[1] || []).forEach((level: any) => {
                const idx = newAsks.findIndex(a => a.px === level.px);
                if (level.sz === 0) {
                  if (idx >= 0) newAsks.splice(idx, 1);
                } else {
                  if (idx >= 0) newAsks[idx] = level;
                  else newAsks.push(level);
                }
              });

              return {
                bids: newBids.sort((a, b) => b.px - a.px).slice(0, 20),
                asks: newAsks.sort((a, b) => a.px - b.px).slice(0, 20),
              };
            });
          }
        }
        break;

      case 'frontendContext':
        if (message.data?.ctx) {
          const newTickers: Record<string, any> = {};
          message.data.ctx.forEach((t: any) => {
            newTickers[t.symbol] = t;
          });
          setTickers(prev => ({ ...prev, ...newTickers }));
        }
        break;
    }
  }, []);

  const { connected, subscribe } = useWebSocket({ onMessage: handleMessage });

  useEffect(() => {
    if (connected) {
      const subs: WSSubscription[] = [
        ...symbols.map(symbol => ({ type: 'ticker', symbol })),
        { type: 'trades', symbol: symbols[0] },
        { type: 'l2Delta', symbol: symbols[0] },
        { type: 'frontendContext' },
      ];
      subscribe(subs);
    }
  }, [connected, symbols, subscribe]);

  return {
    connected,
    tickers: Object.values(tickers),
    trades,
    orderbook,
  };
}
