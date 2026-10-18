"use client";

import { useFormStatus } from "react-dom";
import { useTopProgress } from "@/components/ui/top-progress";

export function SubmitButton({
  children,
  pendingLabel = "처리 중",
  className = "button",
  progress = false
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  progress?: boolean;
}) {
  const { pending } = useFormStatus();
  useTopProgress(progress && pending);
  return <button className={className} type="submit" disabled={pending}>{pending ? pendingLabel : children}</button>;
}
