import { useState } from 'react';
import { X } from 'lucide-react';
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

/** Inline image thumbnails with expand-on-click. Shows a carousel when multiple images. */
export function ImageCarousel({ images, className }: { images: ExtractedImage[]; className?: string }) {
  const [expanded, setExpanded] = useState<number | null>(null);

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
        <DialogContent className="max-w-[90vw] max-h-[90vh] flex flex-col items-center p-4 bg-black/90 border-white/10" showCloseButton={false}>
          <button
            className="absolute top-3 right-3 z-10 size-8 flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 border border-white/20 transition-colors"
            onClick={() => setExpanded(null)}
          >
            <X className="size-4" />
          </button>
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
              <img
                src={images[expanded].src}
                alt={`Image ${expanded + 1}`}
                className="max-w-full max-h-[80vh] object-contain rounded"
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
