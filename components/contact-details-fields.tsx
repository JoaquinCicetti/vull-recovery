import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Name (required) + WhatsApp (optional), asked at confirm time when the profile
// is missing them.
export function ContactDetailsFields({
  idPrefix,
  name,
  phone,
  onName,
  onPhone,
  purpose = "Los usamos para tu turno y para coordinar con vos.",
}: {
  idPrefix: string;
  name: string;
  phone: string;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
  purpose?: string;
}) {
  return (
    <div className="surface-card surface-lift animate-fade-up p-5">
      <p className="eyebrow">Tus datos</p>
      <p className="mt-2 text-sm text-fg-muted">{purpose}</p>
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-name`}>Nombre y apellido</Label>
          <Input
            id={`${idPrefix}-name`}
            autoFocus
            required
            placeholder="Nombre y apellido"
            value={name}
            onChange={(e) => onName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-phone`}>WhatsApp (opcional)</Label>
          <Input
            id={`${idPrefix}-phone`}
            className="font-mono"
            inputMode="tel"
            placeholder="Ej. 341 123 4567"
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
