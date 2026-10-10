/** Links des Betreibers – im Footer als Icons. Leere Einträge werden nicht angezeigt. */
export const SOCIALS = [
  { key: "twitch", label: "Twitch", href: process.env.NEXT_PUBLIC_TWITCH_URL ?? "" },
  { key: "discord", label: "Discord", href: process.env.NEXT_PUBLIC_DISCORD_URL ?? "" },
  { key: "github", label: "GitHub", href: process.env.NEXT_PUBLIC_GITHUB_URL ?? "" },
] as const;
