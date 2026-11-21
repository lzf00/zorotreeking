import { useEffect, useRef } from "react";
import PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";
import { buildSrcSet, galleryVariants, lightboxVariants } from "@/lib/photo-srcset";

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
  srcWebp?: string;
  thumb: string;
  thumbWebp?: string;
  thumbSm?: string;
  midWebp?: string;
  heroWebp?: string;
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

/** PhotoSwipe 的核心包是动态 import 的（首屏不带 40 KB JS），代价是第一次点击要等下载。
 *  第 127 轮实测：手机上「点开图片」792 ms。所以在空闲时预热一次，并在指针/手指悬停时提前拉。 */
function warmPhotoSwipe(): void {
  void import("photoswipe").catch(() => {
    // 预热失败不重要：点击时还会再试一次（此时是用户主动触发的真实需求）
  });
}

export default function PhotoGallery({ photos, galleryId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 预热：空闲时（或 1.2 s 后）拉一次 PhotoSwipe，之后点开图片只需本地解析。
    // 顺便把第一张图的灯箱尺寸版本拉下来并解码 —— 第 129 轮实测「首次打开」576 ms、
    // 之后 16 ms，差的正是"模块下载 + 第一张大图解码"，提前做掉就把冷启动摊平了。
    const warmFirstImage = () => {
      const first = photos[0];
      if (!first) return;
      const img = new Image();
      img.srcset = buildSrcSet(lightboxVariants(first));
      img.sizes = "100vw";
      img.src = first.srcWebp || first.src;
      void img.decode?.().catch(() => {});
    };
    const warm = () => {
      warmPhotoSwipe();
      warmFirstImage();
    };
    const idle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    const idleHandle = idle ? idle(warm, { timeout: 2000 }) : window.setTimeout(warm, 1200);
    const warmOnIntent = () => warm();
    const containerEl = containerRef.current;
    containerEl.addEventListener("pointerenter", warmOnIntent, { passive: true, once: true });
    containerEl.addEventListener("touchstart", warmOnIntent, { passive: true, once: true });
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
            el.replaceChildren();
            if (alt) {
              const caption = document.createElement("div");
              caption.style.cssText = "font-family:inherit;color:#fff;margin-bottom:3px";
              caption.textContent = alt;
              el.appendChild(caption);
            }
            if (line) {
              el.appendChild(document.createTextNode(line));
            }
          });
        },
      });
    });

    lightbox.init();
    return () => {
      lightbox.destroy();
      if (idle && typeof (window as any).cancelIdleCallback === "function") {
        (window as any).cancelIdleCallback(idleHandle);
      } else {
        clearTimeout(idleHandle as number);
      }
      containerEl.removeEventListener("pointerenter", warmOnIntent);
      containerEl.removeEventListener("touchstart", warmOnIntent);
    };
  }, [galleryId, photos]);

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
            href={p.srcWebp || p.src}
            data-pswp-width={p.width}
            data-pswp-height={p.height}
            // 灯箱按显示尺寸挑候选图：手机先拿 720w（解码快），放大才升级到全尺寸。
            // 不加这行时，点开图片要等全尺寸图解码 —— 实测 792 ms 里 handler 只占 3 ms。
            data-pswp-srcset={buildSrcSet(lightboxVariants(p))}
            data-exif={p.exif ? JSON.stringify(p.exif) : undefined}
            aria-label={p.alt}
            className="block group relative overflow-hidden bg-black/40"
          >
            <picture>
              {/*
                列数是 1 / 2 / 3（见外层 columns-*），所以 sizes 跟着走。
                720w 给 2x 屏和窄屏，480w 给 1x 桌面三列——两组都是 sharp 预生成的，
                由浏览器按 DPR 自动挑，省得 1x 屏也硬拉 720w。
              */}
              {p.thumbWebp && (
                <source
                  type="image/webp"
                  srcSet={buildSrcSet(galleryVariants(p))}
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                />
              )}
              <img
                src={p.thumb}
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                alt={p.alt}
                width={p.width || undefined}
                height={p.height || undefined}
                // 第一张就是首屏最大元素（LCP）：lazy 会让它在弱网下晚 300–500 ms 才开始下载
                loading={i === 0 ? "eager" : "lazy"}
                fetchPriority={i === 0 ? "high" : "auto"}
                decoding="async"
                className="w-full h-auto block transition-transform duration-[600ms] group-hover:scale-[1.03]"
              />
            </picture>
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
