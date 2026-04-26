import Image from "next/image"
import Link from "next/link"

type LogoVariant = "light" | "dark" | "icon-only" | "wordmark" | "mono-black" | "mono-white"
type LogoSize = "sm" | "md" | "lg"

interface LogoProps {
  variant?: LogoVariant
  size?: LogoSize
  href?: string
  className?: string
}

const logoSizes = {
  sm: { w: 120, h: 36 },
  md: { w: 180, h: 52 },
  lg: { w: 240, h: 72 },
}

const iconSizes = {
  sm: { w: 32, h: 32 },
  md: { w: 48, h: 48 },
  lg: { w: 64, h: 64 },
}

const srcMap: Record<LogoVariant, string> = {
  light: "/assets/logos/kobipo-logo-yatay-acik.png",
  dark: "/assets/logos/kobipo-logo-yatay-koyu.png",
  wordmark: "/assets/logos/kobipo-wordmark.png",
  "icon-only": "/assets/icons/kobipo-ikon-512.png",
  "mono-black": "/assets/icons/kobipo-monokrom-siyah.png",
  "mono-white": "/assets/icons/kobipo-monokrom-beyaz.png",
}

const isIconVariant = (variant: LogoVariant) => variant === "icon-only"

export function Logo({
  variant = "light",
  size = "md",
  href = "/",
  className = "",
}: LogoProps) {
  const dims = isIconVariant(variant) ? iconSizes[size] : logoSizes[size]

  const img = (
    <Image
      src={srcMap[variant]}
      alt="Kobipo"
      width={dims.w}
      height={dims.h}
      priority
      className={className}
    />
  )

  if (!href) return img

  return (
    <Link href={href} className="inline-flex shrink-0 items-center">
      {img}
    </Link>
  )
}
