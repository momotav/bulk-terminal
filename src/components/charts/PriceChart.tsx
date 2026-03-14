'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { api } from '@/lib/api';
import { useStore } from '@/store';

const intervals = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1d', value: '1d' },
];

export function PriceChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  
  const [interval, setInterval] = useState('1h');
  const [loading, setLoading] = useState(true);
  
  const { selectedSymbol, theme } = useStore();

  const isDark = theme === 'dark';

  const initChart = useCallback(() => {
    if (!containerRef.current) return;

    // Clean up existing chart
    if (chartRef.current) {
      chartRef.current.remove();
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: isDark ? '#8888aa' : '#666666',
      },
      grid: {
        vertLines: { color: isDark ? '#1a1a25' : '#f0f0f0' },
        horzLines: { color: isDark ? '#1a1a25' : '#f0f0f0' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#00f0ff',
          width: 1,
          style: 2,
          labelBackgroundColor: '#00f0ff',
        },
        horzLine: {
          color: '#00f0ff',
          width: 1,
          style: 2,
          labelBackgroundColor: '#00f0ff',
        },
      },
      rightPriceScale: {
        borderColor: isDark ? '#2a2a40' : '#e0e0e0',
      },
      timeScale: {
        borderColor: isDark ? '#2a2a40' : '#e0e0e0',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#00ff88',
      downColor: '#ff3366',
      borderUpColor: '#00ff88',
      borderDownColor: '#ff3366',
      wickUpColor: '#00ff88',
      wickDownColor: '#ff3366',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [isDark]);

  const loadData = useCallback(async () => {
    if (!seriesRef.current) return;

    setLoading(true);
    try {
      const candles = await api.getCandles(selectedSymbol, interval);
      
      const chartData: CandlestickData[] = candles.map(c => ({
        time: (c.t / 1000) as Time,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      }));

      seriesRef.current.setData(chartData);
      chartRef.current?.timeScale().fitContent();
    } catch (error) {
      console.error('Failed to load chart data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedSymbol, interval]);

  useEffect(() => {
    initChart();
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
      }
    };
  }, [initChart]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="glass-card h-full flex flex-col">
      <div className="panel-header">
        <h2 className="panel-title">
          <span className="w-6 h-6 rounded-md bg-bulk-cyan/20 flex items-center justify-center text-bulk-cyan">
            📈
          </span>
          {selectedSymbol} Chart
        </h2>

        {/* Interval selector */}
        <div className="flex items-center gap-1 bg-dark-tertiary rounded-lg p-1">
          {intervals.map(int => (
            <button
              key={int.value}
              onClick={() => setInterval(int.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                interval === int.value
                  ? 'bg-bulk-cyan text-dark-primary'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {int.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-dark-secondary/50 backdrop-blur-sm z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-2 border-bulk-cyan border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-400">Loading chart...</span>
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full min-h-[400px]" />
      </div>
    </div>
  );
}
