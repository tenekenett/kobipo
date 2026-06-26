"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"
import { Lock, Eye, EyeOff, ArrowRight, ArrowLeft, Loader2, ShieldCheck, Check, Circle } from "lucide-react"

type Status = "checking" | "valid" | "invalid" | "done"

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const { toast } = useToast()

  const [status, setStatus] = useState<Status>("checking")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => setStatus(d?.valid ? "valid" : "invalid"))
      .catch(() => setStatus("invalid"))
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!PASSWORD_REGEX.test(password)) {
      toast({
        title: "Şifre yeterince güçlü değil",
        description: "En az 8 karakter; bir büyük harf, bir rakam ve bir özel karakter içermelidir.",
        variant: "destructive",
      })
      return
    }
    if (password !== confirm) {
      toast({
        title: "Şifreler eşleşmiyor",
        description: "İki alana da aynı şifreyi girin.",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (res.status === 400 && data?.error?.includes("geçersiz")) {
          setStatus("invalid")
        }
        toast({
          title: "Hata",
          description: data?.error || "Şifre güncellenemedi.",
          variant: "destructive",
        })
        return
      }

      setStatus("done")
      toast({
        title: "Şifren güncellendi",
        description: "Yeni şifrenle giriş yapabilirsin.",
      })
      setTimeout(() => router.push("/signin"), 1500)
    } catch {
      toast({
        title: "Hata",
        description: "Bir hata oluştu. Lütfen tekrar deneyin.",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Şifre kuralları — her biri canlı kontrol edilir, sağlanınca yeşile döner.
  const passwordChecks = [
    { label: "En az 8 karakter", ok: password.length >= 8 },
    { label: "Bir büyük harf (A-Z)", ok: /[A-Z]/.test(password) },
    { label: "Bir rakam (0-9)", ok: /\d/.test(password) },
    { label: "Bir özel karakter (örn. !@#$)", ok: /[^A-Za-z0-9]/.test(password) },
  ]
  const strength = passwordChecks.filter((c) => c.ok).length
  const strengthLabel = ["Çok zayıf", "Zayıf", "Orta", "İyi", "Güçlü"][strength]
  const strengthColor =
    strength <= 1
      ? "bg-red-500"
      : strength === 2
        ? "bg-amber-500"
        : strength === 3
          ? "bg-sky-500"
          : "bg-emerald-500"
  const confirmMismatch = confirm.length > 0 && confirm !== password

  return (
    <div
      className="relative rounded-3xl bg-white/95 p-8 shadow-2xl ring-1 ring-white/40 backdrop-blur-xl animate-auth-slide-up"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="pointer-events-none absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-kobipo-mid/60 to-transparent" />

      <div className="mb-7 text-center">
        <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-kobipo-blue to-kobipo-mid shadow-lg shadow-kobipo-blue/30 animate-auth-float">
          <ShieldCheck className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-kobipo-navy">
          Yeni şifre belirle
        </h1>
        <p className="mt-1.5 text-sm text-kobipo-gray">
          Hesabın için yeni bir şifre oluştur.
        </p>
      </div>

      {status === "checking" && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-kobipo-gray">
          <Loader2 className="h-4 w-4 animate-spin" />
          Bağlantı doğrulanıyor...
        </div>
      )}

      {status === "invalid" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Bu sıfırlama bağlantısı geçersiz veya süresi dolmuş. Lütfen yeni bir
            sıfırlama talebi oluştur.
          </div>
          <button
            type="button"
            onClick={() => router.push("/forgot-password")}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-kobipo-blue to-kobipo-mid py-2.5 text-sm font-semibold text-white shadow-lg shadow-kobipo-blue/30 transition-all hover:scale-[1.02]"
          >
            Yeni bağlantı iste
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => router.push("/signin")}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-kobipo-border bg-white py-2.5 text-sm font-semibold text-kobipo-navy transition-all hover:border-kobipo-blue hover:bg-kobipo-pale hover:text-kobipo-blue"
          >
            <ArrowLeft className="h-4 w-4" />
            Girişe dön
          </button>
        </div>
      )}

      {status === "done" && (
        <div className="rounded-xl border border-kobipo-border bg-kobipo-pale/60 p-4 text-center text-sm text-kobipo-navy">
          Şifren başarıyla güncellendi. Giriş sayfasına yönlendiriliyorsun...
        </div>
      )}

      {status === "valid" && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <FloatingInput
            id="password"
            label="Yeni şifre"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={setPassword}
            icon={<Lock className="h-4 w-4" />}
            disabled={isSubmitting}
            required
            delay="0.2s"
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-kobipo-gray hover:text-kobipo-blue transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />

          <div className="-mt-1">
            {password && (
              <>
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
                <p className="mt-1 text-[11px] font-semibold text-kobipo-gray">{strengthLabel}</p>
              </>
            )}
            <ul className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
              {passwordChecks.map((c) => (
                <li
                  key={c.label}
                  className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                    c.ok ? "font-medium text-emerald-600" : "text-kobipo-gray"
                  }`}
                >
                  {c.ok ? (
                    <Check className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Circle className="h-2.5 w-2.5 shrink-0 opacity-60" />
                  )}
                  {c.label}
                </li>
              ))}
            </ul>
          </div>

          <FloatingInput
            id="confirm"
            label="Yeni şifre (tekrar)"
            type={showPassword ? "text" : "password"}
            value={confirm}
            onChange={setConfirm}
            icon={<Lock className="h-4 w-4" />}
            disabled={isSubmitting}
            required
            delay="0.25s"
          />
          {confirmMismatch && (
            <p className="-mt-1 text-[11px] text-red-600">Şifreler eşleşmiyor.</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="group relative mt-2 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-kobipo-blue to-kobipo-mid px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-kobipo-blue/30 transition-all hover:scale-[1.02] hover:shadow-xl active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100 animate-auth-slide-up"
            style={{ animationDelay: "0.3s" }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-1000 group-hover:translate-x-full"
            />
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Güncelleniyor...
              </>
            ) : (
              <>
                Şifreyi güncelle
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>
        </form>
      )}
    </div>
  )
}

function FloatingInput({
  id,
  label,
  type,
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
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          className={`peer w-full rounded-xl border-2 border-kobipo-border bg-white/80 py-3 pl-10 ${
            rightSlot ? "pr-10" : "pr-3"
          } text-sm text-kobipo-text placeholder:text-kobipo-gray/50 transition-all focus:border-kobipo-blue focus:bg-white focus:outline-none focus:ring-4 focus:ring-kobipo-blue/10`}
        />
        {rightSlot}
      </div>
    </div>
  )
}
