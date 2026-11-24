"use client";

import { useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";

/** Aufzeichnung eines Live-Balkens: Twitch-VOD oder (Ersatz bzw. nur auf YouTube gestreamt) YouTube-Livestream */
export interface LiveVod {
  kind: "twitch" | "youtube";
  id: string;
}

interface Props {
  vod: LiveVod | null;
  /** Position in der Aufzeichnung am Balkenanfang (Sekunden) */
  startOffset: number | null;
  start: number;
  end: number;
  style: CSSProperties;
  edge?: string;
  tip: string;
  /** Stream lief auf YouTube (roter Balken) statt auf Twitch */
  youtube?: boolean;
}

function vodUrl(vod: LiveVod, offset: number) {
  const seconds = Math.max(0, Math.floor(offset));
  if (vod.kind === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(vod.id)}&t=${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `https://www.twitch.tv/videos/${encodeURIComponent(vod.id)}?t=${hours}h${minutes}m${remainder}s`;
}

export function GanttLiveSegment({ vod, startOffset, start, end, style, edge, tip, youtube }: Props) {
  const [cursorRatio, setCursorRatio] = useState<number | null>(null);
  const cls = youtube ? "gantt__live gantt__live--youtube tip" : "gantt__live tip";
  if (!vod || startOffset === null) {
    return <span className={cls} style={style} data-edge={edge} data-tip={tip} tabIndex={0} />;
  }

  const onYt = vod.kind === "youtube";
  const offsetAtRatio = (ratio: number) => startOffset + ((end - start) / 1000) * ratio;
  const cursorOffset = cursorRatio === null ? null : offsetAtRatio(cursorRatio);
  const cursorTime = cursorOffset === null ? null : new Date(cursorOffset * 1000).toISOString().slice(11, 19);
  const href = vodUrl(vod, cursorOffset ?? startOffset);
  const trackPointer = (event: PointerEvent<HTMLAnchorElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) return;
    setCursorRatio(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)));
  };
  const openAtClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = event.detail === 0 || bounds.width === 0 ? 0 : Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    window.open(vodUrl(vod, offsetAtRatio(ratio)), "_blank", "noopener,noreferrer");
  };
  const currentTip = cursorTime ? `${tip} · ${onYt ? "YouTube" : "VOD"} ${cursorTime}` : tip;
  const target = onYt ? "Auf YouTube" : "Im VOD";

  return (
    <a
      className={cls}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${currentTip}, ${onYt ? "auf YouTube" : "im VOD"} öffnen`}
      title={cursorTime ? `${target} bei ${cursorTime} öffnen` : `${target} an dieser Stelle öffnen`}
      style={style}
      data-edge={edge}
      data-tip={currentTip}
      onPointerMove={trackPointer}
      onPointerLeave={() => setCursorRatio(null)}
      onClick={openAtClick}
    >
      {cursorRatio !== null && <span className="gantt__live-cursor" aria-hidden="true" style={{ left: `${cursorRatio * 100}%` }} />}
    </a>
  );
}
