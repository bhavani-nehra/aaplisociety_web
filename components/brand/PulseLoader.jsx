// components/brand/PulseLoader.jsx — the app-wide loading indicator.
// Art: public/motions/02-pulse-grid (light/dark), swapped by theme through
// the --pulse-loader-img variable in styles/globals.css.
export default function PulseLoader({ size = 28, className = "", style, label = "Loading", ...rest }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`pulse-loader ${className}`}
      style={{ width: size, height: size, ...style }}
      {...rest}
    />
  );
}
