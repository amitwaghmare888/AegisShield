"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';

/* ═══════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════ */
interface Finding {
  id: string;
  category: string;
  severity: 'critical' | 'high' | 'warning' | 'info';
  source: 'static' | 'ast' | 'ai';
  file: string;
  line: number;
  snippet: string;
  message: string;
  suggested_fix: string;
  weight: number;
}

interface ScanPayload {
  scan_id: string;
  risk_score: number;
  severity: string;
  findings: Finding[];
  counts: { critical: number; high: number; warning: number; info: number };
  files_scanned: number;
  duration_ms: number;
  label: string;
  can_download: boolean;
  raw_content?: string;
}

interface HistoryEntry {
  scan_id: string;
  timestamp: number;
  label: string;
  risk_score: number;
  finding_count: number;
  severity: string;
}

type ToastType = 'success' | 'warning' | 'error' | 'info';

/* ═══════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════ */
function esc(s: string | null | undefined): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SEV_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', warning: 'Warn', info: 'Info' };
const SEV_PILL: Record<string, string> = { critical: 'sev-high', high: 'sev-high', warning: 'sev-warn', info: 'sev-info' };
const SRC_LABEL: Record<string, string> = { static: 'Static', ast: 'AST', ai: 'AI' };
const RANK: Record<string, number> = { critical: 4, high: 3, warning: 2, info: 1 };

/* ═══════════════════════════════════════════════════
   Toast System
   ═══════════════════════════════════════════════════ */
let toastId = 0;
interface ToastItem { id: number; message: string; type: ToastType; removing?: boolean }

function ToastContainer({ toasts, onRemove }: { toasts: ToastItem[]; onRemove: (id: number) => void }) {
  return (
    <div className="toast-container">
      {toasts.slice(-3).map(t => (
        <div
          key={t.id}
          className={`toast toast-${t.type}${t.removing ? ' toast-out' : ''}`}
          onClick={() => onRemove(t.id)}
        >
          <span>{t.message}</span>
          <div className="toast-bar" />
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Copy Button
   ═══════════════════════════════════════════════════ */
function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard fail */ }
  };
  return (
    <button className={`copy-btn${copied ? ' copied' : ''}`} onClick={handleCopy}>
      {copied ? '✓ Copied' : label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════ */
export default function Home() {
  /* ── State ── */
  const [url, setUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanTimer, setScanTimer] = useState('0.0');
  const [currentScan, setCurrentScan] = useState<ScanPayload | null>(null);
  const [showAllFindings, setShowAllFindings] = useState(false);
  const [dropTitle, setDropTitle] = useState('Drop a third-party skill here');
  const [dropSub, setDropSub] = useState('.zip archive or single source file — up to 25\u00a0MB');

  // Gauge
  const [gaugeScore, setGaugeScore] = useState(0);
  const [gaugeLabel, setGaugeLabel] = useState('awaiting scan');
  const [gaugeState, setGaugeState] = useState('');
  const [gaugeStateLabel, setGaugeStateLabel] = useState('Idle');
  const [cntHigh, setCntHigh] = useState('—');
  const [cntWarn, setCntWarn] = useState('—');
  const [cntInfo, setCntInfo] = useState('—');
  const [displayScore, setDisplayScore] = useState('—');
  const [gaugeFillClass, setGaugeFillClass] = useState('');
  const [gaugeDashoffset, setGaugeDashoffset] = useState(100);

  // Wrapper modal
  const [wrapOpen, setWrapOpen] = useState(false);
  const [wrapInput, setWrapInput] = useState('');
  const [wrapOutput, setWrapOutput] = useState('');
  const [wrapOutputHtml, setWrapOutputHtml] = useState('<span style="color:var(--text-dim)">Run the wrapper to see redacted output here.</span>');
  const [wrapInStat, setWrapInStat] = useState('0 chars');
  const [wrapOutStat, setWrapOutStat] = useState('awaiting run');
  const [wrapSummary, setWrapSummary] = useState('Idle');

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Contact form
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [contactMessage, setContactMessage] = useState('');

  // AI Auto-Fix State
  const [aiFixes, setAiFixes] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});

  // AI Deep Scan State
  const [aiDeepFindings, setAiDeepFindings] = useState<Finding[]>([]);
  const [aiDeepLoading, setAiDeepLoading] = useState(false);
  const [aiDeepDone, setAiDeepDone] = useState(false);

  // AI Threat Summary State
  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  // AI Smart Redaction State
  const [aiRedactLoading, setAiRedactLoading] = useState(false);

  // Stats
  const [statsVisible, setStatsVisible] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);

  // Refs
  const fileRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanT0Ref = useRef(0);
  const rawCodeRef = useRef<string>(''); // stores last scanned source for AI deep scan

  /* ── Toast helper ── */
  const flash = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, removing: true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 350);
    }, 3000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, removing: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 350);
  }, []);

  /* ── Load history from localStorage ── */
  useEffect(() => {
    try {
      const stored = localStorage.getItem('aegisshield_history');
      if (stored) setHistory(JSON.parse(stored));
    } catch { /* no-op */ }
  }, []);

  const saveHistory = (entry: HistoryEntry) => {
    setHistory(prev => {
      const next = [entry, ...prev].slice(0, 50);
      try { localStorage.setItem('aegisshield_history', JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  };

  /* ── AI Auto-Fix Handler ── */
  async function generateAiFix(f: Finding) {
    setAiLoading(prev => ({ ...prev, [f.id]: true }));
    flash('Generating AI fix...', 'info');
    
    try {
      const r = await fetch('/api/ai/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          findingId: f.id,
          snippet: f.snippet,
          message: f.message,
          file: f.file,
          line: f.line
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to generate fix');
      
      setAiFixes(prev => ({ ...prev, [f.id]: data.fix }));
      flash('AI fix generated successfully', 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown AI error';
      flash(`AI Fix Failed: ${msg}`, 'error');
    } finally {
      setAiLoading(prev => ({ ...prev, [f.id]: false }));
    }
  }

  /* ── AI Deep Scan Handler ── */
  async function runAiDeepScan() {
    if (!currentScan) return;
    setAiDeepLoading(true); setAiDeepDone(false); setAiDeepFindings([]);
    flash('AI Deep Scan — analyzing code semantics...', 'info');
    try {
      // Use the stored raw source code; fall back to concatenated snippets if unavailable
      const codeToScan = rawCodeRef.current || currentScan.findings.map(f => f.snippet).join('\n');
      const r = await fetch('/api/ai/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeToScan, filename: currentScan.label }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'AI scan failed');
      const mapped: Finding[] = (data.findings || []).map(
        (af: { id?: string; category?: string; severity?: string; file?: string; line?: number; snippet?: string; message?: string; suggested_fix?: string; confidence?: number }) => ({
          id: String(af.id || 'AI_UNKNOWN'),
          category: String(af.category || 'AI Analysis'),
          severity: (['critical', 'high', 'warning', 'info'].includes(af.severity || '') ? af.severity : 'warning') as Finding['severity'],
          source: 'ai' as const,
          file: String(af.file || currentScan!.label),
          line: Number(af.line) || 0,
          snippet: String(af.snippet || ''),
          message: String(af.message || '') + (af.confidence ? ` (AI confidence: ${af.confidence}%)` : ''),
          suggested_fix: String(af.suggested_fix || ''),
          weight: af.severity === 'critical' ? 30 : af.severity === 'high' ? 20 : af.severity === 'warning' ? 12 : 4,
        })
      );
      setAiDeepFindings(mapped); setAiDeepDone(true);
      flash(mapped.length > 0 ? `AI Deep Scan found ${mapped.length} additional vulnerabilities` : 'AI Deep Scan complete — no additional issues found', mapped.length > 0 ? 'warning' : 'success');
    } catch (e: unknown) {
      flash(`AI Deep Scan failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error'); setAiDeepDone(true);
    } finally { setAiDeepLoading(false); }
  }

  /* ── AI Threat Summary Handler ── */
  async function generateAiSummary() {
    if (!currentScan) return;
    setAiSummaryLoading(true); setAiSummary('');
    flash('Generating AI threat summary...', 'info');
    try {
      const allF = [...(currentScan.findings || []), ...aiDeepFindings];
      const r = await fetch('/api/ai/summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findings: allF, riskScore: currentScan.risk_score, label: currentScan.label, fileCount: currentScan.files_scanned }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Summary generation failed');
      setAiSummary(data.summary);
      flash('AI threat summary generated', 'success');
    } catch (e: unknown) {
      flash(`AI Summary failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error');
    } finally { setAiSummaryLoading(false); }
  }

  /* ── AI Smart Redaction Handler ── */
  async function runAiRedact() {
    if (!wrapInput.trim()) { setWrapSummary('Paste something to redact first'); return; }
    setAiRedactLoading(true);
    setWrapSummary('AI analyzing context...');
    setWrapOutputHtml('<span style="color:var(--text-dim)">AI is analyzing context and redacting...</span>');
    try {
      const t0 = performance.now();
      const r = await fetch('/api/ai/redact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: wrapInput }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const ms = Math.max(1, Math.round(performance.now() - t0));
      setWrapOutput(j.output);
      const safe = esc(j.output);
      const highlighted = safe.replace(/\[REDACTED\]/g, '<mark>[REDACTED]</mark>');
      setWrapOutputHtml(highlighted || '<span style="color:var(--text-dim)">(empty)</span>');
      setWrapOutStat(`${j.output_chars} chars`);
      if (j.redactions > 0) {
        setWrapSummary(`AI: ${j.redactions} secret${j.redactions === 1 ? '' : 's'} redacted — ${ms} ms`);
      } else {
        setWrapSummary(`AI: Clean — no secrets detected — ${ms} ms`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      setWrapOutputHtml(`<span style="color:#ff7676">AI redaction failed — ${esc(msg)}</span>`);
      setWrapSummary('AI redaction failed');
    } finally { setAiRedactLoading(false); }
  }

  /* ── Scroll reveal ── */
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [currentScan]); // re-observe when findings appear

  /* ── Stats counter observer ── */
  useEffect(() => {
    if (!statsRef.current) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setStatsVisible(true); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(statsRef.current);
    return () => io.disconnect();
  }, []);

  /* ── Background canvas ── */
  useEffect(() => {
    // ── Shared glow sprite maker ──
    function makeGlowSprite(size: number, core: string, glow: string): HTMLCanvasElement {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d')!;
      const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grd.addColorStop(0, core);
      grd.addColorStop(0.35, glow);
      grd.addColorStop(1, 'rgba(77,139,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, size, size);
      return c;
    }

    // ── Background particles ──
    const bgCanvas = document.getElementById('bg-canvas') as HTMLCanvasElement;
    if (bgCanvas) {
      const ctx = bgCanvas.getContext('2d', { alpha: true })!;
      let w: number, h: number, dpr: number;
      let parts: { x: number; y: number; s: number; vy: number; a: number; tw: number }[] = [];
      let sprite: HTMLCanvasElement, spriteSize: number;

      function resizeBg() {
        dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        w = bgCanvas.width = window.innerWidth * dpr;
        h = bgCanvas.height = window.innerHeight * dpr;
        bgCanvas.style.width = window.innerWidth + 'px';
        bgCanvas.style.height = window.innerHeight + 'px';
        spriteSize = Math.round(14 * dpr);
        sprite = makeGlowSprite(spriteSize, 'rgba(220,235,255,0.95)', 'rgba(77,139,255,0.35)');
        const count = Math.floor((window.innerWidth * window.innerHeight) / 42000);
        parts = new Array(count).fill(0).map(() => ({
          x: Math.random() * w,
          y: Math.random() * h,
          s: Math.random() * 0.8 + 0.5,
          vy: (Math.random() * 0.10 + 0.02) * dpr,
          a: Math.random() * 0.35 + 0.2,
          tw: Math.random() * Math.PI * 2,
        }));
      }
      resizeBg();
      let resizeT: ReturnType<typeof setTimeout>;
      const handleResize = () => { clearTimeout(resizeT); resizeT = setTimeout(resizeBg, 150); };
      window.addEventListener('resize', handleResize);

      let bgRunning = true;
      let bgVisible = true;
      const FRAME = 1000 / 30;
      let lastBg = 0;

      const bgIo = new IntersectionObserver(([e]) => { bgVisible = e.isIntersecting; }, { threshold: 0 });
      bgIo.observe(bgCanvas);

      const visHandler = () => { bgRunning = !document.hidden; };
      document.addEventListener('visibilitychange', visHandler);

      function loopBg(now: number) {
        if (bgVisible && bgRunning && now - lastBg >= FRAME) {
          ctx.clearRect(0, 0, w, h);
          for (const p of parts) {
            p.y -= p.vy;
            p.tw += 0.025;
            if (p.y < -spriteSize) { p.y = h + spriteSize; p.x = Math.random() * w; }
            const a = p.a * (0.6 + 0.4 * Math.sin(p.tw));
            const sz = spriteSize * p.s;
            ctx.globalAlpha = a;
            ctx.drawImage(sprite, p.x - sz / 2, p.y - sz / 2, sz, sz);
          }
          ctx.globalAlpha = 1;
          lastBg = now;
        }
        requestAnimationFrame(loopBg);
      }
      requestAnimationFrame(loopBg);

      // Cleanup
      return () => {
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('visibilitychange', visHandler);
        bgIo.disconnect();
      };
    }
  }, []);

  /* ── Constellation canvas ── */
  useEffect(() => {
    function makeGlowSprite(size: number, core: string, glow: string): HTMLCanvasElement {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d')!;
      const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grd.addColorStop(0, core);
      grd.addColorStop(0.35, glow);
      grd.addColorStop(1, 'rgba(77,139,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, size, size);
      return c;
    }

    const cv = document.getElementById('constellation') as HTMLCanvasElement;
    if (!cv) return;
    const ctx = cv.getContext('2d', { alpha: true })!;

    let w: number, h: number, dpr: number;
    let nodes: { x: number; y: number; vx: number; vy: number }[] = [];
    const mouse = { x: -9999, y: -9999 };
    let sprite: HTMLCanvasElement, spriteSize: number;

    function resize() {
      const rect = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = cv.width = rect.width * dpr;
      h = cv.height = rect.height * dpr;
      spriteSize = Math.round(12 * dpr);
      sprite = makeGlowSprite(spriteSize, 'rgba(210,225,255,0.95)', 'rgba(77,139,255,0.5)');
      const count = Math.max(20, Math.min(40, Math.floor(rect.width / 42)));
      nodes = new Array(count).fill(0).map(() => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18 * dpr,
        vy: (Math.random() - 0.5) * 0.18 * dpr,
      }));
    }
    resize();
    let resizeT: ReturnType<typeof setTimeout>;
    const handleResize = () => { clearTimeout(resizeT); resizeT = setTimeout(resize, 150); };
    window.addEventListener('resize', handleResize);

    const handleMove = (e: MouseEvent) => {
      const rect = cv.getBoundingClientRect();
      mouse.x = (e.clientX - rect.left) * dpr;
      mouse.y = (e.clientY - rect.top) * dpr;
    };
    const handleLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    cv.addEventListener('mousemove', handleMove);
    cv.addEventListener('mouseleave', handleLeave);

    const LINK = 130;
    const FRAME = 1000 / 30;
    let last = 0;
    let running = true;

    const visH = () => { running = !document.hidden; };
    document.addEventListener('visibilitychange', visH);

    function loop(now: number) {
      if (running && now - last >= FRAME) {
        ctx.clearRect(0, 0, w, h);
        const linkPx = LINK * dpr;
        const linkSq = linkPx * linkPx;

        for (const n of nodes) {
          n.x += n.vx; n.y += n.vy;
          const dx = mouse.x - n.x, dy = mouse.y - n.y;
          const mdSq = dx * dx + dy * dy;
          const range = 200 * dpr;
          if (mdSq < range * range && mdSq > 1) {
            const md = Math.sqrt(mdSq);
            n.vx += (dx / md) * 0.014;
            n.vy += (dy / md) * 0.014;
          }
          n.vx *= 0.985; n.vy *= 0.985;
          if (n.x < 0) n.x = w; if (n.x > w) n.x = 0;
          if (n.y < 0) n.y = h; if (n.y > h) n.y = 0;
        }

        ctx.lineWidth = 1 * dpr;
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const dSq = dx * dx + dy * dy;
            if (dSq < linkSq) {
              const alpha = (1 - Math.sqrt(dSq) / linkPx) * 0.35;
              ctx.strokeStyle = `rgba(77,139,255,${alpha})`;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }

        for (const n of nodes) {
          ctx.drawImage(sprite, n.x - spriteSize / 2, n.y - spriteSize / 2, spriteSize, spriteSize);
        }
        last = now;
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', handleResize);
      cv.removeEventListener('mousemove', handleMove);
      cv.removeEventListener('mouseleave', handleLeave);
      document.removeEventListener('visibilitychange', visH);
    };
  }, []);

  /* ── Smooth anchor scroll ── */
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && wrapOpen) { setWrapOpen(false); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); urlRef.current?.focus(); scrollTo('scan'); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'W') { e.preventDefault(); setWrapOpen(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        if (currentScan) exportAudit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [wrapOpen, currentScan]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Gauge helpers ── */
  function colorClassFor(score: number) {
    if (score < 40) return { stroke: '', state: 'is-safe', label: 'Safe' };
    if (score < 70) return { stroke: 'is-warn', state: 'is-warn', label: 'Warning' };
    return { stroke: 'is-danger', state: 'is-danger', label: 'High' };
  }

  function resetGauge() {
    setGaugeScore(0);
    setGaugeDashoffset(100);
    setGaugeFillClass('');
    setDisplayScore('—');
    setGaugeLabel('awaiting scan');
    setGaugeState('');
    setGaugeStateLabel('Idle');
    setCntHigh('—');
    setCntWarn('—');
    setCntInfo('—');
  }

  function runGauge(score: number, counts: { high: number; warn: number; info: number }) {
    const c = colorClassFor(score);
    setGaugeFillClass(c.stroke);
    setGaugeState(c.state);
    setGaugeStateLabel(c.label);
    setGaugeLabel('/ 100 risk');
    setGaugeDashoffset(100 - score);
    setCntHigh(String(counts.high));
    setCntWarn(String(counts.warn));
    setCntInfo(String(counts.info));

    // Animate number
    const start = performance.now();
    const dur = 1300;
    function tick(t: number) {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplayScore(String(Math.round(score * eased)));
      if (k < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ── Scanning state ── */
  function setIsScanning(on: boolean) {
    setScanning(on);
    if (on) {
      scanT0Ref.current = performance.now();
      scanTimerRef.current = setInterval(() => {
        setScanTimer(((performance.now() - scanT0Ref.current) / 1000).toFixed(1));
      }, 100);
    } else {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }

  /* ── Scan file handler ── */
  async function handleFile(file: File) {
    setDropTitle(file.name);
    const kb = file.size < 1024 * 1024
      ? Math.max(1, Math.round(file.size / 1024)) + ' KB'
      : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
    setDropSub(kb + ' · ready to scan');

    flash('Uploading ' + file.name + '...', 'info');
    resetGauge();
    setCurrentScan(null);
    setShowAllFindings(false);
    setIsScanning(true);

    // Store raw source for AI deep scan
    rawCodeRef.current = await file.text();

    const fd = new FormData();
    fd.append('file', file);

    try {
      const r = await fetch('/api/scan/file', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(await r.text() || ('HTTP ' + r.status));
      const payload: ScanPayload = await r.json();
      setIsScanning(false);
      applyScanPayload(payload);
    } catch (e: unknown) {
      setIsScanning(false);
      scanFailed(e);
    }
  }

  /* ── Scan URL handler ── */
  async function handleScanUrl() {
    const u = url.trim();
    if (!u) {
      flash('Paste a GitHub URL or drop a file', 'warning');
      urlRef.current?.focus();
      return;
    }
    flash('Scanning ' + u + '...', 'info');
    resetGauge();
    setCurrentScan(null);
    setShowAllFindings(false);
    rawCodeRef.current = ''; // URL scans are multi-file; AI scan will use snippet context
    setIsScanning(true);

    try {
      const r = await fetch('/api/scan/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      });
      if (!r.ok) {
        let errStr = await r.text();
        try {
          const errObj = JSON.parse(errStr);
          if (errObj.error) errStr = errObj.error;
        } catch { /* ignore */ }
        throw new Error(errStr || ('HTTP ' + r.status));
      }
      const payload: ScanPayload = await r.json();
      setIsScanning(false);
      applyScanPayload(payload);
    } catch (e: unknown) {
      setIsScanning(false);
      scanFailed(e);
    }
  }

  function scanFailed(e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[aegisshield] scan failed:', e);
    flash('Scan failed · ' + msg, 'error');
    resetGauge();
    setDropSub('.zip archive or single source file — up to 25\u00a0MB');
  }

  function applyScanPayload(p: ScanPayload) {
    setCurrentScan(p);
    setShowAllFindings(false);
    setAiDeepFindings([]); setAiDeepDone(false); setAiSummary('');
    const counts = p.counts || { critical: 0, high: 0, warning: 0, info: 0 };
    const totalHigh = (counts.high || 0) + (counts.critical || 0);
    runGauge(p.risk_score || 0, { high: totalHigh, warn: counts.warning || 0, info: counts.info || 0 });
    flash(`Scan complete · ${p.severity} · ${p.risk_score}/100`, p.risk_score >= 70 ? 'error' : p.risk_score >= 40 ? 'warning' : 'success');

    // Save to history
    saveHistory({
      scan_id: p.scan_id,
      timestamp: Date.now(),
      label: p.label,
      risk_score: p.risk_score,
      finding_count: p.findings.length,
      severity: p.severity,
    });

    // Increment localStorage stats
    try {
      const scans = parseInt(localStorage.getItem('aegisshield_scans') || '0') + 1;
      const secrets = parseInt(localStorage.getItem('aegisshield_secrets') || '0') + p.findings.filter(f => f.severity === 'critical' || f.severity === 'high').length;
      localStorage.setItem('aegisshield_scans', String(scans));
      localStorage.setItem('aegisshield_secrets', String(secrets));
    } catch { /* */ }

    setTimeout(() => {
      document.getElementById('findings-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  }

  function exportAudit() {
    if (!currentScan) return;
    const report = {
      engine: 'AegisShield v1.0',
      timestamp: new Date().toISOString(),
      scan_id: currentScan.scan_id,
      source: currentScan.label,
      risk_score: currentScan.risk_score,
      severity: currentScan.severity,
      duration_ms: currentScan.duration_ms,
      files_scanned: currentScan.files_scanned,
      counts: currentScan.counts,
      findings: currentScan.findings.map(f => ({
        id: f.id,
        category: f.category,
        severity: f.severity,
        source: f.source,
        file: f.file,
        line: f.line,
        snippet: f.snippet,
        message: f.message,
        suggested_fix: f.suggested_fix,
        weight: f.weight,
      })),
    };
    const jsonStr = JSON.stringify(report, null, 2);
    // Add UTF-8 BOM for universal compatibility
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const encoder = new TextEncoder();
    const content = encoder.encode(jsonStr);
    const blob = new Blob([bom, content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aegisshield-audit-${currentScan.label.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    flash('Audit report exported', 'success');
  }

  /* ── Wrapper ── */
  async function runWrapper() {
    if (!wrapInput.trim()) {
      setWrapSummary('Paste something to redact first');
      return;
    }
    setWrapSummary('Running wrapper…');
    setWrapOutputHtml('<span style="color:var(--text-dim)">Redacting…</span>');
    try {
      const t0 = performance.now();
      const r = await fetch('/api/wrapper/redact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: wrapInput }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const ms = Math.max(1, Math.round(performance.now() - t0));
      setWrapOutput(j.output);
      const safe = esc(j.output);
      const highlighted = safe.replace(/\[REDACTED\]/g, '<mark>[REDACTED]</mark>');
      setWrapOutputHtml(highlighted || '<span style="color:var(--text-dim)">(empty)</span>');
      setWrapOutStat(`${j.output_chars} chars`);
      if (j.redactions > 0) {
        setWrapSummary(`${j.redactions} secret${j.redactions === 1 ? '' : 's'} redacted · round-trip ${ms} ms`);
      } else {
        setWrapSummary(`Clean — no patterns matched · round-trip ${ms} ms`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      setWrapOutputHtml(`<span style="color:#ff7676">Wrapper call failed · ${esc(msg)}</span>`);
      setWrapSummary('Wrapper offline?');
    }
  }

  function loadScanSample() {
    if (!currentScan) {
      setWrapSummary('No active scan to pull from');
      return;
    }

    // Try client-side raw code first (works on Vercel where server memory is ephemeral)
    if (rawCodeRef.current) {
      const lines = rawCodeRef.current.split('\n');
      const findingLines = currentScan.findings.map(f => f.line).filter(Boolean);
      let text: string;
      if (findingLines.length > 0) {
        const start = Math.max(0, Math.min(...findingLines) - 3);
        const end = Math.min(lines.length, Math.max(...findingLines) + 3);
        text = lines.slice(start, end).join('\n');
      } else {
        text = lines.slice(0, 20).join('\n');
      }
      setWrapInput(text);
      setWrapInStat(`${text.length} chars`);
      setWrapSummary('Loaded from your scan');
      return;
    }

    // Fallback: build from findings snippets
    if (currentScan.findings.length > 0) {
      const text = currentScan.findings
        .slice(0, 5)
        .map(f => `# ${f.file}:${f.line}\n${f.snippet}`)
        .join('\n\n');
      setWrapInput(text);
      setWrapInStat(`${text.length} chars`);
      setWrapSummary('Loaded from scan findings');
      return;
    }

    setWrapSummary('Scan has no usable snippets');
  }

  /* ── Contact form submit ── */
  function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contactName.trim() || !contactEmail.trim() || !contactMessage.trim()) {
      flash('Please fill in all required fields', 'warning');
      return;
    }
    // Build mailto link to send to your email
    const subject = encodeURIComponent(`AegisShield Contact: ${contactName}${contactCompany ? ' (' + contactCompany + ')' : ''}`);
    const body = encodeURIComponent(
      `Name: ${contactName}\n` +
      `Email: ${contactEmail}\n` +
      `Company: ${contactCompany || 'N/A'}\n\n` +
      `Message:\n${contactMessage}`
    );
    window.open(`mailto:amit.sanjay.waghmare@gmail.com?subject=${subject}&body=${body}`, '_self');
    // Also store locally for reference
    try {
      const submissions = JSON.parse(localStorage.getItem('aegisshield_contacts') || '[]');
      submissions.push({
        name: contactName, email: contactEmail, company: contactCompany, message: contactMessage,
        timestamp: new Date().toISOString(),
      });
      localStorage.setItem('aegisshield_contacts', JSON.stringify(submissions));
    } catch { /* */ }
    setContactName(''); setContactEmail(''); setContactCompany(''); setContactMessage('');
    flash('Opening email client...', 'success');
  }

  /* ── Drag & drop handlers ── */
  const [isDrag, setIsDrag] = useState(false);
  const dragDepth = useRef(0);

  /* ── Animated stat counter ── */
  function AnimatedCounter({ end, suffix = '', duration = 1500 }: { end: number; suffix?: string; duration?: number }) {
    const [val, setVal] = useState(0);
    useEffect(() => {
      if (!statsVisible) return;
      const start = performance.now();
      function tick(now: number) {
        const k = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - k, 3);
        setVal(Math.round(end * eased));
        if (k < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }, [statsVisible, end, duration]);
    return <>{val.toLocaleString()}{suffix}</>;
  }

  // Get persisted stats
  const persistedScans = typeof window !== 'undefined' ? parseInt(localStorage.getItem('aegisshield_scans') || '0') : 0;
  const persistedSecrets = typeof window !== 'undefined' ? parseInt(localStorage.getItem('aegisshield_secrets') || '0') : 0;

  /* ── Render findings ── */
  const allFindings = currentScan?.findings || [];
  const rankedFindings = [...allFindings].sort((a, b) => (RANK[b.severity] || 0) - (RANK[a.severity] || 0));
  const visibleFindings = showAllFindings ? rankedFindings : rankedFindings.slice(0, 6);

  /* ── History sparkline ── */
  function Sparkline({ data }: { data: number[] }) {
    if (data.length < 2) return null;
    const max = Math.max(...data, 1);
    const w = 80, h = 24;
    const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(' ');
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" style={{ flexShrink: 0 }}>
        <polyline points={points} stroke="var(--neon)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }

  /* ═══════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════ */
  return (
    <>
      {/* Background layers */}
      <div className="top-wash" />
      <canvas id="bg-canvas" />

      {/* ═══════ HEADER ═══════ */}
      <header className="relative z-10">
        <div className="container-x flex items-center justify-between py-6">
          <a href="#" className="flex items-center gap-3" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <svg className="logo-mark" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 4 L33 8 V19 C33 26.5 27.5 32.5 20 35 C12.5 32.5 7 26.5 7 19 V8 Z" />
              <path d="M14 19.5 L18.5 24 L27 15.5" />
            </svg>
            <span className="text-[15px] tracking-[0.2em] font-medium text-white">AEGISSHIELD</span>
          </a>

          <nav className="hidden md:flex items-center gap-9">
            <span className="nav-link" onClick={() => scrollTo('scan')}>Scan</span>
            <span className="nav-link" onClick={() => scrollTo('features')}>Platform</span>
            <span className="nav-link" onClick={() => scrollTo('demo')}>Live Demo</span>
          </nav>

          <button className="btn" onClick={() => scrollTo('contact')}>
            <span className="dot" />
            Contact
          </button>
        </div>
        <div className="hairline" />
      </header>

      {/* ═══════ HERO ═══════ */}
      <section className="relative z-10 pt-28 md:pt-36 pb-24">
        <div className="container-x">
          <div className="flex flex-col items-center text-center">
            <span className="eyebrow reveal">— Runtime AI Supply-Chain Security</span>
            <h1 className="h1 mt-7 reveal" data-d="1">Securing<br />Agentic AI.</h1>
            <p className="lede mt-7 max-w-[520px] reveal" data-d="2">Real-time risk scores and redaction for digital insiders.</p>

            <div className="mt-10 flex items-center gap-3 reveal" data-d="3">
              <button className="btn btn-primary" onClick={() => scrollTo('scan')}>
                Run a Scan
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
              </button>
              <button className="btn" onClick={() => scrollTo('features')}>
                <span className="dot" />
                How it works
              </button>
            </div>

            <div className="relative w-full mt-20 reveal" data-d="4">
              <canvas id="constellation" className="block w-full" style={{ height: '280px' }} />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ STATS COUNTER ═══════ */}
      <section className="relative z-10 pb-16">
        <div className="container-x">
          <div className="stat-grid reveal" ref={statsRef}>
            <div className="stat-cell">
              <div className="stat-num"><AnimatedCounter end={2847 + persistedScans} suffix="+" /></div>
              <div className="stat-label">Scans Completed</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num"><AnimatedCounter end={12400 + persistedSecrets} suffix="+" /></div>
              <div className="stat-label">Secrets Intercepted</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num"><AnimatedCounter end={99} suffix=".7%" duration={2000} /></div>
              <div className="stat-label">Redaction Accuracy</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">&lt;<AnimatedCounter end={38} suffix="ms" /></div>
              <div className="stat-label">Avg Response Time</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ SCAN SECTION ═══════ */}
      <section id="scan" className="relative z-10 pb-32">
        <div className="container-x">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10 reveal">
            <div>
              <span className="eyebrow">— Skill Checkup</span>
              <h2 className="h2 mt-3">Drop a skill. Get a verdict.</h2>
            </div>
            <p className="lede max-w-sm">Static and AST passes return a single risk score in seconds. No install required.</p>
          </div>

          <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
            {/* Input panel */}
            <div className="card reveal" data-d="1">
              <div className="card-pad">
                <div className="flex items-center justify-between mb-6">
                  <span className="num-tag">[ INPUT ]</span>
                  <span className="text-[12px] text-[color:var(--text-dim)] font-mono tracking-widest">SCAN&nbsp;#2087</span>
                </div>

                <input ref={fileRef} type="file" className="hidden" accept=".zip,.py,.js,.ts,.json,.yaml,.yml,.md,.txt,.jsx,.tsx,.env,.cfg,.ini,.toml,.sh"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

                <div
                  className={`drop${isDrag ? ' is-drag' : ''}${scanning ? ' is-busy' : ''}`}
                  role="button" tabIndex={0}
                  onClick={() => !scanning && fileRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
                  onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setIsDrag(true); }}
                  onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
                  onDragLeave={(e) => { e.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setIsDrag(false); }}
                  onDrop={(e) => {
                    e.preventDefault(); dragDepth.current = 0; setIsDrag(false);
                    const f = e.dataTransfer?.files?.[0];
                    if (f) handleFile(f);
                  }}
                >
                  <svg className="ico" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 30 v6 a4 4 0 0 0 4 4 h12 a4 4 0 0 0 4 -4 v-6" />
                    <path d="M24 8 v22" />
                    <path d="M16 16 l8 -8 l8 8" />
                  </svg>
                  <div className="text-[17px] text-white font-medium">{dropTitle}</div>
                  <div className="mt-2 text-[13px]" style={{ color: 'var(--text-mute)' }}>{dropSub}</div>
                </div>

                <div className="text-center">
                  <div className="url-or">— or paste a public repository —</div>
                  <div className={`url-pill${scanning ? ' is-busy' : ''}`}>
                    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M10 14a5 5 0 0 1 0-7l3-3a5 5 0 0 1 7 7l-1.5 1.5" />
                      <path d="M14 10a5 5 0 0 1 0 7l-3 3a5 5 0 0 1-7-7l1.5-1.5" />
                    </svg>
                    <input
                      ref={urlRef} type="text" value={url} onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://github.com/owner/repo"
                      disabled={scanning}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleScanUrl(); } }}
                    />
                    <button type="button" className="btn btn-primary" disabled={scanning} onClick={handleScanUrl}>
                      {scanning ? 'Scanning…' : 'Scan'}
                    </button>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-2 text-[12px] font-mono" style={{ color: 'var(--text-dim)' }}>
                  <span className="badge"><span className="pip" />SAFE FOR PROD</span>
                  <span className="badge">PII REDACTION</span>
                  <span className="badge">NO TELEMETRY</span>
                </div>
              </div>
            </div>

            {/* Risk score panel */}
            <div className="card reveal" data-d="2">
              <div className="card-pad">
                <div className="flex items-center justify-between mb-6">
                  <span className="num-tag">[ RISK SCORE ]</span>
                  <span className={`gauge-state${gaugeState ? ' ' + gaugeState : ''}${scanning ? ' is-scanning' : ''}`}>
                    <span className="pip" />
                    <span>{scanning ? `Scanning · ${scanTimer}s` : gaugeStateLabel}</span>
                  </span>
                </div>

                <div className={`gauge-wrap${scanning ? ' is-scanning' : ''}`}>
                  <svg viewBox="0 0 200 200">
                    <circle cx="100" cy="100" r="86" strokeWidth="10" fill="none" className="gauge-track" />
                    <circle cx="100" cy="100" r="86" strokeWidth="10" fill="none"
                      className={`gauge-fill${gaugeFillClass ? ' ' + gaugeFillClass : ''}`}
                      pathLength={100}
                      strokeDasharray="100 100"
                      strokeDashoffset={scanning ? undefined : gaugeDashoffset}
                    />
                  </svg>
                  <div className="gauge-center">
                    <div className="num" style={scanning ? { color: 'var(--neon)', letterSpacing: '0.2em', fontSize: '38px' } : {}}>
                      {scanning ? '···' : displayScore}
                    </div>
                    <div className="lbl">{scanning ? 'in progress' : gaugeLabel}</div>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-3 text-center">
                  <div className="border-r border-white/[0.05] py-2">
                    <div className="font-mono text-[16px] text-white">{cntHigh}</div>
                    <div className="text-[10.5px] tracking-[0.2em] uppercase mt-1" style={{ color: 'var(--text-dim)' }}>High</div>
                  </div>
                  <div className="border-r border-white/[0.05] py-2">
                    <div className="font-mono text-[16px] text-white">{cntWarn}</div>
                    <div className="text-[10.5px] tracking-[0.2em] uppercase mt-1" style={{ color: 'var(--text-dim)' }}>Warn</div>
                  </div>
                  <div className="py-2">
                    <div className="font-mono text-[16px] text-white">{cntInfo}</div>
                    <div className="text-[10.5px] tracking-[0.2em] uppercase mt-1" style={{ color: 'var(--text-dim)' }}>Info</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ═══════ FINDINGS ═══════ */}
          {currentScan && (
            <div id="findings-section" className="mt-12">
              <div className="action-bar">
                <div className="meta">
                  <span className="num-tag">[ FINDINGS ]</span>
                  <span><b>{allFindings.length}</b>&nbsp;detected</span>
                  <span className="sep">·</span>
                  <span><b>{currentScan.label}</b></span>
                  <span className="sep">·</span>
                  <span>scan&nbsp;in&nbsp;<b>{(currentScan.duration_ms / 1000).toFixed(1)}s</b></span>
                  <span className="sep">·</span>
                  <span><b>{currentScan.files_scanned}</b>&nbsp;files</span>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn" onClick={() => { setWrapOpen(true); loadScanSample(); }}>
                    <span className="dot" />Apply Wrapper
                  </button>
                  <button className="btn" onClick={exportAudit}>
                    Export Audit
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>
                  </button>
                  <button className="btn ai-btn" onClick={runAiDeepScan} disabled={aiDeepLoading}>
                    {aiDeepLoading ? 'AI Scanning...' : 'AI Deep Scan'}
                  </button>
                  <button className="btn ai-btn" onClick={generateAiSummary} disabled={aiSummaryLoading}>
                    {aiSummaryLoading ? 'AI Generating...' : 'AI Summary'}
                  </button>
                </div>
              </div>

              <div className="grid gap-4">
                {allFindings.length === 0 ? (
                  <article className="finding">
                    <div className="body">
                      <div className="lbl">All clear</div>
                      <p className="why">No findings. The scanner ran <b>{currentScan.files_scanned}</b> file(s) through the static and AST passes and found nothing actionable.</p>
                    </div>
                  </article>
                ) : (
                  visibleFindings.map((f, i) => (
                    <article key={`${f.id}-${f.file}-${f.line}-${i}`} className="finding reveal">
                      <header>
                        <span className={`pill ${SEV_PILL[f.severity] || 'sev-info'}`}>{SEV_LABEL[f.severity] || f.severity}</span>
                        <span className="pill src">{SRC_LABEL[f.source] || f.source}</span>
                        <span className="file">{f.file}<span className="ln">:{f.line}</span></span>
                        <span className="rule">{f.id}</span>
                        <CopyBtn text={f.snippet} label="Copy" />
                      </header>
                      <div className="body">
                        {f.snippet && (
                          <div>
                            <div className="lbl">Evidence</div>
                            <pre className="code compact">
                              <span className="dim">{String(f.line).padStart(3, ' ')} │</span>{' '}
                              <span className="hl">{f.snippet}</span>
                            </pre>
                          </div>
                        )}
                        <div>
                          <div className="lbl">Why this lowers your score</div>
                          <p className="why">{f.message}{f.weight ? <span className="neon"> Severity weight: +{f.weight}</span> : null}</p>
                        </div>
                        {f.suggested_fix && (
                          <div className="mt-4">
                            <div className="flex items-center justify-between mb-2">
                              <div className="lbl m-0">Suggested fix</div>
                              <button 
                                onClick={() => generateAiFix(f)} 
                                disabled={aiLoading[f.id]}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--neon)] text-[#020608] text-[11px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                              >
                                {aiLoading[f.id] ? 'Generating...' : 'Auto-Fix with AI'}
                              </button>
                            </div>
                            <pre className="code compact">{f.suggested_fix}</pre>
                          </div>
                        )}
                        {aiFixes[f.id] && (
                          <div className="mt-4 p-4 rounded bg-[#0a1215] border border-[var(--neon)]/30">
                            <div className="flex items-center justify-between mb-2">
                              <div className="lbl m-0 flex items-center gap-2">
                                <span className="text-[var(--neon)]">AI Generated Fix</span>
                              </div>
                              <CopyBtn text={aiFixes[f.id]} label="Copy Fix" />
                            </div>
                            <pre className="code compact" style={{ background: '#020608' }}>
                              <span className="hl">{aiFixes[f.id]}</span>
                            </pre>
                          </div>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>

              {allFindings.length > 0 && (
                <div className="mt-6 flex items-center justify-between flex-wrap gap-3 text-[12.5px] font-mono" style={{ color: 'var(--text-dim)' }}>
                  <span>
                    Showing <b style={{ color: 'var(--text)' }}>{visibleFindings.length}</b> of <b style={{ color: 'var(--text)' }}>{allFindings.length}</b>
                    &nbsp;—&nbsp;
                    <span style={{ color: 'var(--text-mute)' }}>
                      {currentScan.counts.critical} Critical · {currentScan.counts.high} High · {currentScan.counts.warning} Warning · {currentScan.counts.info} Info
                    </span>
                  </span>
                  {visibleFindings.length < allFindings.length && (
                    <span className="nav-link" onClick={() => setShowAllFindings(true)}>
                      Show all {allFindings.length} findings →
                    </span>
                  )}
                </div>
              )}

              {/* ── AI Deep Scan Results ── */}
              {aiDeepLoading && (
                <div className="mt-8 p-6 rounded-xl border border-[color:var(--neon)]/20 text-center ai-loading-card">
                  <div className="text-[color:var(--neon)] text-lg ai-pulse">AI Deep Scan in progress...</div>
                  <div className="text-[12px] mt-2" style={{ color: 'var(--text-dim)' }}>Analyzing code semantics with Gemini</div>
                </div>
              )}

              {aiDeepDone && aiDeepFindings.length > 0 && (
                <div className="mt-10">
                  <div className="flex items-center gap-3 mb-5">
                    <span className="num-tag ai-tag">[ AI DEEP SCAN ]</span>
                    <span className="text-[12.5px] font-mono" style={{ color: 'var(--text-dim)' }}>
                      {aiDeepFindings.length} semantic vulnerabilities detected
                    </span>
                  </div>
                  <div className="grid gap-4">
                    {aiDeepFindings.map((f, i) => (
                      <article key={`ai-${f.id}-${f.line}-${i}`} className="finding ai-finding">
                        <header>
                          <span className={`pill ${SEV_PILL[f.severity] || 'sev-info'}`}>{SEV_LABEL[f.severity] || f.severity}</span>
                          <span className="pill src ai-src">AI</span>
                          <span className="file">{f.file}<span className="ln">:{f.line}</span></span>
                          <span className="rule">{f.id}</span>
                          <CopyBtn text={f.snippet} label="Copy" />
                        </header>
                        <div className="body">
                          {f.snippet && (
                            <div>
                              <div className="lbl">Evidence</div>
                              <pre className="code compact"><span className="hl">{f.snippet}</span></pre>
                            </div>
                          )}
                          <div>
                            <div className="lbl">AI Analysis</div>
                            <p className="why">{f.message}{f.weight ? <span className="neon"> Severity weight: +{f.weight}</span> : null}</p>
                          </div>
                          {f.suggested_fix && (
                            <div className="mt-3">
                              <div className="lbl">AI Suggested Fix</div>
                              <pre className="code compact">{f.suggested_fix}</pre>
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {aiDeepDone && aiDeepFindings.length === 0 && (
                <div className="mt-8 p-6 rounded-xl border border-[color:var(--neon)]/20 text-center">
                  <div className="text-[color:var(--neon)] text-lg mb-2">AI Deep Scan Complete</div>
                  <div className="text-[13px]" style={{ color: 'var(--text-mute)' }}>No additional semantic vulnerabilities detected beyond the static analysis.</div>
                </div>
              )}

              {/* ── AI Threat Summary ── */}
              {aiSummaryLoading && (
                <div className="mt-8 p-6 rounded-xl border border-[color:var(--neon)]/20 text-center ai-loading-card">
                  <div className="text-[color:var(--neon)] text-lg ai-pulse">Generating Threat Summary...</div>
                </div>
              )}

              {aiSummary && (
                <div className="mt-8 card ai-summary-card">
                  <div className="card-pad">
                    <div className="flex items-center justify-between mb-5">
                      <span className="num-tag ai-tag">[ AI THREAT SUMMARY ]</span>
                      <CopyBtn text={aiSummary} label="Copy Summary" />
                    </div>
                    <div className="ai-summary-text">
                      {aiSummary.split('\n').map((line, i) => (
                        line.trim() ? <p key={i} className="mb-3 text-[13.5px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>{line}</p> : <br key={i} />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── History Panel ── */}
              {history.length > 0 && (
                <div className="mt-10">
                  <button className="btn" onClick={() => setShowHistory(p => !p)} style={{ marginBottom: '12px' }}>
                    <span className="dot" />{showHistory ? 'Hide' : 'Show'} Scan History ({history.length})
                  </button>
                  {showHistory && (
                    <div className="grid gap-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="num-tag">[ HISTORY ]</span>
                        <Sparkline data={history.slice(0, 20).reverse().map(h => h.risk_score)} />
                      </div>
                      {history.slice(0, 20).map((h) => (
                        <div key={h.scan_id} className="history-item">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-white truncate">{h.label}</div>
                            <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--text-dim)' }}>
                              {new Date(h.timestamp).toLocaleString()} · {h.finding_count} findings
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className={`font-mono text-lg font-medium ${h.risk_score >= 70 ? 'text-[color:var(--danger)]' : h.risk_score >= 40 ? 'text-[color:var(--warn)]' : 'text-[color:var(--cyan)]'}`}>
                              {h.risk_score}
                            </div>
                            <div className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>{h.severity}</div>
                          </div>
                        </div>
                      ))}
                      <button className="btn" style={{ marginTop: '8px' }} onClick={() => {
                        setHistory([]);
                        try { localStorage.removeItem('aegisshield_history'); } catch { /* */ }
                        flash('History cleared', 'info');
                      }}>Clear history</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ═══════ FEATURES ═══════ */}
      <section id="features" className="relative z-10 pb-32">
        <div className="container-x">
          <div className="max-w-2xl mb-14 reveal">
            <span className="eyebrow">— Platform</span>
            <h2 className="h2 mt-3">Three layers between a skill and your model context.</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            <article className="card reveal" data-d="1">
              <div className="card-pad">
                <div className="flex items-center justify-between mb-8">
                  <span className="num-tag">01</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--neon)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                </div>
                <h3 className="text-white text-[19px] font-medium tracking-tight">Pre-Install Auditor</h3>
                <p className="mt-3 text-[14px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>
                  Static regex and Python AST passes detect debug prints leaking env vars, hard-coded
                  credentials, wallet keys, and unsafe network or subprocess calls.
                </p>
                <ul className="mt-7 space-y-2.5 text-[13px]" style={{ color: 'var(--text-mute)' }}>
                  <li className="flex gap-3"><span style={{ color: 'var(--neon)' }}>›</span> Risk score 0 – 100, severity-tiered findings</li>
                  <li className="flex gap-3"><span style={{ color: 'var(--neon)' }}>›</span> Stub auto-patch with <span className="font-mono">aegisshield: ignore</span></li>
                  <li className="flex gap-3"><span style={{ color: 'var(--neon)' }}>›</span> JSON export for audit trails</li>
                </ul>
              </div>
            </article>

            <article className="card reveal" data-d="2">
              <div className="card-pad">
                <div className="flex items-center justify-between mb-8">
                  <span className="num-tag">02</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--neon)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                </div>
                <h3 className="text-white text-[19px] font-medium tracking-tight">Real-Time Wrapper &amp; Redaction</h3>
                <p className="mt-3 text-[14px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>
                  An API endpoint runs every tool output through the same regex ruleset as the auditor.
                  Matched secrets are replaced with <span className="font-mono text-[12.5px]" style={{ color: 'var(--text)' }}>[REDACTED]</span> before they reach your model context.
                </p>
                <ul className="mt-7 space-y-2.5 text-[13px]" style={{ color: 'var(--text-mute)' }}>
                  <li className="flex gap-3"><span style={{ color: 'var(--neon)' }}>›</span> Pattern + entropy + custom regex detectors</li>
                  <li className="flex gap-3"><span style={{ color: 'var(--neon)' }}>›</span> Drop-in for Antigravity, Claude Code, OpenClaw</li>
                  <li className="flex gap-3"><span style={{ color: 'var(--neon)' }}>›</span> Sub-40ms per-call overhead</li>
                </ul>
              </div>
            </article>

            <article className="card reveal" data-d="3">
              <div className="card-pad">
                <div className="flex items-center justify-between mb-8">
                  <span className="num-tag">03</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--neon)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h12" /></svg>
                </div>
                <h3 className="text-white text-[19px] font-medium tracking-tight">Governance &amp; Compliance</h3>
                <p className="mt-3 text-[14px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>
                  Map every finding to a governance-aligned policy. Track skill provenance and
                  enforce org-wide allowlists from a single console.
                </p>
                <ul className="mt-7 space-y-2.5 text-[13px]" style={{ color: 'var(--text-mute)' }}>
                  <li className="flex gap-3"><span style={{ color: 'var(--neon)' }}>›</span> Severity tiers: Safe → Info → Warn → High</li>
                  <li className="flex gap-3"><span style={{ color: 'var(--neon)' }}>›</span> Policy-as-code, signed allowlists</li>
                  <li className="flex gap-3"><span style={{ color: 'var(--neon)' }}>›</span> Audit-ready ledger export</li>
                </ul>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ═══════ TRUST SECTION ═══════ */}
      <section className="relative z-10 pb-32">
        <div className="container-x">
          <div className="max-w-2xl mb-14 reveal">
            <span className="eyebrow">— Trust</span>
            <h2 className="h2 mt-3">Built for enterprise security teams.</h2>
          </div>

          <div className="grid md:grid-cols-4 gap-5">
            <div className="card reveal" data-d="1">
              <div className="card-pad text-center">
                <div className="flex justify-center mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--neon)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/></svg>
                </div>
                <h4 className="text-white text-[15px] font-medium mb-2">Enterprise-Grade Encryption</h4>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>All scans processed server-side with zero client-side data retention.</p>
              </div>
            </div>
            <div className="card reveal" data-d="2">
              <div className="card-pad text-center">
                <div className="flex justify-center mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--neon)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
                </div>
                <h4 className="text-white text-[15px] font-medium mb-2">SOC 2 Compliant Architecture</h4>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>Designed to meet SOC 2 Type II requirements out of the box.</p>
              </div>
            </div>
            <div className="card reveal" data-d="3">
              <div className="card-pad text-center">
                <div className="flex justify-center mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--neon)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </div>
                <h4 className="text-white text-[15px] font-medium mb-2">Zero Data Retention</h4>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>Scanned code is never stored. Results are ephemeral by default.</p>
              </div>
            </div>
            <div className="card reveal" data-d="4">
              <div className="card-pad text-center">
                <div className="flex justify-center mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--neon)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                </div>
                <h4 className="text-white text-[15px] font-medium mb-2">Open Audit Trail</h4>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>Every scan, redaction, and policy action is logged for compliance.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ LIVE DEMO ═══════ */}
      <section id="demo" className="relative z-10 pb-32">
        <div className="container-x">
          <div className="max-w-2xl mb-12 reveal">
            <span className="eyebrow">— Live Demo</span>
            <h2 className="h2 mt-3">A real skill, before and after AegisShield.</h2>
            <p className="lede mt-4">
              The same <span className="font-mono text-[13.5px] text-white">weather_tool</span> skill, run twice.
              The leak on the left is a single <span className="font-mono text-[13.5px] text-white">print()</span> away from
              polluting your model context.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div className="card reveal" data-d="1">
              <div className="card-pad">
                <div className="flex items-center justify-between mb-4">
                  <span className="num-tag" style={{ color: 'var(--danger)' }}>[ BEFORE — LEAKY SKILL ]</span>
                  <span className="gauge-state is-danger"><span className="pip" />Leak</span>
                </div>
                <div className="text-white text-[15px] font-medium mb-3 font-mono">weather_tool / fetch.py</div>
                <pre className="code">
                  <span className="dim"># tool output → captured by agent → model context</span>{'\n'}
                  <span className="neon">def</span> get_weather(city):{'\n'}
                  {'    '}api_key = os.environ[<span className="dim">&quot;OPENWEATHER_API_KEY&quot;</span>]{'\n'}
                  {'    '}<span className="danger">print(f&quot;DEBUG key=&#123;api_key&#125;&quot;)</span>{'\n'}
                  {'    '}<span className="neon">return</span> requests.get(url, params=&#123;{'\n'}
                  {'        '}<span className="dim">&quot;key&quot;</span>: api_key,{'\n'}
                  {'    '}&#125;).json()
                </pre>
                <div className="mt-4 text-[13px]" style={{ color: 'var(--text-mute)' }}>
                  Live API key flows into chat history. Anyone resuming the export can extract it.
                </div>
              </div>
            </div>

            <div className="card reveal" data-d="2">
              <div className="card-pad">
                <div className="flex items-center justify-between mb-4">
                  <span className="num-tag">[ AFTER — PROTECTED ]</span>
                  <span className="gauge-state is-safe"><span className="pip" />Redacted</span>
                </div>
                <div className="text-white text-[15px] font-medium mb-3 font-mono">aegisshield / wrapper</div>
                <pre className="code">
                  <span className="dim"># intercepted at runtime → context stays clean</span>{'\n'}
                  <span className="neon">POST</span> /redact{'\n'}
                  {'\n'}
                  <span className="dim">› in </span> &quot;DEBUG key=sk_live_4tQk29ZxbN8m...&quot;{'\n'}
                  <span className="dim">› out</span> &quot;DEBUG key=<span className="neon">sk_live_***REDACTED***</span>&quot;{'\n'}
                  {'\n'}
                  <span className="dim"># compliance ledger</span>{'\n'}
                  {'{'} &quot;rule&quot;: &quot;OPENAI_KEY&quot;, &quot;severity&quot;: &quot;high&quot;,{'\n'}
                  {'  '}&quot;skill&quot;: &quot;weather_tool&quot;, &quot;action&quot;: &quot;redact&quot; {'}'}
                </pre>
                <div className="mt-4 text-[13px]" style={{ color: 'var(--text-mute)' }}>
                  The secret never enters the model context. An audit entry is written to the ledger.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ CONTACT SECTION ═══════ */}
      <section id="contact" className="relative z-10 pb-32">
        <div className="container-x">
          <div className="max-w-2xl mb-12 reveal">
            <span className="eyebrow">— Get in Touch</span>
            <h2 className="h2 mt-3">Ready to secure your AI pipeline?</h2>
            <p className="lede mt-4">Drop us a message and our security team will get back to you within 24 hours.</p>
          </div>

          <div className="card reveal max-w-2xl">
            <div className="card-pad">
              <form onSubmit={handleContactSubmit} className="grid gap-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <input className="form-input" placeholder="Your name *" value={contactName} onChange={e => setContactName(e.target.value)} />
                  <input className="form-input" type="email" placeholder="Email address *" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
                </div>
                <input className="form-input" placeholder="Company (optional)" value={contactCompany} onChange={e => setContactCompany(e.target.value)} />
                <textarea className="form-input" rows={4} placeholder="Your message *" value={contactMessage} onChange={e => setContactMessage(e.target.value)} style={{ resize: 'vertical' }} />
                <div>
                  <button type="submit" className="btn btn-primary">
                    Send Message
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ FOOTER ═══════ */}
      <footer className="relative z-10 pb-12">
        <div className="container-x">
          <div className="hairline mb-8" />
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <svg className="logo-mark" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 4 L33 8 V19 C33 26.5 27.5 32.5 20 35 C12.5 32.5 7 26.5 7 19 V8 Z" />
                <path d="M14 19.5 L18.5 24 L27 15.5" />
              </svg>
              <span className="text-[12.5px]" style={{ color: 'var(--text-dim)' }}>© 2026 AegisShield — Runtime AI security.</span>
            </div>

            <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
              <span className="nav-link" onClick={() => scrollTo('scan')}>Scan</span>
              <span className="nav-link" onClick={() => scrollTo('features')}>Platform</span>
              <span className="nav-link" onClick={() => scrollTo('demo')}>Live Demo</span>
              <span className="nav-link" onClick={() => scrollTo('contact')}>Contact</span>
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-dim)' }}>
                ⌨ Ctrl+K scan · Ctrl+Shift+W wrapper · Ctrl+E export
              </span>
            </nav>
          </div>
        </div>
      </footer>

      {/* ═══════ WRAPPER MODAL ═══════ */}
      {wrapOpen && (
        <div className="modal-back is-open" onClick={(e) => { if (e.target === e.currentTarget) setWrapOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <h3>Apply Runtime Wrapper</h3>
                <div className="sub">Live redaction · same engine as <span className="font-mono normal-case tracking-normal">wrapper.py /redact</span></div>
              </div>
              <button className="modal-close" onClick={() => setWrapOpen(false)} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-mute)' }}>
                Paste any tool output, model context, or log line that this skill might emit at runtime.
                AegisShield runs the same regex ruleset that powers the audit and returns a redacted version
                you can safely forward to your model context window.
              </p>

              <div className="wrap-grid">
                <div className="wrap-pane">
                  <header><span>Input</span><b>{wrapInStat}</b></header>
                  <textarea
                    value={wrapInput}
                    onChange={(e) => { setWrapInput(e.target.value); setWrapInStat(`${e.target.value.length} chars`); }}
                    spellCheck={false}
                    placeholder={`DEBUG: connecting with AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE\nPRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`}
                  />
                </div>
                <div className="wrap-pane">
                  <header>
                    <span>Redacted output</span>
                    <span className="flex items-center gap-2">
                      <b>{wrapOutStat}</b>
                      {wrapOutput && <CopyBtn text={wrapOutput} label="Copy" />}
                    </span>
                  </header>
                  <pre dangerouslySetInnerHTML={{ __html: wrapOutputHtml }} />
                </div>
              </div>

              <div className="modal-actions">
                <div className="stat"><span>{wrapSummary}</span></div>
                <div className="flex items-center gap-2">
                  <button className="btn" onClick={loadScanSample}>Load from scan</button>
                  <button className="btn" onClick={() => {
                    setWrapInput(''); setWrapInStat('0 chars');
                    setWrapOutputHtml('<span style="color:var(--text-dim)">Run the wrapper to see redacted output here.</span>');
                    setWrapOutStat('awaiting run');
                    setWrapOutput('');
                    setWrapSummary('Idle');
                  }}>Clear</button>
                  <button className="btn btn-primary" onClick={runWrapper}>
                    Run wrapper
                  </button>
                  <button className="btn ai-btn" onClick={runAiRedact} disabled={aiRedactLoading}>
                    {aiRedactLoading ? 'AI Analyzing...' : 'AI Redact'}
                  </button>
                </div>
              </div>


            </div>
          </div>
        </div>
      )}

      {/* ═══════ TOAST CONTAINER ═══════ */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
}