// Lightweight canvas price chart: line (intraday) or candles (daily), volume bars,
// previous-close line and a touch crosshair. ~0 dependencies, cheap to redraw.

import { fmt } from './ui.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function niceStep(span, target) {
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n >= 5 ? 10 : n >= 2.5 ? 5 : n >= 2 ? 2.5 : n >= 1 ? 2 : 1) * mag;
}

const tFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
const dFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const mFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' });

/**
 * data: { t:[ms], c:[close], o?,h?,l?,v?, type:'line'|'candle', prev?, dp?, intraday? }
 * onHover(index|null, data) lets the page show the hovered value.
 */
export function createChart(host, { onHover } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'chart-canvas';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let data = null;
  let hover = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let layout = null;

  function resize() {
    const r = host.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(200, Math.floor(r.width));
    H = Math.max(150, Math.floor(r.height));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    draw();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!data || !data.c?.length) return;
    const col = { up: css('--up'), down: css('--down'), grid: css('--line'), text: css('--muted'), faint: css('--faint'), line: css('--blue'), bg: css('--bg') };
    const { t, c } = data;
    const candle = data.type === 'candle' && data.o && data.h && data.l;
    const n = c.length;
    const dp = data.dp ?? 2;
    const hasVol = Array.isArray(data.v) && data.v.some((x) => x > 0);
    const padL = 4;
    const padR = 58;
    const padT = 8;
    const padB = 20;
    const volH = hasVol ? Math.round(H * 0.15) : 0;
    const plotH = H - padT - padB - volH - (hasVol ? 6 : 0);
    const plotW = W - padL - padR;

    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      lo = Math.min(lo, candle ? data.l[i] : c[i]);
      hi = Math.max(hi, candle ? data.h[i] : c[i]);
    }
    if (Number.isFinite(data.prev)) { lo = Math.min(lo, data.prev); hi = Math.max(hi, data.prev); }
    const padY = (hi - lo) * 0.08 || Math.abs(hi) * 0.005 || 1;
    lo -= padY;
    hi += padY;
    const x = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (p) => padT + (1 - (p - lo) / (hi - lo)) * plotH;
    layout = { padL, plotW, n };

    // grid + price labels
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    const step = niceStep(hi - lo, 4);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = col.grid;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + plotW, yy);
      ctx.stroke();
      ctx.fillStyle = col.text;
      ctx.textAlign = 'left';
      ctx.fillText(fmt(v, step < 1 ? dp : 0), padL + plotW + 6, yy);
    }

    // previous close
    if (Number.isFinite(data.prev)) {
      const yy = Math.round(y(data.prev)) + 0.5;
      ctx.strokeStyle = col.faint;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + plotW, yy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const rising = c[n - 1] >= (Number.isFinite(data.prev) ? data.prev : c[0]);
    if (candle) {
      const bw = Math.max(1, Math.min(10, (plotW / n) * 0.62));
      for (let i = 0; i < n; i++) {
        const up = c[i] >= data.o[i];
        ctx.strokeStyle = ctx.fillStyle = up ? col.up : col.down;
        const xx = Math.round(x(i)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(xx, y(data.h[i]));
        ctx.lineTo(xx, y(data.l[i]));
        ctx.stroke();
        const top = y(Math.max(data.o[i], c[i]));
        const bh = Math.max(1, Math.abs(y(data.o[i]) - y(c[i])));
        ctx.fillRect(xx - bw / 2, top, bw, bh);
      }
    } else {
      const stroke = rising ? col.up : col.down;
      ctx.beginPath();
      for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, x(i), y(c[i]));
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.lineTo(x(n - 1), padT + plotH);
      ctx.lineTo(x(0), padT + plotH);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      g.addColorStop(0, `${stroke}33`);
      g.addColorStop(1, `${stroke}00`);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 1;
    }

    // volume
    if (hasVol) {
      const vmax = Math.max(...data.v);
      const base = H - padB;
      const bw = Math.max(1, (plotW / n) * 0.62);
      for (let i = 0; i < n; i++) {
        const vh = (data.v[i] / vmax) * volH;
        const up = candle ? c[i] >= data.o[i] : i === 0 || c[i] >= c[i - 1];
        ctx.fillStyle = up ? `${col.up}66` : `${col.down}66`;
        ctx.fillRect(x(i) - bw / 2, base - vh, bw, vh);
      }
    }

    // time labels
    ctx.fillStyle = col.text;
    ctx.textBaseline = 'alphabetic';
    const spanDays = (t[n - 1] - t[0]) / 86400e3;
    const lab = (ts) => (data.intraday ? tFmt.format(ts) : spanDays > 200 ? mFmt.format(ts) : dFmt.format(ts));
    const ticks = Math.min(4, n);
    for (let k = 0; k < ticks; k++) {
      const i = Math.round((k / Math.max(1, ticks - 1)) * (n - 1));
      ctx.textAlign = k === 0 ? 'left' : k === ticks - 1 ? 'right' : 'center';
      ctx.fillText(lab(t[i]), x(i), H - 5);
    }

    // crosshair
    if (hover != null && hover >= 0 && hover < n) {
      const xx = Math.round(x(hover)) + 0.5;
      const yy = Math.round(y(c[hover])) + 0.5;
      ctx.strokeStyle = col.text;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(xx, padT);
      ctx.lineTo(xx, padT + plotH);
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + plotW, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col.line;
      ctx.beginPath();
      ctx.arc(xx, yy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      const label = fmt(c[hover], dp);
      ctx.font = 'bold 11px system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = col.line;
      ctx.fillRect(padL + plotW + 2, yy - 9, Math.min(tw, padR - 2), 18);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, padL + plotW + 6, yy);
    }
  }

  function indexAt(e) {
    if (!layout || !data) return null;
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - layout.padL) / layout.plotW) * (layout.n - 1));
    return Math.max(0, Math.min(layout.n - 1, i));
  }
  const move = (e) => {
    const i = indexAt(e);
    if (i === hover) return;
    hover = i;
    draw();
    onHover?.(hover, data);
  };
  const leave = () => {
    hover = null;
    draw();
    onHover?.(null, data);
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', move);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('pointercancel', leave);
  canvas.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') leave(); });

  const ro = new ResizeObserver(resize);
  ro.observe(host);

  return {
    set(d) {
      data = d;
      hover = null;
      resize();
    },
    redraw: draw,
    destroy() {
      ro.disconnect();
      canvas.remove();
    },
  };
}
