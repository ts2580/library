export function Spinner({ label = "검색 중" }: { label?: string }) {
  return <span className="loading-status" role="status"><span className="spinner" aria-hidden="true"/>{label}</span>;
}
