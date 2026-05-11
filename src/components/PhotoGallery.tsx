import { useEffect, useRef } from "react";
import PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";

type Photo = {
  src: string;
  thumb: string;
  width: number;
  height: number;
  alt: string;
  exif?: Record<string, unknown>;
};

interface Props {
  photos: Photo[];
  galleryId: string;
}

export default function PhotoGallery({ photos, galleryId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const lightbox = new PhotoSwipeLightbox({
      gallery: `#${galleryId}`,
      children: "a",
      pswpModule: () => import("photoswipe"),
      bgOpacity: 0.95,
      showHideAnimationType: "fade",
    });
    lightbox.init();
    return () => lightbox.destroy();
  }, [galleryId]);

  return (
    <div
      ref={containerRef}
      id={galleryId}
      className="columns-1 sm:columns-2 lg:columns-3 gap-3 [&>a]:break-inside-avoid [&>a]:mb-3 [&>a]:block"
    >
      {photos.map((p, i) => (
        <a
          key={i}
          href={p.src}
          data-pswp-width={p.width}
          data-pswp-height={p.height}
          aria-label={p.alt}
          className="block group relative overflow-hidden rounded-lg bg-[var(--bg-soft)]"
        >
          <img
            src={p.thumb}
            alt={p.alt}
            loading="lazy"
            className="w-full h-auto block transition-transform duration-500 group-hover:scale-[1.02]"
          />
        </a>
      ))}
    </div>
  );
}
