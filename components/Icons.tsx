import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  Apple,
  ArrowDownToDot,
  ArrowDownToLine,
  Axe,
  Beef,
  Bell,
  BrickWall,
  ChevronsUp,
  CircleStop,
  Clapperboard,
  Clock,
  Coins,
  Crown,
  Eye,
  Factory,
  Fish,
  Flag,
  Footprints,
  Gem,
  Ghost,
  Gift,
  Hammer,
  HandGrab,
  Handshake,
  Heart,
  HeartCrack,
  Hourglass,
  Headphones,
  HeartHandshake,
  LogIn,
  LogOut,
  Medal,
  MessageSquare,
  MessageSquareOff,
  MessagesSquare,
  Milestone,
  Moon,
  Package,
  PartyPopper,
  PawPrint,
  Pickaxe,
  Power,
  Send,
  Server,
  ServerOff,
  ShieldCheck,
  Skull,
  Sparkles,
  Star,
  Sunrise,
  Sword,
  Tag,
  Trophy,
  Type,
  UserPlus,
  Users,
  Video,
  VideoOff,
  WandSparkles,
  Zap,
  type LucideProps,
} from "lucide-react";
import type { IconName } from "@/lib/iconNames";

export { BOARD_ICON, EVENT_ICON, SPECIAL_ICON, type IconName } from "@/lib/iconNames";

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "square", strokeLinejoin: "miter" } as const;

/**
 * Lucide-Icon (ISC-Lizenz, wird mitgebündelt, keine Anfrage an Dritte) im Strich der eigenen Zeichnungen:
 * etwas kräftiger, eckige Enden.
 */
const lucide = (L: ComponentType<LucideProps>) =>
  function LucideIcon(p: P) {
    return <L strokeWidth={2.2} strokeLinecap="square" strokeLinejoin="miter" {...(p as LucideProps)} />;
  };

/** Alle Icons nach Namen (Zuordnung zu Kennzahlen und Ereignissen: lib/iconNames.ts) */
export const Icon: Record<IconName, (p: P) => ReactNode> = {
  login: lucide(LogIn),
  logout: lucide(LogOut),
  clock: lucide(Clock),
  hourglass: lucide(Hourglass),
  moon: lucide(Moon),
  sunrise: lucide(Sunrise),
  factory: lucide(Factory),
  stop: lucide(CircleStop),
  server: lucide(Server),
  serverOff: lucide(ServerOff),
  power: lucide(Power),
  users: lucide(Users),
  diamond: lucide(Gem),
  skull: lucide(Skull),
  pickaxe: lucide(Pickaxe),
  sword: lucide(Sword),
  boots: lucide(Footprints),
  axe: lucide(Axe),
  heart: lucide(Heart),
  food: lucide(Apple),
  bricks: lucide(BrickWall),
  heartCrack: lucide(HeartCrack),
  shield: lucide(ShieldCheck),
  jump: lucide(ChevronsUp),
  fall: lucide(ArrowDownToLine),
  ghost: lucide(Ghost),
  hammer: lucide(Hammer),
  hand: lucide(HandGrab),
  drop: lucide(ArrowDownToDot),
  wand: lucide(WandSparkles),
  chest: lucide(Package),
  handshake: lucide(Handshake),
  beef: lucide(Beef),
  paw: lucide(PawPrint),
  fish: lucide(Fish),
  bell: lucide(Bell),
  video: lucide(Video),
  videoOff: lucide(VideoOff),
  title: lucide(Type),
  star: lucide(Star),
  gift: lucide(Gift),
  bits: lucide(Sparkles),
  coin: lucide(Coins),
  clapper: lucide(Clapperboard),
  userPlus: lucide(UserPlus),
  raid: lucide(Send),
  chat: lucide(MessageSquare),
  chats: lucide(MessagesSquare),
  chatOff: lucide(MessageSquareOff),
  eye: lucide(Eye),
  headphones: lucide(Headphones),
  voicePair: lucide(HeartHandshake),
  trophy: lucide(Trophy),
  party: lucide(PartyPopper),
  medal: lucide(Medal),
  milestone: lucide(Milestone),
  crown: lucide(Crown),
  flag: lucide(Flag),
  bolt: lucide(Zap),
  tag: lucide(Tag),
  // Eigene Zeichnungen: Totem (gibt es bei Lucide nicht) und Markenlogos
  // YouTube: Short = Hochformat mit Play, Live an = Sendewellen, Live aus = Sendewellen durchgestrichen
  ytShort: (p: P) => (
    <svg {...base} {...p}>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M10 8.5v7l5.5-3.5z" fill="currentColor" />
    </svg>
  ),
  ytLive: (p: P) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
    </svg>
  ),
  ytLiveOff: (p: P) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2" opacity="0.55" />
      <path d="M3 3l18 18" />
    </svg>
  ),
  totem: (p: P) => (
    <svg {...base} {...p}>
      <path d="M8 3h8v4l2 2v10l-6 2-6-2V9l2-2z" />
      <path d="M8 9h8M9 12h1m4 0h1M10 16h4" />
    </svg>
  ),
  youtube: (p: P) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.7 15.1V8.9l5.8 3.1-5.8 3.1z" />
    </svg>
  ),
  twitch: (p: P) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M4 2 2 6v14h5v3h3l3-3h4l5-5V2H4zm16 12-3 3h-5l-3 3v-3H6V4h14v10zM14 7h2v5h-2V7zm-5 0h2v5H9V7z" />
    </svg>
  ),
  discord: (p: P) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M19.5 5.3A17 17 0 0 0 15.4 4l-.5 1a16 16 0 0 0-5.8 0l-.5-1a17 17 0 0 0-4.1 1.3C1.9 9.2 1.2 13 1.5 16.7A17 17 0 0 0 6.6 19l1-1.6a11 11 0 0 1-1.7-.8l.4-.3a12 12 0 0 0 11.4 0l.4.3-1.7.8 1 1.6a17 17 0 0 0 5.1-2.3c.4-4.3-.7-8-3-11.4ZM8.7 14.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
    </svg>
  ),
  github: (p: P) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.4-1.1-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.2-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .9-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />
    </svg>
  ),
};
