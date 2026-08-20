"use client"

import { useState, useEffect, useCallback } from "react"
import { signIn, signOut, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"
import { roleToDashboardPath } from "@/lib/auth/role-paths"
import { Recaptcha } from "@/components/auth/recaptcha"
import { Mail, Lock, Eye, EyeOff, ArrowRight, Loader2 } from "lucide-react"

const RECAPTCHA_ENABLED = Boolean(process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY)

export default function SignInPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { data: session, status } = useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)

  const handleCaptcha = useCallback((token: string | null) => setCaptchaToken(token), [])
  // Token tek kullanımlık; başarısız denemeden sonra widget'ı sıfırla.
  const resetCaptcha = useCallback(() => {
    setCaptchaToken(null)
    setCaptchaKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (status !== "authenticated" || !session) return
    let iptal = false

    /**
     * Girişten sonra SERT yönlendirme (`router.push` DEĞİL).
     *
     * Yumuşak gezinme Next'in istemci route önbelleğini korur; o önbellekte ise
     * ÖNCEKİ oturumun RSC payload'ları durur. Aynı sekmede hesap değiştirince yeni
     * kullanıcı bir önceki kullanıcının çizimini görebiliyordu — 2026-08-20'de özel
     * rolle test ederken birebir yaşandı: kapı `/dashboard`'ı doğru reddedip yetkili
     * sayfaya yönlendirdiği hâlde ekranda "yetkiniz yok" duvarı kaldı, çünkü payload
     * önceki oturumdan geliyordu. Tam sayfa yükleme önbelleği tamamen düşürür.
     */
    const yonlendir = () => {
      if (iptal) return

      if (session.user?.isSuperAdmin) {
        window.location.assign("/system-admin")
        return
      }

      // Blog editörü (firmaya bağlı olmayan platform hesabı) yalnız blog panelini görür.
      if (session.user?.isBlogEditor) {
        window.location.assign("/blog-admin")
        return
      }

      const defaultCompanyId = session.user?.defaultCompanyId
      const defaultRole = session.user?.defaultRole

      if (defaultCompanyId && defaultRole) {
        const params = new URLSearchParams({ company: defaultCompanyId })
        window.location.assign(`${roleToDashboardPath(defaultRole)}?${params.toString()}`)
        return
      }

      window.location.assign("/dashboard")
    }

    /**
     * Yönlendirmeden ÖNCE sunucunun bu oturumu tanıdığını doğrula.
     *
     * NextAuth JWT kendi kendine yeterlidir: kullanıcı veritabanından silinse bile
     * imzalı çerez süresi dolana kadar (bir ay) istemciye "authenticated" der ve her
     * istekte kendini yeniler. Sunucu tarafı ise `getUserContext()` ile DB'ye bakar,
     * kullanıcıyı bulamaz ve panel düzeni `/signin`'e geri yollar. İkisi arasında
     * sonsuz `/signin → /dashboard → /signin` döngüsü doğardı: adres çubuğu `/signin`'de
     * sabit kaldığı için ekran "kendi kendine yenileniyor" gibi görünür, giriş formu
     * animasyonu hiç oturmaz, reCAPTCHA widget'ı sürekli kurulup söküldüğü için
     * `Timeout (b)` fırlatır. 2026-08-06'da bu yaşandı.
     *
     * `/api/companies` 401'i tam olarak "sunucu bağlamı yok" demektir — uç, yalnız
     * `getUserContext()` null olduğunda bu kodu döner. O durumda çerezi TEMİZLE:
     * kullanıcı kendi başına çıkamaz, çünkü panele hiç giremiyor.
     */
    ;(async () => {
      let sunucuTaniyor = true
      try {
        const res = await fetch("/api/companies", { cache: "no-store" })
        sunucuTaniyor = res.status !== 401
      } catch {
        // Ağ hatası oturumun geçersizliği anlamına gelmez — eski davranışa düş.
        sunucuTaniyor = true
      }
      if (iptal) return

      if (!sunucuTaniyor) {
        toast({
          title: "Oturumun artık geçerli değil",
          description: "Hesap bulunamadı. Lütfen tekrar giriş yap.",
          variant: "destructive",
        })
        await signOut({ redirect: false })
        return
      }

      yonlendir()
    })()

    return () => {
      iptal = true
    }
  }, [session, status, router, toast])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (RECAPTCHA_ENABLED && !captchaToken) {
      toast({
        title: "Doğrulama gerekli",
        description: "Lütfen 'Ben robot değilim' kutusunu işaretleyin",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)

    try {
      const result = await signIn("credentials", {
        email,
        password,
        captchaToken: captchaToken ?? "",
        redirect: false,
      })

      if (result?.error) {
        // Giriş başarısızsa: IP kilitli mi diye sor ve kullanıcıya net söyle (çok fazla deneme).
        let lockMsg: string | null = null
        try {
          const s = await fetch("/api/auth/lock-status", { cache: "no-store" }).then((r) => r.json())
          if (s?.locked) {
            const mins = Math.max(1, Math.ceil((s.retryAfterSeconds || 0) / 60))
            lockMsg = `Çok fazla başarısız deneme. Lütfen ~${mins} dakika sonra tekrar deneyin.`
          }
        } catch {
          // sessiz — generic mesaja düş
        }
        toast({
          title: lockMsg ? "Çok fazla deneme" : "Hata",
          description: lockMsg ?? "Email veya şifre hatalı",
          variant: "destructive",
        })
        resetCaptcha()
      } else {
        // Yukarıdaki `yonlendir` ile aynı gerekçe: sert yükleme, önceki oturumun
        // istemci route önbelleğini düşürür. (Oturum çözülünce `yonlendir` zaten
        // rolün kendi panosuna taşır; buradaki yalnız ilk adımdır.)
        window.location.assign("/dashboard")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Bir hata oluştu",
        variant: "destructive",
      })
      resetCaptcha()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="relative rounded-3xl bg-white/95 p-8 shadow-2xl ring-1 ring-white/40 backdrop-blur-xl animate-auth-slide-up"
      style={{ animationDelay: "0.1s" }}
    >
      {/* Üst dekor: ışıltılı şerit */}
      <div className="pointer-events-none absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-kobipo-mid/60 to-transparent" />

      <div className="mb-7 text-center">
        <div
          className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-kobipo-blue to-kobipo-mid shadow-lg shadow-kobipo-blue/30 animate-auth-float"
        >
          <Lock className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-kobipo-navy">
          Tekrar hoş geldin
        </h1>
        <p className="mt-1.5 text-sm text-kobipo-gray">
          Hesabına giriş yapıp kaldığın yerden devam et.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <FloatingInput
          id="email"
          label="E-posta"
          type="email"
          placeholder="ornek@email.com"
          value={email}
          onChange={(v) => setEmail(v)}
          icon={<Mail className="h-4 w-4" />}
          disabled={isLoading}
          required
          delay="0.2s"
        />

        <FloatingInput
          id="password"
          label="Şifre"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(v) => setPassword(v)}
          icon={<Lock className="h-4 w-4" />}
          disabled={isLoading}
          required
          delay="0.3s"
          rightSlot={
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-kobipo-gray hover:text-kobipo-blue transition-colors"
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          }
        />

        <div
          className="flex justify-end animate-auth-slide-up"
          style={{ animationDelay: "0.32s" }}
        >
          <button
            type="button"
            onClick={() => router.push("/forgot-password")}
            className="text-xs font-semibold text-kobipo-blue transition-colors hover:text-kobipo-mid"
          >
            Şifremi unuttum?
          </button>
        </div>

        {RECAPTCHA_ENABLED && (
          <div className="mt-4 animate-auth-slide-up" style={{ animationDelay: "0.35s" }}>
            <Recaptcha key={captchaKey} onChange={handleCaptcha} />
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || (RECAPTCHA_ENABLED && !captchaToken)}
          className="group relative mt-6 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-kobipo-blue to-kobipo-mid px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-kobipo-blue/30 transition-all hover:scale-[1.02] hover:shadow-xl active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100 animate-auth-slide-up"
          style={{ animationDelay: "0.4s" }}
        >
          {/* Shimmer overlay */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-1000 group-hover:translate-x-full"
          />
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Giriş yapılıyor...
            </>
          ) : (
            <>
              Giriş Yap
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </button>

        <div
          className="relative my-5 flex items-center animate-auth-slide-up"
          style={{ animationDelay: "0.5s" }}
        >
          <div className="flex-1 border-t border-kobipo-border" />
          <span className="px-3 text-xs text-kobipo-gray">veya</span>
          <div className="flex-1 border-t border-kobipo-border" />
        </div>

        <button
          type="button"
          onClick={() => router.push("/signup")}
          className="block w-full rounded-xl border border-kobipo-border bg-white py-2.5 text-sm font-semibold text-kobipo-navy transition-all hover:border-kobipo-blue hover:bg-kobipo-pale hover:text-kobipo-blue animate-auth-slide-up"
          style={{ animationDelay: "0.55s" }}
        >
          Hesabın yok mu? <span className="text-kobipo-blue">Kayıt ol</span>
        </button>
      </form>
    </div>
  )
}

function FloatingInput({
  id,
  label,
  type,
  placeholder,
  value,
  onChange,
  icon,
  rightSlot,
  disabled,
  required,
  delay,
}: {
  id: string
  label: string
  type: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
  icon?: React.ReactNode
  rightSlot?: React.ReactNode
  disabled?: boolean
  required?: boolean
  delay?: string
}) {
  return (
    <div
      className="animate-auth-slide-up"
      style={delay ? { animationDelay: delay } : undefined}
    >
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-kobipo-navy/80"
      >
        {label}
      </label>
      <div className="group relative">
        {icon && (
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-kobipo-gray group-focus-within:text-kobipo-blue transition-colors">
            {icon}
          </div>
        )}
        <input
          // Temp Mail vb. tarayıcı eklentileri e-posta/parola input'larına öznitelik
          // (data-temp-mail-org, background-image ikonu) enjekte edip hydration uyarısı
          // tetikliyor. Bu yalnız ilgili eklentiyi kuran kullanıcıda olur; uyarıyı bastır.
          suppressHydrationWarning
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          className={`peer w-full rounded-xl border-2 border-kobipo-border bg-white/80 py-3 ${
            icon ? "pl-10" : "pl-3"
          } ${
            rightSlot ? "pr-10" : "pr-3"
          } text-sm text-kobipo-text placeholder:text-kobipo-gray/50 transition-all focus:border-kobipo-blue focus:bg-white focus:outline-none focus:ring-4 focus:ring-kobipo-blue/10`}
        />
        {rightSlot}
      </div>
    </div>
  )
}
