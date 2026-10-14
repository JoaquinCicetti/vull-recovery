import { Blobatar } from "@blobatar/react";
import "blobatar/motion.css";
import { cn } from "@/lib/utils";

// Generated avatar: the same seed always draws the same creature. Seeded by the
// user id, not the name, so editing your name doesn't hand you a new face.
// The backdrop is pinned to a dark surface; the stock one is near-white and
// glares on the matte-black theme.
const PALETTE = { bg: "#1f1f1f" };

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
    <span aria-hidden className={cn("inline-flex shrink-0", className)}>
      <Blobatar name={seed} size={size} background="circle" palette={PALETTE} animate="hover" />
    </span>
  );
}
