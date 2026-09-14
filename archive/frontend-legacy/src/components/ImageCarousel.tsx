import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Maximize2, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface ExtractedImage {
  src: string; // data URL or raw base64 with prefix
  index: number;
}

const DATA_URL_RE = /data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+/g;

/** Extract all base64 images from a string, returning the images and the text with placeholders. */
export function extractImages(text: string): { images: ExtractedImage[]; cleanText: string } {
  const images: ExtractedImage[] = [];
  let idx = 0;
  const cleanText = text.replace(DATA_URL_RE, (match) => {
    images.push({ src: match, index: idx++ });
    return '[image]';
  });
  return { images, cleanText };
}

/** Fullscreen image viewer with pan & zoom */
function FullscreenViewer({
  images,
  initialIndex,
  onClose,
}: {
  images: ExtractedImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const resetView = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  // Reset view when switching images
  useEffect(() => {
    resetView();
  }, [currentIndex, resetView]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && currentIndex > 0) setCurrentIndex(i => i - 1);
      else if (e.key === 'ArrowRight' && currentIndex < images.length - 1) setCurrentIndex(i => i + 1);
      else if (e.key === '0' || e.key === 'r') resetView();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentIndex, images.length, onClose, resetView]);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(s => Math.min(10, Math.max(0.1, s * delta)));
  }, []);

  // Pan via drag
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [scale, translate]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    setTranslate({
      x: dragStart.current.tx + (e.clientX - dragStart.current.x),
      y: dragStart.current.ty + (e.clientY - dragStart.current.y),
    });
  }, [dragging]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center gap-3">
          {images.length > 1 && (
            <span className="text-sm text-white/70 tabular-nums">
              {currentIndex + 1} / {images.length}
            </span>
          )}
          {scale !== 1 && (
            <span className="text-xs text-white/50 tabular-nums">{Math.round(scale * 100)}%</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="size-8 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            onClick={resetView}
            title="Reset zoom (R)"
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            className="size-8 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            onClick={onClose}
            title="Close (Esc)"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Navigation arrows */}
      {images.length > 1 && (
        <>
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 size-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-20"
            disabled={currentIndex <= 0}
            onClick={() => setCurrentIndex(i => i - 1)}
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 size-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-20"
            disabled={currentIndex >= images.length - 1}
            onClick={() => setCurrentIndex(i => i + 1)}
          >
            <ChevronRight className="size-5" />
          </button>
        </>
      )}

      {/* Image area */}
      <div
        ref={containerRef}
        className={cn('flex-1 flex items-center justify-center overflow-hidden', dragging ? 'cursor-grabbing' : scale > 1 ? 'cursor-grab' : 'cursor-default')}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <img
          src={images[currentIndex].src}
          alt={`Image ${currentIndex + 1}`}
          className="select-none pointer-events-none"
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            maxWidth: '95vw',
            maxHeight: '95vh',
            objectFit: 'contain',
            transition: dragging ? 'none' : 'transform 0.1s ease-out',
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}

/** Inline image thumbnails with expand-on-click. Shows a carousel when multiple images. */
export function ImageCarousel({ images, className }: { images: ExtractedImage[]; className?: string }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState<number | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <div className={cn('flex gap-2 flex-wrap mt-1.5', className)}>
        {images.map((img, i) => (
          <button
            key={i}
            className="rounded border border-border/60 overflow-hidden hover:border-foreground/30 transition-colors shrink-0 bg-muted/30"
            onClick={() => setExpanded(i)}
          >
            <img
              src={img.src}
              alt={`Image ${i + 1}`}
              className="max-h-24 max-w-32 object-contain"
            />
          </button>
        ))}
      </div>

      <Dialog open={expanded !== null} onOpenChange={(open) => { if (!open) setExpanded(null); }}>
        <DialogContent className="max-w-[92vw] max-h-[92vh] w-auto flex flex-col items-center p-4 bg-black/90 border-white/10" showCloseButton={false}>
          {/* Controls bar */}
          <div className="flex items-center gap-2 absolute top-3 right-3 z-10">
            <button
              className="size-8 flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 border border-white/20 transition-colors"
              onClick={() => { setFullscreen(expanded); setExpanded(null); }}
              title="Fullscreen"
            >
              <Maximize2 className="size-4" />
            </button>
            <button
              className="size-8 flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 border border-white/20 transition-colors"
              onClick={() => setExpanded(null)}
            >
              <X className="size-4" />
            </button>
          </div>
          {expanded !== null && (
            <>
              {images.length > 1 && (
                <div className="flex items-center gap-3 mb-2">
                  <button
                    className="text-white/60 hover:text-white text-sm px-3 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-30"
                    disabled={expanded <= 0}
                    onClick={() => setExpanded(Math.max(0, expanded - 1))}
                  >
                    Prev
                  </button>
                  <span className="text-xs text-white/60 tabular-nums">
                    {expanded + 1} / {images.length}
                  </span>
                  <button
                    className="text-white/60 hover:text-white text-sm px-3 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-30"
                    disabled={expanded >= images.length - 1}
                    onClick={() => setExpanded(Math.min(images.length - 1, expanded + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
              <div className="flex-1 flex items-center justify-center min-h-0 w-full">
                <img
                  src={images[expanded].src}
                  alt={`Image ${expanded + 1}`}
                  className="max-w-full max-h-[85vh] object-contain rounded"
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Fullscreen viewer */}
      {fullscreen !== null && (
        <FullscreenViewer
          images={images}
          initialIndex={fullscreen}
          onClose={() => setFullscreen(null)}
        />
      )}
    </>
  );
}
