import brandIconUrl from "./branding/common-icon.png";

export { brandIconUrl };

export function BrandIcon({ size = 28 }: { size?: number }) {
  return (
    <img
      className="brand-icon"
      src={brandIconUrl}
      width={size}
      height={size}
      alt="Common"
      draggable={false}
    />
  );
}
