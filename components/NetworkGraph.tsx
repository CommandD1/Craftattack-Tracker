"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PresenceEdge, PresenceNode } from "@/lib/analytics";
import { duration, headUrl, num } from "@/lib/format";

export interface NodeStyle {
  /** Farbe des Rings (Clan oder automatische Gruppe) */
  color: string;
  label: string;
}

interface Node extends PresenceNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  img: HTMLImageElement | null;
  online: boolean;
}

interface Tip {
  x: number;
  y: number;
  node: PresenceNode;
  group: string | null;
  partners: { name: string; lift: number; seconds: number }[];
}

/**
 * Kräfte-Simulation auf Canvas. Knoten = Spieler (mit Kopf), Ring = Clan bzw. Gruppe,
 * Linien = auffällig oft gleichzeitig online (Stärke = Faktor gegenüber Zufall), grün = gerade beide drauf.
 */
export function NetworkGraph({ nodes, edges, styles, onlineIds }: { nodes: PresenceNode[]; edges: PresenceEdge[]; styles: Record<string, NodeStyle>; onlineIds: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const router = useRouter();
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = () => canvas.width / dpr;
    const H = () => canvas.height / dpr;
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const css = getComputedStyle(document.documentElement);
    const color = (n: string) => css.getPropertyValue(n).trim();
    const onlineSet = new Set(onlineIds);

    const weight = new Map<string, number>();
    for (const e of edges) {
      weight.set(e.a, (weight.get(e.a) ?? 0) + e.lift);
      weight.set(e.b, (weight.get(e.b) ?? 0) + e.lift);
    }
    // Knoten derselben Gruppe starten nebeneinander, dann findet die Simulation schneller eine lesbare Anordnung
    const groupOrder = [...new Set(nodes.map((n) => styles[n.id]?.label ?? ""))];
    const sorted = [...nodes].sort((a, b) => groupOrder.indexOf(styles[a.id]?.label ?? "") - groupOrder.indexOf(styles[b.id]?.label ?? ""));
    const ns: Node[] = sorted.map((n, i) => {
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const rad = Math.min(W(), H()) * 0.36;
      const img = new Image();
      img.src = headUrl(n.uuid, 32, n.id);
      return { ...n, x: W() / 2 + Math.cos(a) * rad, y: H() / 2 + Math.sin(a) * rad, vx: 0, vy: 0, r: 11 + Math.min(12, Math.sqrt(weight.get(n.id) ?? 1) * 1.6), img, online: onlineSet.has(n.id) };
    });
    const byId = new Map(ns.map((n) => [n.id, n]));
    const es = edges.map((e) => ({ ...e, A: byId.get(e.a)!, B: byId.get(e.b)! })).filter((e) => e.A && e.B);
    const maxLift = Math.max(1, ...es.map((e) => e.lift));
    const sameGroup = (a: Node, b: Node) => styles[a.id] && styles[a.id].label === styles[b.id]?.label;

    let drag: Node | null = null;
    let hover: Node | null = null;
    let running = true;
    let tick = 0;
    let moved = false;

    const step = () => {
      const cx = W() / 2;
      const cy = H() / 2;
      for (const a of ns) {
        for (const b of ns) {
          if (a === b) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const f = 2600 / d2;
          a.vx += dx * f * 0.05;
          a.vy += dy * f * 0.05;
        }
        const pull = ns.length < 30 ? 0.012 : 0.005;
        a.vx += (cx - a.x) * pull;
        a.vy += (cy - a.y) * pull;
      }
      for (const e of es) {
        const dx = e.B.x - e.A.x;
        const dy = e.B.y - e.A.y;
        const d = Math.hypot(dx, dy) || 1;
        const target = (sameGroup(e.A, e.B) ? 90 : 150) - Math.min(50, e.lift * 6);
        const f = (d - target) * 0.004 * (1 + Math.log1p(e.lift) / 2);
        e.A.vx += (dx / d) * f;
        e.A.vy += (dy / d) * f;
        e.B.vx -= (dx / d) * f;
        e.B.vy -= (dy / d) * f;
      }
      for (const n of ns) {
        if (n === drag) continue;
        n.vx *= 0.8;
        n.vy *= 0.8;
        n.x = Math.max(n.r + 50, Math.min(W() - n.r - 50, n.x + n.vx));
        n.y = Math.max(n.r + 22, Math.min(H() - n.r - 8, n.y + n.vy));
      }
    };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W(), H());
      for (const e of es) {
        const active = hover && (e.A === hover || e.B === hover);
        ctx.strokeStyle = e.now ? color("--grass") : sameGroup(e.A, e.B) ? styles[e.A.id].color : color("--ender-2");
        ctx.globalAlpha = hover ? (active ? 0.95 : 0.04) : e.now ? 0.7 : 0.3;
        ctx.lineWidth = 1 + (e.lift / maxLift) * 7;
        ctx.beginPath();
        ctx.moveTo(e.A.x, e.A.y);
        ctx.lineTo(e.B.x, e.B.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      for (const n of ns) {
        const dim = hover && n !== hover && !es.some((e) => (e.A === hover && e.B === n) || (e.B === hover && e.A === n));
        ctx.globalAlpha = dim ? 0.25 : 1;
        const st = styles[n.id];
        // Ring: Gruppe/Clan; Punkt grün wenn online
        ctx.fillStyle = st ? st.color : color("--paper");
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color("--ink");
        ctx.lineWidth = 2;
        ctx.stroke();
        // Kopf
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.clip();
        ctx.imageSmoothingEnabled = false;
        if (n.img?.complete && n.img.naturalWidth) ctx.drawImage(n.img, n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
        else {
          ctx.fillStyle = color("--ender");
          ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
        }
        ctx.restore();
        if (n.online) {
          ctx.fillStyle = color("--grass");
          ctx.beginPath();
          ctx.arc(n.x + n.r * 0.75, n.y + n.r * 0.75, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        if (n.r > 14 || n === hover || ns.length <= 45 || (hover && !dim)) {
          ctx.fillStyle = color("--ink");
          ctx.strokeStyle = color("--paper");
          ctx.lineWidth = 3;
          ctx.strokeText(n.name, n.x, n.y - n.r - 7);
          ctx.fillText(n.name, n.x, n.y - n.r - 7);
        }
      }
      ctx.globalAlpha = 1;
      if (!ns.length) {
        ctx.fillStyle = color("--ink");
        ctx.font = "14px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("Noch zu wenige Daten.", 20, 30);
      }
    };
    const loop = () => {
      if (!running) return;
      if (tick++ < 500 || drag) step();
      draw();
      requestAnimationFrame(loop);
    };
    const point = (ev: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    };
    const find = ([x, y]: [number, number]) => ns.find((n) => Math.hypot(n.x - x, n.y - y) <= n.r + 5) ?? null;
    const showTip = (n: Node | null) => {
      if (!n) return setTip(null);
      const partners = es
        .filter((e) => e.A === n || e.B === n)
        .map((e) => ({ name: (e.A === n ? e.B : e.A).name, lift: e.lift, seconds: e.seconds }))
        .sort((a, b) => b.lift - a.lift)
        .slice(0, 5);
      setTip({ x: n.x, y: n.y - n.r - 10, node: n, group: styles[n.id]?.label ?? null, partners });
    };
    const onDown = (ev: PointerEvent) => {
      drag = find(point(ev));
      moved = false;
      if (drag) canvas.setPointerCapture(ev.pointerId);
    };
    const onMove = (ev: PointerEvent) => {
      const p = point(ev);
      if (drag) {
        moved = true;
        drag.x = p[0];
        drag.y = p[1];
        tick = Math.min(tick, 350);
      }
      const h = find(p);
      if (h !== hover) {
        hover = h;
        showTip(h);
      }
      canvas.style.cursor = hover ? "pointer" : "grab";
    };
    const onUp = (ev: PointerEvent) => {
      const was = drag;
      drag = null;
      if (was && !moved && find(point(ev)) === was) router.push(`/spieler/${encodeURIComponent(was.id)}`);
    };
    const onLeave = () => {
      hover = null;
      setTip(null);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", resize);
    loop();
    return () => {
      running = false;
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", resize);
    };
  }, [nodes, edges, styles, onlineIds, router]);

  return (
    <div className="netz__stage">
      <canvas ref={ref} className="netz__canvas" aria-label="Netzwerk der Spieler: wer ist auffällig oft gleichzeitig online" />
      {tip && (
        <div className="netz__tip" style={{ left: tip.x, top: tip.y }} role="status">
          <b>{tip.node.name}</b>
          {tip.group && <span className="muted"> · {tip.group}</span>}
          <span className="muted"> · {duration(tip.node.seconds)} online</span>
          {tip.partners.map((p) => (
            <span key={p.name} className="netz__tipline">
              {p.name}: <b className="num">{num(p.lift)}×</b> · {duration(p.seconds)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
