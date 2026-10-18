import { ProgressIndicator } from "@/components/ui/top-progress";

export default function Loading() {
  return <div className="page"><ProgressIndicator label="화면 불러오는 중"/></div>;
}
