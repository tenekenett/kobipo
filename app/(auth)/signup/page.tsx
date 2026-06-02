"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"
import { Recaptcha } from "@/components/auth/recaptcha"
import {
  User,
  Building2,
  Phone,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  UserPlus,
} from "lucide-react"

const RECAPTCHA_ENABLED = Boolean(process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY)

export default function SignUpPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [formData, setFormData] = useState({
    name: "",
    companyOrPersonName: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)

  const handleCaptcha = useCallback((token: string | null) => setCaptchaToken(token), [])
  const resetCaptcha = useCallback(() => {
    setCaptchaToken(null)
    setCaptchaKey((k) => k + 1)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/

    if (RECAPTCHA_ENABLED && !captchaToken) {
      toast({
        title: "Doğrulama gerekli",
        description: "Lütfen 'Ben robot değilim' kutusunu işaretleyin",
        variant: "destructive",
      })
      return
    }

    if (
      !formData.name.trim() ||
      !formData.companyOrPersonName.trim() ||
      !formData.phone.trim() ||
      !formData.email.trim()
    ) {
      toast({
        title: "Hata",
        description: "Ad soyad, firma/şahıs adı, telefon ve e-mail zorunludur",
        variant: "destructive",
      })
      return
    }

    if (formData.password !== formData.confirmPassword) {
      toast({
        title: "Hata",
        description: "Şifreler eşleşmiyor",
        variant: "destructive",
      })
      return
    }

    if (!passwordRegex.test(formData.password)) {
      toast({
        title: "Hata",
        description:
          "Şifre en az 8 karakter olmalı, en az bir büyük harf, bir rakam ve bir özel karakter içermelidir",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          companyOrPersonName: formData.companyOrPersonName.trim(),
          phone: formData.phone.trim(),
          email: formData.email.trim(),
          password: formData.password,
          captchaToken: captchaToken ?? "",
        }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Kayıt başarısız")

      toast({
        title: "Başarılı",
        description: "Hesabınız oluşturuldu. Giriş yapabilirsiniz.",
      })
      router.push("/signin")
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error.message || "Bir hata oluştu",
        variant: "destructive",
      })
      resetCaptcha()
    } finally {
      setIsLoading(false)
    }
  }

  // Şifre güçlülük göstergesi
  const pw = formData.password
  const strength = (() => {
    let s = 0
    if (pw.length >= 8) s++
    if (/[A-Z]/.test(pw)) s++
    if (/\d/.test(pw)) s++
    if (/[^A-Za-z0-9]/.test(pw)) s++
    return s
  })()
  const strengthLabel = ["Çok zayıf", "Zayıf", "Orta", "İyi", "Güçlü"][strength]
  const strengthColor =
    strength <= 1
      ? "bg-red-500"
      : strength === 2
        ? "bg-amber-500"
        : strength === 3
          ? "bg-sky-500"
          : "bg-emerald-500"

  return (
    <div
      className="relative rounded-3xl bg-white/95 p-7 shadow-2xl ring-1 ring-white/40 backdrop-blur-xl animate-auth-slide-up"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="pointer-events-none absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-kobipo-mid/60 to-transparent" />

      <div className="mb-6 text-center">
        <div
          className="mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-kobipo-blue to-kobipo-mid shadow-lg shadow-kobipo-blue/30 animate-auth-float"
        >
          <UserPlus className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-kobipo-navy">
          Kobipo'ya katıl
        </h1>
        <p className="mt-1 text-sm text-kobipo-gray">
          Birkaç dakikada hesabını oluştur, hemen başla.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <FloatingInput
          id="name"
          label="Ad Soyad"
          type="text"
          placeholder="Adınız Soyadınız"
          value={formData.name}
          onChange={(v) => setFormData({ ...formData, name: v })}
          icon={<User className="h-4 w-4" />}
          disabled={isLoading}
          required
          delay="0.15s"
        />
        <FloatingInput
          id="companyOrPersonName"
          label="Firma / Şahıs Adı"
          type="text"
          placeholder="Firma veya şahıs adı"
          value={formData.companyOrPersonName}
          onChange={(v) => setFormData({ ...formData, companyOrPersonName: v })}
          icon={<Building2 className="h-4 w-4" />}
          disabled={isLoading}
          required
          delay="0.2s"
        />

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <FloatingInput
            id="phone"
            label="Telefon"
            type="tel"
            placeholder="05xx xxx xx xx"
            value={formData.phone}
            onChange={(v) => setFormData({ ...formData, phone: v })}
            icon={<Phone className="h-4 w-4" />}
            disabled={isLoading}
            required
            delay="0.25s"
          />
          <FloatingInput
            id="email"
            label="E-posta"
            type="email"
            placeholder="ornek@email.com"
            value={formData.email}
            onChange={(v) => setFormData({ ...formData, email: v })}
            icon={<Mail className="h-4 w-4" />}
            disabled={isLoading}
            required
            delay="0.3s"
          />
        </div>

        <div className="animate-auth-slide-up" style={{ animationDelay: "0.35s" }}>
          <FloatingInput
            id="password"
            label="Şifre"
            type={showPassword ? "text" : "password"}
            value={formData.password}
            onChange={(v) => setFormData({ ...formData, password: v })}
            icon={<Lock className="h-4 w-4" />}
            disabled={isLoading}
            required
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
          {pw && (
            <div className="mt-2">
              <div className="flex h-1.5 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-full flex-1 rounded-full transition-colors ${
                      i < strength ? strengthColor : "bg-kobipo-border"
                    }`}
                  />
                ))}
              </div>
              <p className="mt-1 text-[11px] text-kobipo-gray">
                {strengthLabel} · En az 8 karakter, bir büyük harf, bir rakam, bir özel karakter
              </p>
            </div>
          )}
        </div>

        <FloatingInput
          id="confirmPassword"
          label="Şifre Tekrar"
          type={showConfirm ? "text" : "password"}
          value={formData.confirmPassword}
          onChange={(v) => setFormData({ ...formData, confirmPassword: v })}
          icon={<Lock className="h-4 w-4" />}
          disabled={isLoading}
          required
          delay="0.4s"
          rightSlot={
            <button
              type="button"
              onClick={() => setShowConfirm((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-kobipo-gray hover:text-kobipo-blue transition-colors"
              tabIndex={-1}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />

        {RECAPTCHA_ENABLED && (
          <div className="mt-4 animate-auth-slide-up" style={{ animationDelay: "0.42s" }}>
            <Recaptcha key={captchaKey} onChange={handleCaptcha} />
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || (RECAPTCHA_ENABLED && !captchaToken)}
          className="group relative mt-4 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-kobipo-blue to-kobipo-mid px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-kobipo-blue/30 transition-all hover:scale-[1.02] hover:shadow-xl active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100 animate-auth-slide-up"
          style={{ animationDelay: "0.45s" }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-1000 group-hover:translate-x-full"
          />
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Kayıt yapılıyor...
            </>
          ) : (
            <>
              Hesap Oluştur
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </button>

        <div
          className="relative my-4 flex items-center animate-auth-slide-up"
          style={{ animationDelay: "0.5s" }}
        >
          <div className="flex-1 border-t border-kobipo-border" />
          <span className="px-3 text-xs text-kobipo-gray">veya</span>
          <div className="flex-1 border-t border-kobipo-border" />
        </div>

        <button
          type="button"
          onClick={() => router.push("/signin")}
          className="block w-full rounded-xl border border-kobipo-border bg-white py-2.5 text-sm font-semibold text-kobipo-navy transition-all hover:border-kobipo-blue hover:bg-kobipo-pale hover:text-kobipo-blue animate-auth-slide-up"
          style={{ animationDelay: "0.55s" }}
        >
          Zaten hesabın var mı? <span className="text-kobipo-blue">Giriş yap</span>
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
