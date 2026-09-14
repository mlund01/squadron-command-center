import { useCallback, useRef, useState } from 'react';

interface UseHorizontalResizeOptions {
  initialWidth: number;
  minWidth: number;
  maxWidth: number;
}

export function useHorizontalResize({ initialWidth, minWidth, maxWidth }: UseHorizontalResizeOptions) {
  const [width, setWidth] = useState(initialWidth);
  const resizing = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      // Right-side panel: dragging left makes it wider
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth - (ev.clientX - startX)));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width, minWidth, maxWidth]);

  return { width, handleResizeStart };
}
