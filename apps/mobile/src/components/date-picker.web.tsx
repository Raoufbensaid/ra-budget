/**
 * Calendrier sur le web : celui du navigateur (champ date invisible ouvert
 * par showPicker).
 */
import { useEffect, useRef } from "react";

export function DatePicker({
  value,
  max,
  open,
  onChange,
  onClose,
}: {
  value: string;
  max?: string;
  open: boolean;
  onChange: (iso: string) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || !input.current) return;
    try {
      input.current.showPicker();
    } catch {
      // Navigateur sans showPicker : le champ reçoit le focus à la place.
      input.current.focus();
    }
  }, [open]);

  return (
    <input
      ref={input}
      type="date"
      value={value}
      max={max}
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value);
        onClose();
      }}
      onBlur={onClose}
      style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
    />
  );
}
