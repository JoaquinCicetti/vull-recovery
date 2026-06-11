import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/format";
import type { BookingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusBadge({
  status,
  className,
}: {
  status: BookingStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "h-auto rounded-md px-2.5 py-1",
        STATUS_STYLE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}
