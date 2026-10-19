import { PushManager } from "@/components/push-manager";
import {
  FailedNotifications,
  type FailedNotification,
} from "@/components/admin/failed-notifications";

// The admin's own alerts: push on this device, and the notices that could not
// be delivered (with a retry).
export function AdminNotices({ failed }: { failed: FailedNotification[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="surface-card p-5">
        <p className="text-sm font-medium text-fg">Este dispositivo</p>
        <p className="mt-0.5 text-xs text-fg-faint">
          Recibí un aviso cuando entra una reserva, un pago para revisar o una cancelación.
        </p>
        <div className="mt-3">
          <PushManager />
        </div>
      </div>
      {failed.length > 0 ? (
        <FailedNotifications rows={failed} />
      ) : (
        <p className="text-sm text-fg-faint">Todos los avisos salieron.</p>
      )}
    </div>
  );
}
