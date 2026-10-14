import Avatar from "boring-avatars";
import { cn } from "@/lib/utils";

// Generated avatar: the same seed always draws the same picture. Seeded by the
// user id, not the name, so editing your name doesn't hand you a new face.
// Palette = the VULL greens over the matte blacks (globals.css).
const PALETTE = ["#61b33b", "#2f5e1c", "#a6e07f", "#161616", "#f4f4f4"];

export function UserAvatar({
  seed,
  size = 40,
  className,
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 overflow-hidden rounded-full ring-1 ring-border", className)}
      style={{ width: size, height: size }}
    >
      <Avatar name={seed} variant="beam" colors={PALETTE} size={size} />
    </span>
  );
}
