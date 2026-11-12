import { PushManager } from "@/components/push-manager";
import { SettingRow, SettingsGroup } from "@/components/admin/settings/setting-row";
import {
  FailedNotifications,
  type FailedNotification,
} from "@/components/admin/failed-notifications";

// The admin's own alerts: push on this device, and, only when there are any,
// the notices that could not be delivered (with a retry).
export function AdminNotices({ failed }: { failed: FailedNotification[] }) {
  return (
    <SettingsGroup title="Avisos">
      {/* The push control can be a long button or a line of help: it goes under the label. */}
      <li className="px-4 py-3.5">
        <p className="text-sm font-medium text-fg">Avisos en este dispositivo</p>
        <p className="mt-0.5 text-sm text-fg-faint">Reservas, pagos, cancelaciones y encuestas nuevas.</p>
        <div className="mt-2.5 empty:hidden">
          <PushManager />
        </div>
      </li>
      {failed.length > 0 ? (
        <li className="p-4">
          <FailedNotifications rows={failed} />
        </li>
      ) : (
        <SettingRow label="Avisos no enviados" value="Ninguno: todos los avisos salieron." muted />
      )}
    </SettingsGroup>
  );
}
