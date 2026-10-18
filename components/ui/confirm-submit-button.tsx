"use client";

import { useFormStatus } from "react-dom";

export function ConfirmSubmitButton({
  children,
  message,
  className = "button button-danger-outline",
  pendingLabel = "처리 중",
  disabled = false
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
  pendingLabel?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      type="submit"
      disabled={pending || disabled}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
