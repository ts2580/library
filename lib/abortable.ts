/** Stop awaiting an API without cancellation support (e.g. dns.lookup). */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error("Operation aborted")); };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    // Observe late rejections even after the caller has stopped awaiting the DNS result.
    operation.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}
