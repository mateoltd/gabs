/**
 * Regular orange-circle halftone on black, across the entire image.
 * Each grid cell contains one circle. Source brightness controls its area.
 * No random positioning, random omission, grain, or continuous-tone background.
 * Pitch and diameter are measured in source-image pixels.
 */
export function halftoneGrid(source, options = {}) {
  const {
    pitch = 12,
    diameterRatio = 0.86,
    gamma = 1.45,
    background = [16, 16, 15],
    dotColor = [255, 83, 24],
    sourceLight = [255, 83, 24],
    sourceDark = [7, 7, 6],
    supersample = 3,
  } = options;
  if (!Number.isFinite(pitch) || pitch < 2 || pitch > 128)
    throw new RangeError("Pitch must be 2–128 pixels.");
  if (!(diameterRatio > 0 && diameterRatio < 1))
    throw new RangeError(
      "Diameter ratio must be between 0 and 1 to retain the grid gaps.",
    );
  if (!Number.isFinite(gamma) || gamma <= 0)
    throw new RangeError("Gamma must be positive.");
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  if (!(width > 0 && height > 0))
    throw new Error("Load the source before rendering.");
  const makeCanvas = (w, h) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
  };
  const input = makeCanvas(width, height);
  const inputContext = input.getContext("2d", { willReadFrequently: true });
  inputContext.drawImage(source, 0, 0);
  const pixels = inputContext.getImageData(0, 0, width, height).data;
  const axis = sourceLight.map((value, i) => value - sourceDark[i]);
  const divisor = axis.reduce((total, value) => total + value * value, 0);
  if (divisor === 0)
    throw new Error("Source light and dark colors must differ.");

  const layerHi = makeCanvas(width * supersample, height * supersample);
  const dotsContext = layerHi.getContext("2d");
  dotsContext.scale(supersample, supersample);
  dotsContext.fillStyle = `rgb(${dotColor.join(",")})`;
  const columns = Math.ceil(width / pitch);
  const rows = Math.ceil(height / pitch);
  const xStart = (width - (columns - 1) * pitch) / 2;
  const yStart = (height - (rows - 1) * pitch) / 2;
  const maximumRadius = (pitch * diameterRatio) / 2;
  const geometry = [];
  let dots = 0;

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = xStart + column * pitch;
      const y = yStart + row * pitch;
      // Sample a cell neighborhood so thin source contours remain legible.
      let brightness = 0;
      for (let sy = -1; sy <= 1; sy++) {
        for (let sx = -1; sx <= 1; sx++) {
          const ix = Math.max(
            0,
            Math.min(width - 1, Math.round(x + (sx * pitch) / 4)),
          );
          const iy = Math.max(
            0,
            Math.min(height - 1, Math.round(y + (sy * pitch) / 4)),
          );
          const index = (iy * width + ix) * 4;
          for (let c = 0; c < 3; c++)
            brightness +=
              ((pixels[index + c] - sourceDark[c]) * axis[c]) / divisor / 9;
        }
      }
      brightness = Math.max(0, Math.min(1, brightness));
      // Circle area, rather than opacity or dot count, encodes the tone.
      const radius = maximumRadius * Math.sqrt(Math.pow(brightness, gamma));
      if (radius < 0.06) continue;
      geometry.push({
        x,
        y,
        radius,
        phase: Math.PI * 2 * ((x / width) * 0.9 + (y / height) * 0.55),
      });
      dotsContext.beginPath();
      dotsContext.arc(x, y, radius, 0, Math.PI * 2);
      dotsContext.fill();
      dots++;
    }
  }
  // Retain the supersampled layer for crisp CSS-sized artwork on Retina screens.
  const layer = layerHi;
  const composite = makeCanvas(layer.width, layer.height);
  const output = composite.getContext("2d");
  // Cache source sampling and geometry; animation only changes the circle radii.
  // Omitting time restores the original, still artwork for reduced motion.
  const render = (seconds) => {
    output.fillStyle = `rgb(${background.join(",")})`;
    output.fillRect(0, 0, composite.width, composite.height);
    if (seconds === undefined) {
      output.drawImage(layer, 0, 0);
      return;
    }
    output.save();
    output.scale(supersample, supersample);
    output.fillStyle = `rgb(${dotColor.join(",")})`;
    output.beginPath();
    // A broad ten-second wave passes through a fixed grid without closing gaps.
    const time = (seconds * Math.PI * 2) / 10;
    const strength = Math.min(1, seconds / 1.5);
    for (const dot of geometry) {
      const radius = Math.min(
        pitch * 0.49,
        dot.radius * (1 + 0.1 * strength * Math.sin(dot.phase - time)),
      );
      output.moveTo(dot.x + radius, dot.y);
      output.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
    }
    output.fill();
    output.restore();
  };
  render();
  return { composite, layer, dots, columns, rows, render };
}
