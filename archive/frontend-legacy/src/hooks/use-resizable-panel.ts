import { useState, useRef, useCallback, useEffect } from 'react';

export interface ReactFlowRef {
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getViewport: () => { x: number; y: number; zoom: number };
  setViewport: (vp: { x: number; y: number; zoom: number }) => void;
}

const GOLDEN_RATIO_MINOR = 0.382; // 1 - 1/φ ≈ 0.382

interface UseResizablePanelOptions {
  defaultHeight?: number;
  minHeight?: number;
}

export function useResizablePanel(opts?: UseResizablePanelOptions) {
  const MIN_PANEL_HEIGHT = opts?.minHeight ?? 120;
  const hasExplicitDefault = opts?.defaultHeight != null;

  const [panelHeight, setPanelHeight] = useState(opts?.defaultHeight ?? 300);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const collapsedHeightRef = useRef(MIN_PANEL_HEIGHT);
  const prevPanelHeightRef = useRef(panelHeight);
  const reactFlowRef = useRef<ReactFlowRef | null>(null);
  // Track the current ratio — starts at golden ratio, updated when user drags
  const ratioRef = useRef(GOLDEN_RATIO_MINOR);
  const userDraggedRef = useRef(false);

  // Callback ref: attach ResizeObserver to maintain golden ratio on container resize
  const containerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    if (!node || hasExplicitDefault) return;

    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (!h || h <= 0) return;
      const target = Math.floor(h * ratioRef.current);
      const clamped = Math.max(MIN_PANEL_HEIGHT, Math.min(target, Math.floor(h * 0.75)));
      setPanelHeight(clamped);
      prevPanelHeightRef.current = clamped;
    });
    ro.observe(node);

    // Cleanup: React calls callback ref with null on unmount
    return () => ro.disconnect();
  }, [MIN_PANEL_HEIGHT, hasExplicitDefault]);

  // Store a cleanup function from the callback ref
  const cleanupRef = useRef<(() => void) | undefined>(undefined);
  const wrappedCallbackRef = useCallback((node: HTMLDivElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = containerCallbackRef(node) as (() => void) | undefined;
  }, [containerCallbackRef]);

  // Clean up on unmount
  useEffect(() => () => cleanupRef.current?.(), []);

  const getMaxHeight = useCallback(() => {
    if (!containerRef.current) return 500;
    return Math.floor(containerRef.current.clientHeight * 0.75);
  }, []);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, [role="tab"]')) return;
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: panelHeight };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
  }, [panelHeight]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - e.clientY;
    const maxH = getMaxHeight();
    const newHeight = Math.min(maxH, Math.max(MIN_PANEL_HEIGHT, dragRef.current.startHeight + delta));
    setPanelHeight(newHeight);
    userDraggedRef.current = true;
  }, [getMaxHeight, MIN_PANEL_HEIGHT]);

  const handleDragEnd = useCallback(() => {
    if (dragRef.current && containerRef.current) {
      // Update ratio to match where the user dragged to, so window resizes preserve their choice
      const containerH = containerRef.current.clientHeight;
      if (containerH > 0) {
        ratioRef.current = panelHeight / containerH;
      }
    }
    dragRef.current = null;
  }, [panelHeight]);

  const togglePanel = useCallback(() => {
    const maxH = getMaxHeight();
    const containerH = containerRef.current?.clientHeight ?? 0;
    const goldenH = containerH > 0 ? Math.floor(containerH * GOLDEN_RATIO_MINOR) : 300;
    if (panelHeight >= maxH) {
      // Collapse: floor at golden ratio, not below
      const target = Math.max(goldenH, collapsedHeightRef.current);
      setPanelHeight(target);
      if (containerH > 0) ratioRef.current = target / containerH;
    } else {
      collapsedHeightRef.current = panelHeight;
      setPanelHeight(maxH);
      ratioRef.current = 0.75;
    }
  }, [panelHeight, getMaxHeight]);

  // Adjust canvas Y to keep visual center stable when panel height changes
  useEffect(() => {
    const rf = reactFlowRef.current;
    if (!rf) return;
    const delta = panelHeight - prevPanelHeightRef.current;
    prevPanelHeightRef.current = panelHeight;
    if (delta === 0) return;
    const vp = rf.getViewport();
    rf.setViewport({ x: vp.x, y: vp.y - delta / 2, zoom: vp.zoom });
  }, [panelHeight]);

  const onInit = useCallback((instance: ReactFlowRef) => {
    reactFlowRef.current = instance;
    setTimeout(() => instance.fitView(), 0);
  }, []);

  return {
    panelHeight,
    containerRef: wrappedCallbackRef,
    reactFlowRef,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    togglePanel,
    getMaxHeight,
    onInit,
  };
}
