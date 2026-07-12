/**
 * Kobipo yatay logo — inline (vektör) SVG.
 *
 * PNG yerine inline SVG kullanılır: her boyutta cam gibi keskindir ve
 * sayfadaki "DM Sans" fontu <text> öğelerine uygulandığı için marka fontu
 * korunur (SVG'yi <img> olarak vermek fontu Arial'e düşürürdü).
 * Saydam zeminlidir; koyu (navy) arka planlarda kullanılmak üzere beyaz
 * "kobi" + açık mavi "po" ile çizilmiştir.
 */
export function KobipoLogoMark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 280 80"
      role="img"
      aria-label="Kobipo"
      className={className}
    >
      <defs>
        <clipPath id="kobipo-ikon-clip">
          <rect x="8" y="8" width="64" height="64" rx="16" />
        </clipPath>
      </defs>
      <rect x="8" y="8" width="64" height="64" rx="16" fill="#378ADD" />
      <polygon points="8,72 72,8 72,72" fill="#185FA5" clipPath="url(#kobipo-ikon-clip)" />
      <path d="M18,50 A22,22 0 1,1 62,50" fill="none" stroke="white" strokeWidth={5} strokeLinecap="round" />
      <path d="M58,35 L62,50 L51,47" fill="none" stroke="white" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="40" cy="56" r="8" fill="#52B788" />
      <text x="88" y="46" fontFamily="'DM Sans', 'Helvetica Neue', Arial, sans-serif" fontSize="36" letterSpacing="-1">
        <tspan fontWeight="800" fill="#ffffff">kobi</tspan>
        <tspan fontWeight="300" fill="#B5D4F4">po</tspan>
      </text>
      <text x="89" y="68" fontFamily="'DM Sans', 'Helvetica Neue', Arial, sans-serif" fontSize="16" fontWeight="700" fill="#52B788" fontStyle="italic" letterSpacing="0.3">Az laf, dogru rakam.</text>
    </svg>
  )
}
