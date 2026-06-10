"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"

export function RouteProgress() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [progress, setProgress] = useState(0)
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pathnameRef = useRef(pathname)
  const isInitialRef = useRef(true)

  // Tıklama dinleyicisi boş bağımlılıkla bir kez kurulduğu için güncel
  // pathname'e ref üzerinden erişiyoruz (aksi halde mount anındaki değer
  // sabit kalır).
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    if (!visible) {
      return
    }

    tickTimerRef.current = setInterval(() => {
      setProgress((current) => Math.min(current + 6, 90))
    }, 120)

    return () => {
      if (tickTimerRef.current) {
        clearInterval(tickTimerRef.current)
      }
    }
  }, [visible])

  useEffect(() => {
    // İlk mount'ta tamamlama animasyonunu çalıştırma; yoksa sayfa
    // açılışında çubuk bir an %100 görünüp kaybolur.
    if (isInitialRef.current) {
      isInitialRef.current = false
      return
    }

    setProgress(100)
    finishTimerRef.current = setTimeout(() => {
      setVisible(false)
      setProgress(0)
    }, 220)

    return () => {
      if (finishTimerRef.current) {
        clearTimeout(finishTimerRef.current)
      }
    }
  }, [pathname])

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      // Yeni sekmede açma / orta tık gibi gezinme başlatmayan tıklamaları
      // yok say (bunlar da pathname'i değiştirmez, çubuğu takılı bırakırdı).
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target as HTMLElement | null
      const anchor = target?.closest("a")
      if (!anchor) return
      const href = anchor.getAttribute("href")
      if (!href || !href.startsWith("/") || href.startsWith("//")) return

      // Hedef, bulunulan sayfanın aynısıysa gezinme gerçekleşmez; bu durumda
      // pathname değişmediği için tamamlama efekti tetiklenmez. Çubuğu hiç
      // başlatmayarak %90'da takılı kalmasını engelliyoruz (logo / dashboard
      // tuşuna zaten o sayfadayken tıklama durumu).
      const destination = new URL(href, window.location.href)
      if (destination.pathname === pathnameRef.current) {
        return
      }

      setVisible(true)
      setProgress(18)
    }

    document.addEventListener("click", onDocumentClick)
    return () => document.removeEventListener("click", onDocumentClick)
  }, [])

  if (!visible && progress === 0) {
    return null
  }

  return (
    <div className="pointer-events-none fixed left-0 right-0 top-0 z-[100] h-1 bg-transparent">
      <div
        className="h-full bg-kobipo-blue transition-[width] duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  )
}
