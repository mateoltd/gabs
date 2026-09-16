# Sign-in artwork

`sign-in-source.png` and `halftone-grid.mjs` were supplied by the user from the pointillism-art visualization on 15 September 2026. The source was generated for that visualization.

The original filter maps brightness onto the area of regular orange circles. This copy preserves that algorithm and retains the supersampled output instead of reducing it back to source dimensions. `../artwork.tsx` fits the source to its actual pane, keeps a 12 CSS-pixel pitch, caps output size and pixel density, and resamples only after a resize settles. No random grain, wallpaper, or presentation frame is included.

A broad ten-second wave varies cached dot radii by up to 10%, leaving positions and colors fixed. Canvas painting is capped at 30 frames per second and pauses when the page or artwork is hidden. Reduced motion restores the original static rendering. The artwork itself is never translated or scaled.

Both web and desktop bundle the asset locally. The web application asset cache includes PNGs so a prepared offline shell can retain the artwork. There are no remote image requests.
