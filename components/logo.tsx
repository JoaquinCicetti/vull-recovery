import Image from "next/image";
import { cn } from "@/lib/utils";
import { SITE_NAME } from "@/lib/site";

// Brand logo: the mark with "VULL LAB" set under it, on a transparent ground
// (public/logo-mark.svg). It already carries the name, so no separate wordmark.
//
// logo-mark.svg is public/logo.svg minus its black backing square, cropped to
// the artwork. Don't edit logo.svg for this: the 3D scene samples it as-is
// (components/experience/scene/logo-loader.ts).
export function Logo({
  className = "",
  imgClassName = "h-10",
}: {
  className?: string;
  /** Tailwind height for the mark (e.g. "h-10"). */
  imgClassName?: string;
}) {
  return (
    <Image
      src="/logo-mark.svg"
      alt={SITE_NAME}
      width={301}
      height={407}
      priority
      unoptimized
      className={cn("w-auto shrink-0", imgClassName, className)}
    />
  );
}
