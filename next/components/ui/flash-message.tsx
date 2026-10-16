export function FlashMessage({ message, error }: { message?: string | null; error?: string | null }) {
  if (!message && !error) return null;
  return (
    <div role={error ? "alert" : "status"} aria-live="polite" className={`flash ${error ? "flash-error" : "flash-success"}`}>
      {error ?? message}
    </div>
  );
}
