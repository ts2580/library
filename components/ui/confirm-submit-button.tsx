"use client";

import { useFormStatus } from "react-dom";

export function ConfirmSubmitButton({
  children,
  message,
  className = "button button-danger-outline",
  pendingLabel = "처리 중",
  disabled = false,
  formAction,
  formNoValidate
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
  pendingLabel?: string;
  disabled?: boolean;
  formAction?: (formData: FormData) => void | Promise<void>;
  formNoValidate?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      type="submit"
      formAction={formAction}
      formNoValidate={formNoValidate}
      disabled={pending || disabled}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
