"use client"

import { useEffect, useRef } from "react"

// Google reCAPTCHA v2 (checkbox) istemci widget'ı.
// Bağımlılık eklemeden Google'ın api.js betiğini yükler ve "explicit" modda render eder.
// NEXT_PUBLIC_RECAPTCHA_SITE_KEY tanımlı değilse hiçbir şey çizmez (captcha pasif).

declare global {
  interface Window {
    grecaptcha?: {
      render: (
        container: HTMLElement,
        params: {
          sitekey: string
          callback: (token: string) => void
          "expired-callback"?: () => void
          "error-callback"?: () => void
          theme?: "light" | "dark"
        },
      ) => number
      reset: (widgetId?: number) => void
      ready: (cb: () => void) => void
    }
    onRecaptchaLoadCallbacks?: Array<() => void>
  }
}

const SCRIPT_ID = "google-recaptcha-v2"
const SCRIPT_SRC = "https://www.google.com/recaptcha/api.js?render=explicit"

/**
 * api.js betiğini bir kez yükler. Yüklendiğinde verilen callback çalıştırılır.
 */
function loadRecaptchaScript(onReady: () => void) {
  if (typeof window === "undefined") return

  if (window.grecaptcha?.render) {
    onReady()
    return
  }

  // Betik zaten ekliyse, hazır olunca tetiklensin diye kuyruğa al.
  window.onRecaptchaLoadCallbacks = window.onRecaptchaLoadCallbacks || []
  window.onRecaptchaLoadCallbacks.push(onReady)

  if (document.getElementById(SCRIPT_ID)) return

  const script = document.createElement("script")
  script.id = SCRIPT_ID
  script.src = SCRIPT_SRC
  script.async = true
  script.defer = true
  script.onload = () => {
    const flush = () => {
      const cbs = window.onRecaptchaLoadCallbacks || []
      window.onRecaptchaLoadCallbacks = []
      cbs.forEach((cb) => cb())
    }
    // v3'te grecaptcha.ready vardır; v2 explicit modda olmayabilir.
    if (typeof window.grecaptcha?.ready === "function") {
      window.grecaptcha.ready(flush)
    } else {
      flush()
    }
  }
  document.head.appendChild(script)
}

export interface RecaptchaHandle {
  reset: () => void
}

export function Recaptcha({
  onChange,
  onExpired,
}: {
  onChange: (token: string | null) => void
  onExpired?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<number | null>(null)
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY

  useEffect(() => {
    if (!siteKey) return
    let cancelled = false

    loadRecaptchaScript(() => {
      if (cancelled || !containerRef.current || widgetIdRef.current !== null) return
      if (!window.grecaptcha?.render) return
      widgetIdRef.current = window.grecaptcha.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => onChange(token),
        "expired-callback": () => {
          onChange(null)
          onExpired?.()
        },
        "error-callback": () => onChange(null),
      })
    })

    return () => {
      cancelled = true
    }
    // siteKey değişmez; onChange/onExpired stabil olmalı (parent useCallback ile sarar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey])

  // Anahtar yoksa widget gösterme.
  if (!siteKey) return null

  return <div ref={containerRef} className="flex justify-center" />
}
