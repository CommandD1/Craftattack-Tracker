"use client";

import type { CSSProperties, MouseEvent } from "react";

interface Props {
  vodId: string | null;
  startOffset: number | null;
  start: number;
  end: number;
  style: CSSProperties;
  edge?: string;
  tip: string;
}

function vodUrl(vodId: string, offset: number) {
  const seconds = Math.max(0, Math.floor(offset));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `https://www.twitch.tv/videos/${encodeURIComponent(vodId)}?t=${hours}h${minutes}m${remainder}s`;
}

export function GanttLiveSegment({ vodId, startOffset, start, end, style, edge, tip }: Props) {
  if (!vodId || startOffset === null) {
    return <span className="gantt__live tip" style={style} data-edge={edge} data-tip={tip} tabIndex={0} />;
  }

  const href = vodUrl(vodId, startOffset);
  const openAtClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = event.detail === 0 || bounds.width === 0 ? 0 : Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const offset = startOffset + ((end - start) / 1000) * ratio;
    window.open(vodUrl(vodId, offset), "_blank", "noopener,noreferrer");
  };

  return (
    <a
      className="gantt__live tip"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${tip}, im VOD öffnen`}
      title="Im VOD an dieser Stelle öffnen"
      style={style}
      data-edge={edge}
      data-tip={tip}
      onClick={openAtClick}
    />
  );
}