import { useEffect, useRef } from "react";
import PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";

type Exif = {
  camera?: string;
  lens?: string;
  iso?: number;
  aperture?: number;
  shutter?: string;
  focal?: number;
  takenAt?: string;
};

type Photo = {
  src: string;
  thumb: string;
  width: number;
  height: number;
  alt: string;
  exif?: Exif;
};

interface Props {
  photos: Photo[];
  galleryId: string;
}

function formatExifLine(exif?: Exif): string {
  if (!exif) return "";
  const parts: string[] = [];
  if (exif.camera) parts.push(exif.camera);
  if (exif.lens) parts.push(exif.lens);
  const settings: string[] = [];
  if (exif.focal != null) settings.push(`${Math.round(Number(exif.focal))}mm`);
  if (exif.aperture != null) settings.push(`f/${Number(exif.aperture).toFixed(1).replace(/\.0$/, "")}`);
  if (exif.shutter) settings.push(exif.shutter);
  if (exif.iso != null) settings.push(`ISO ${exif.iso}`);
  if (settings.length) parts.push(settings.join(" · "));
  return parts.join("  ·  ");
}

export default function PhotoGallery({ photos, galleryId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const lightbox = new PhotoSwipeLightbox({
      gallery: `#${galleryId}`,
      children: "a",
      pswpModule: () => import("photoswipe"),
      bgOpacity: 0.97,
      showHideAnimationType: "fade",
      padding: { top: 40, bottom: 40, left: 0, right: 0 },
    });

    // 把每个 <a> 上的 data-exif / aria-label 注入到 PhotoSwipe slide data
    lightbox.addFilter("domItemData", (itemData: any, element: HTMLElement) => {
      const raw = element.getAttribute("data-exif");
      if (raw) {
        try { itemData.exif = JSON.parse(raw); } catch {}
      }
      itemData.alt = element.getAttribute("aria-label") || "";
      return itemData;
    });

    // 自定义 caption：左下角条形 EXIF
    lightbox.on("uiRegister", () => {
      lightbox.pswp?.ui?.registerElement({
        name: "exif-caption",
        order: 9,
        isButton: false,
        appendTo: "root",
        html: "",
        onInit: (el: HTMLElement, pswp: any) => {
          el.style.cssText = [
            "position:absolute",
            "left:0",
            "right:0",
            "bottom:0",
            "padding:14px 22px",
            "color:rgba(255,255,255,0.85)",
            "background:linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0))",
            "font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
            "letter-spacing:0.02em",
            "pointer-events:none",
            "text-align:center",
            "z-index:1",
          ].join(";");
          pswp.on("change", () => {
            const data = pswp.currSlide?.data;
            const exif = data?.exif as Exif | undefined;
            const alt = data?.alt as string | undefined;
            const line = formatExifLine(exif);
            el.innerHTML = [alt ? `<div style="font-family:inherit;color:#fff;margin-bottom:3px">${alt}</div>` : "", line]
              .filter(Boolean)
              .join("");
          });
        },
      });
    });

    lightbox.init();
    return () => lightbox.destroy();
  }, [galleryId]);

  return (
    <div
      ref={containerRef}
      id={galleryId}
      className="columns-1 sm:columns-2 lg:columns-3 gap-2 [&>a]:break-inside-avoid [&>a]:mb-2 [&>a]:block"
    >
      {photos.map((p, i) => {
        const exifLine = formatExifLine(p.exif);
        return (
          <a
            key={i}
            href={p.src}
            data-pswp-width={p.width}
            data-pswp-height={p.height}
            data-exif={p.exif ? JSON.stringify(p.exif) : undefined}
            aria-label={p.alt}
            className="block group relative overflow-hidden bg-black/40"
          >
            <img
              src={p.thumb}
              alt={p.alt}
              loading="lazy"
              className="w-full h-auto block transition-transform duration-[600ms] group-hover:scale-[1.03]"
            />
            {/* hover EXIF overlay：底部细条，淡入 */}
            {exifLine && (
              <div className="absolute inset-x-0 bottom-0 px-3 py-2 text-[10.5px] font-mono tracking-wide leading-snug text-white/90 opacity-0 group-hover:opacity-100 transition-opacity duration-200" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0))" }}>
                {exifLine}
              </div>
            )}
          </a>
        );
      })}
    </div>
  );
}
