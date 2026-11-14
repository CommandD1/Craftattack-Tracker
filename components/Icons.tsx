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
  trophy: lucide(Trophy),
  party: lucide(PartyPopper),
  medal: lucide(Medal),
  milestone: lucide(Milestone),
  crown: lucide(Crown),
  flag: lucide(Flag),
  bolt: lucide(Zap),
  tag: lucide(Tag),
  // Eigene Zeichnungen: Totem (gibt es bei Lucide nicht) und Markenlogos
  totem: (p: P) => (
    <svg {...base} {...p}>
      <path d="M8 3h8v4l2 2v10l-6 2-6-2V9l2-2z" />
      <path d="M8 9h8M9 12h1m4 0h1M10 16h4" />
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
