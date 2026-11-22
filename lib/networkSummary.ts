import "server-only";
import { getDailyNetwork, getNetwork } from "./connections";
import { adjacency } from "./network";
import { analyzeGroups, type GroupAnalysis } from "./groups";
import { DEFAULT_WEIGHTS, type LinkCounts } from "./connectionWeights";
import type { NetworkNode } from "./connections";
import { sumDays } from "./dailyNetwork";

export interface NetworkSummary {
  nodes: NetworkNode[];
  edges: LinkCounts[];
  out: Map<string, Map<string, number>>;
  analysis: GroupAnalysis;
}

/**
 * `ca` (Standard): nur, was geschah, während mindestens einer der beiden auf CraftAttack war (Netz je Tag „einer
 * online“, über die Staffel summiert); `alles`: alle Twitch-Daten.
 */
export type NetworkScope = "ca" | "alles";

const TTL_MS = 2 * 60_000;
const cached = new Map<NetworkScope, { at: number; value: Promise<NetworkSummary> }>();

export function getNetworkSummary(scope: NetworkScope = "ca"): Promise<NetworkSummary> {
  const hit = cached.get(scope);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const base =
    scope === "alles"
      ? getNetwork(null).then(({ nodes, edges }) => ({ nodes, edges }))
      : getDailyNetwork("einer").then(({ nodes, daily }) => ({ nodes, edges: sumDays(daily, 0, daily.days.length - 1) }));
  const value = base.then(({ nodes, edges }) => ({ nodes, edges, out: adjacency(edges, DEFAULT_WEIGHTS), analysis: analyzeGroups(edges, DEFAULT_WEIGHTS) }));
  cached.set(scope, { at: Date.now(), value });
  // Fehler nicht zwei Minuten lang behalten
  value.catch(() => {
    if (cached.get(scope)?.value === value) cached.delete(scope);
  });
  return value;
}
