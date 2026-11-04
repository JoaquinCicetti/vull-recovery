"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

// The optional discount code, asked only while a payment is being generated.
// Closed by default: most clients don't have one, and an open field reads as
// "you're missing a discount". create-payment checks the code on pay.
export function CouponField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
      >
        ¿Tenés un código de descuento?
      </button>
    );
  }

  return (
    <Input
      autoFocus
      aria-label="Código de descuento"
      placeholder="Código de descuento"
      className="mt-3 font-mono uppercase placeholder:font-sans placeholder:normal-case"
      value={value}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
      disabled={disabled}
      maxLength={32}
      autoCapitalize="characters"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}
