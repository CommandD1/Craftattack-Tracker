"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { duration, headUrl, num } from "@/lib/format";

export interface GraphNode {
  id: string;
  name: string;
  uuid: string;
  online: boolean;
  live: boolean;
}

export interface GraphEdge {
  a: string;
  b: string;
  raidsAB: number;
  raidsBA: number;
  chats: number;
  chatSeconds: number;
  weight: number;
  now: boolean;
}

interface Node extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  weight: number;
  img: HTMLImageElement;
}

interface Tip {
  x: number;
  y: number;
  name: string;
  live: boolean;
  lines: { name: string; text: string }[];
}

/** Text für eine Verbindung aus Sicht von `self` */
function describe(e: GraphEdge, self: string) {
  const out = self === e.a ? e.raidsAB : e.raidsBA;
  const inn = self === e.a ? e.raidsBA : e.raidsAB;
  const parts: string[] = [];
  if (out) parts.push(`${num(out)}× geraidet`);
  if (inn) parts.push(`${num(inn)}× geraidet worden`);
  if (e.chats) parts.push(`${num(e.chats)}× geteilter Chat (${duration(e.chatSeconds)})${e.now ? ", gerade" : ""}`);
  return parts.join(" · ");
}

/**
 * Kräfte-Simulation auf Canvas. Knoten = Spieler (Kopf), Linien = Raids und geteilte Chats zwischen zwei Spielern.
 * Je mehr Raids und geteilte Chats, desto dicker die Linie und desto stärker ziehen sich die beiden an.
 */
export function ConnectionGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
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

    const weight = new Map<string, number>();
    for (const e of edges) {
      weight.set(e.a, (weight.get(e.a) ?? 0) + e.weight);
      weight.set(e.b, (weight.get(e.b) ?? 0) + e.weight);
    }
    const ns: Node[] = nodes.map((n, i) => {
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const rad = Math.min(W(), H()) * 0.36;
      const img = new Image();
      img.src = headUrl(n.uuid, 64, n.id);
      const w = weight.get(n.id) ?? 0;
      return { ...n, x: W() / 2 + Math.cos(a) * rad, y: H() / 2 + Math.sin(a) * rad, vx: 0, vy: 0, r: 12 + Math.min(14, Math.sqrt(w) * 2.2), weight: w, img };
    });
    const byId = new Map(ns.map((n) => [n.id, n]));
    const es = edges.map((e) => ({ ...e, A: byId.get(e.a)!, B: byId.get(e.b)! })).filter((e) => e.A && e.B);
    const maxW = Math.max(1, ...es.map((e) => e.weight));
    const neighbours = new Map<Node, Set<Node>>();
    for (const e of es) {
      if (!neighbours.has(e.A)) neighbours.set(e.A, new Set());
      if (!neighbours.has(e.B)) neighbours.set(e.B, new Set());
      neighbours.get(e.A)!.add(e.B);
      neighbours.get(e.B)!.add(e.A);
    }

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
          const f = (2400 + (a.r + b.r) * 60) / d2;
          a.vx += dx * f * 0.05;
          a.vy += dy * f * 0.05;
        }
        const pull = ns.length < 30 ? 0.01 : 0.005;
        a.vx += (cx - a.x) * pull;
        a.vy += (cy - a.y) * pull;
      }
      for (const e of es) {
        const dx = e.B.x - e.A.x;
        const dy = e.B.y - e.A.y;
        const d = Math.hypot(dx, dy) || 1;
        const s = e.weight / maxW;
        const target = 170 - s * 90 + e.A.r + e.B.r;
        const f = (d - target) * 0.004 * (1 + Math.log1p(e.weight));
        e.A.vx += (dx / d) * f;
        e.A.vy += (dy / d) * f;
        e.B.vx -= (dx / d) * f;
        e.B.vy -= (dy / d) * f;
      }
      for (const n of ns) {
        if (n === drag) continue;
        n.vx *= 0.8;
        n.vy *= 0.8;
        n.x = Math.max(n.r + 40, Math.min(W() - n.r - 40, n.x + n.vx));
        n.y = Math.max(n.r + 24, Math.min(H() - n.r - 8, n.y + n.vy));
      }
    };
    const draw = () => {
      // Farben jedes Mal frisch lesen, damit der Theme-Wechsel sofort greift
      const css = getComputedStyle(document.documentElement);
      const color = (n: string) => css.getPropertyValue(n).trim();
      const ink = color("--ink");
      const paper = color("--paper");
      const line = color("--line");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W(), H());
      for (const e of es) {
        const active = hover && (e.A === hover || e.B === hover);
        const raids = e.raidsAB + e.raidsBA;
        ctx.strokeStyle = e.now ? color("--grass") : raids && e.chats ? color("--gold") : raids ? color("--twitch") : color("--diamond");
        ctx.globalAlpha = hover ? (active ? 0.95 : 0.06) : 0.55;
        ctx.lineWidth = 1.5 + (e.weight / maxW) * 8;
        ctx.beginPath();
        ctx.moveTo(e.A.x, e.A.y);
        ctx.lineTo(e.B.x, e.B.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.font = `700 12px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textAlign = "center";
      for (const n of ns) {
        const dim = hover && n !== hover && !neighbours.get(hover)?.has(n);
        ctx.globalAlpha = dim ? 0.25 : 1;
        // Rahmen: lila, wenn gerade live
        ctx.fillStyle = n.live ? color("--twitch") : paper;
        ctx.fillRect(n.x - n.r - 3, n.y - n.r - 3, n.r * 2 + 6, n.r * 2 + 6);
        ctx.strokeStyle = line;
        ctx.lineWidth = 2;
        ctx.strokeRect(n.x - n.r - 3, n.y - n.r - 3, n.r * 2 + 6, n.r * 2 + 6);
        ctx.imageSmoothingEnabled = false;
        if (n.img.complete && n.img.naturalWidth) ctx.drawImage(n.img, n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
        else {
          ctx.fillStyle = color("--ender");
          ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
        }
        if (n.online) {
          ctx.fillStyle = color("--grass");
          ctx.fillRect(n.x + n.r - 3, n.y + n.r - 3, 8, 8);
          ctx.strokeRect(n.x + n.r - 3, n.y + n.r - 3, 8, 8);
        }
        if (n.r > 16 || n === hover || ns.length <= 40 || (hover && !dim)) {
          ctx.fillStyle = ink;
          ctx.strokeStyle = paper;
          ctx.lineWidth = 3;
          ctx.strokeText(n.name, n.x, n.y - n.r - 8);
          ctx.fillText(n.name, n.x, n.y - n.r - 8);
        }
      }
      ctx.globalAlpha = 1;
      if (!ns.length) {
        ctx.fillStyle = ink;
        ctx.font = `14px ${getComputedStyle(document.body).fontFamily}`;
        ctx.textAlign = "left";
        ctx.fillText("In diesem Zeitraum gab es keine Raids oder geteilten Chats.", 20, 30);
      }
    };
    const loop = () => {
      if (!running) return;
      if (tick++ < 600 || drag) step();
      draw();
      requestAnimationFrame(loop);
    };
    const point = (ev: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    };
    const find = ([x, y]: [number, number]) => ns.find((n) => Math.abs(n.x - x) <= n.r + 4 && Math.abs(n.y - y) <= n.r + 4) ?? null;
    const showTip = (n: Node | null) => {
      if (!n) return setTip(null);
      const lines = es
        .filter((e) => e.A === n || e.B === n)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 6)
        .map((e) => ({ name: (e.A === n ? e.B : e.A).name, text: describe(e, n.id) }));
      setTip({ x: n.x, y: n.y - n.r - 12, name: n.name, live: n.live, lines });
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
        tick = Math.min(tick, 400);
      }
      const h = drag ?? find(p);
      if (h !== hover) {
        hover = h;
        showTip(h);
      } else if (drag) showTip(drag);
      canvas.style.cursor = drag ? "grabbing" : hover ? "pointer" : "default";
    };
    const onUp = (ev: PointerEvent) => {
      const was = drag;
      drag = null;
      if (was && !moved && find(point(ev)) === was) router.push(`/spieler/${encodeURIComponent(was.id)}`);
    };
    const onLeave = () => {
      if (drag) return;
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
  }, [nodes, edges, router]);

  return (
    <div className="conn__stage">
      <canvas ref={ref} className="conn__canvas" aria-label="Netz der Spieler: wer wen geraidet hat und wer gemeinsam im geteilten Chat war" />
      {tip && (
        <div className="conn__tip" style={{ left: tip.x, top: tip.y }} role="status">
          <b>
            {tip.name}
            {tip.live && <span className="muted"> · live</span>}
          </b>
          {tip.lines.map((l) => (
            <span key={l.name} className="conn__tipline">
              {l.name}: {l.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
