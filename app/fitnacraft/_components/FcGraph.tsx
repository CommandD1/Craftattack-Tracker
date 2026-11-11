"use client";

import { ConnectionGraph, type GraphEdge, type GraphNode } from "@/components/ConnectionGraph";
import { DEFAULT_WEIGHTS, LINK_KINDS, linkPoints, type LinkCounts } from "@/lib/connectionWeights";

/** Netz der FitnaCraft-Spieler (Raids, geteilte Chats, Titel, Chat), Klick öffnet das FitnaCraft-Profil */
export function FcGraph({ nodes, links, base }: { nodes: GraphNode[]; links: LinkCounts[]; base: string }) {
  const edges: GraphEdge[] = links
    .map((l) => {
      const pts = linkPoints(l, DEFAULT_WEIGHTS);
      const kind = LINK_KINDS.reduce((m, k) => (pts[k] > pts[m] ? k : m), LINK_KINDS[0]);
      return { ...l, weight: LINK_KINDS.reduce((s, k) => s + pts[k], 0), kind };
    })
    .filter((e) => e.weight > 0);
  return <ConnectionGraph nodes={nodes} edges={edges} hrefOf={(id) => `${base}/spieler/${encodeURIComponent(id)}`} />;
}
