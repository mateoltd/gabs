export function halftoneGrid(
  source: HTMLCanvasElement | HTMLImageElement,
  options?: {
    pitch?: number;
    diameterRatio?: number;
    gamma?: number;
    background?: number[];
    dotColor?: number[];
    sourceLight?: number[];
    sourceDark?: number[];
    supersample?: number;
  },
): {
  composite: HTMLCanvasElement;
  layer: HTMLCanvasElement;
  dots: number;
  columns: number;
  rows: number;
  render: (seconds?: number) => void;
};
