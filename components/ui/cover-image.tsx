import { coverSource } from "@/features/covers/path";

export function CoverImage({ cover, alt, className = "" }: { cover: string | null | undefined; alt: string; className?: string }) {
  const src = coverSource(cover);
  return src ? (
    // Runtime covers are authenticated and may be remote; native img is intentional.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} data-cover-preview loading="lazy" decoding="async" referrerPolicy="no-referrer" />
  ) : (
    <div className={`cover-placeholder ${className}`} aria-label={`${alt} 표지 없음`}>NO COVER</div>
  );
}
