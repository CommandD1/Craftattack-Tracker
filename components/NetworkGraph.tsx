"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { PresenceEdge, PresenceNode } from "@/lib/analytics";

interface Node extends PresenceNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/** Kleine Kräfte-Simulation auf Canvas: Knoten = Spieler, Linienstärke = wie viel häufiger als zufällig gemeinsam online. */
export function NetworkGraph({ nodes, edges }: { nodes: PresenceNode[]; edges: PresenceEdge[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const router = useRouter();

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

    const weight = new Map<string, number>();
    for (const e of edges) {
      weight.set(e.a, (weight.get(e.a) ?? 0) + e.lift);
      weight.set(e.b, (weight.get(e.b) ?? 0) + e.lift);
    }
    const ns: Node[] = nodes.map((n, i) => {
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const rad = Math.min(W(), H()) * 0.35;
      return { ...n, x: W() / 2 + Math.cos(a) * rad, y: H() / 2 + Math.sin(a) * rad, vx: 0, vy: 0, r: 6 + Math.min(16, Math.sqrt(weight.get(n.id) ?? 1) * 2) };
    });
    const byId = new Map(ns.map((n) => [n.id, n]));
    const es = edges.map((e) => ({ ...e, A: byId.get(e.a)!, B: byId.get(e.b)! })).filter((e) => e.A && e.B);
    const maxLift = Math.max(1, ...es.map((e) => e.lift));

    let drag: Node | null = null;
    let hover: Node | null = null;
    let running = true;
    let tick = 0;

    const step = () => {
      const cx = W() / 2;
      const cy = H() / 2;
      for (const a of ns) {
        for (const b of ns) {
          if (a === b) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const f = 1800 / d2;
          a.vx += dx * f * 0.05;
          a.vy += dy * f * 0.05;
        }
        const pull = ns.length < 30 ? 0.012 : 0.004;
        a.vx += (cx - a.x) * pull;
        a.vy += (cy - a.y) * pull;
      }
      for (const e of es) {
        const dx = e.B.x - e.A.x;
        const dy = e.B.y - e.A.y;
        const d = Math.hypot(dx, dy) || 1;
        const target = 120 - Math.min(60, e.lift * 8);
        const f = (d - target) * 0.004 * (1 + Math.log1p(e.lift) / 2);
        e.A.vx += (dx / d) * f;
        e.A.vy += (dy / d) * f;
        e.B.vx -= (dx / d) * f;
        e.B.vy -= (dy / d) * f;
      }
      for (const n of ns) {
        if (n === drag) continue;
        n.vx *= 0.82;
        n.vy *= 0.82;
        n.x = Math.max(n.r + 40, Math.min(W() - n.r - 40, n.x + n.vx));
        n.y = Math.max(n.r + 18, Math.min(H() - n.r - 6, n.y + n.vy));
      }
    };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W(), H());
      for (const e of es) {
        const active = hover && (e.A === hover || e.B === hover);
        ctx.strokeStyle = e.now ? color("--grass") : color("--ender-2");
        ctx.globalAlpha = hover ? (active ? 0.95 : 0.05) : 0.35;
        ctx.lineWidth = 0.8 + (e.lift / maxLift) * 6;
        ctx.beginPath();
        ctx.moveTo(e.A.x, e.A.y);
        ctx.lineTo(e.B.x, e.B.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      for (const n of ns) {
        ctx.fillStyle = n === hover ? color("--gold") : color("--grass");
        ctx.strokeStyle = color("--ink");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (n.r > 10 || n === hover || ns.length <= 40) {
          ctx.fillStyle = color("--ink");
          ctx.fillText(n.name, n.x, n.y - n.r - 5);
        }
      }
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
    const find = ([x, y]: [number, number]) => ns.find((n) => Math.hypot(n.x - x, n.y - y) <= n.r + 4) ?? null;
    const onDown = (ev: PointerEvent) => {
      drag = find(point(ev));
      if (drag) canvas.setPointerCapture(ev.pointerId);
    };
    const onMove = (ev: PointerEvent) => {
      const p = point(ev);
      if (drag) {
        drag.x = p[0];
        drag.y = p[1];
        tick = Math.min(tick, 350);
      }
      hover = find(p);
      canvas.style.cursor = hover ? "pointer" : "grab";
    };
    const onUp = (ev: PointerEvent) => {
      const was = drag;
      drag = null;
      if (was && Math.hypot(was.vx, was.vy) < 1 && find(point(ev)) === was) router.push(`/spieler/${encodeURIComponent(was.id)}`);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    window.addEventListener("resize", resize);
    loop();
    return () => {
      running = false;
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      window.removeEventListener("resize", resize);
    };
  }, [nodes, edges, router]);

  return <canvas ref={ref} className="netz__canvas" aria-label="Netzwerk der Spieler: wer ist auffällig oft gleichzeitig online" />;
}
