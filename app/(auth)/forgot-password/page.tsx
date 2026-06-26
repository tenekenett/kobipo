"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Mail, ArrowRight, ArrowLeft, Loader2, KeyRound, CheckCircle2 } from "lucide-react"

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      // Güvenlik: kullanıcı var/yok ayrımını sızdırmamak için her durumda aynı ekran.
      setSent(true)
    } catch {
      setSent(true)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="relative rounded-3xl bg-white/95 p-8 shadow-2xl ring-1 ring-white/40 backdrop-blur-xl animate-auth-slide-up"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="pointer-events-none absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-kobipo-mid/60 to-transparent" />

      <div className="mb-7 text-center">
        <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-kobipo-blue to-kobipo-mid shadow-lg shadow-kobipo-blue/30 animate-auth-float">
          {sent ? (
            <CheckCircle2 className="h-7 w-7 text-white" />
          ) : (
            <KeyRound className="h-7 w-7 text-white" />
          )}
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-kobipo-navy">
          {sent ? "E-postanı kontrol et" : "Şifreni mi unuttun?"}
        </h1>
        <p className="mt-1.5 text-sm text-kobipo-gray">
          {sent
            ? "Hesabın varsa şifre sıfırlama bağlantısını gönderdik."
            : "E-posta adresini gir, sıfırlama bağlantısını gönderelim."}
        </p>
      </div>

      {sent ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-kobipo-border bg-kobipo-pale/60 p-4 text-sm text-kobipo-navy">
            <strong className="break-all">{email}</strong> adresine bir e-posta gönderdik.
            Bağlantı <strong>1 saat</strong> boyunca geçerlidir. Gelen kutunda yoksa
            spam/gereksiz klasörünü kontrol et.
          </div>
          <button
            type="button"
            onClick={() => router.push("/signin")}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-kobipo-border bg-white py-2.5 text-sm font-semibold text-kobipo-navy transition-all hover:border-kobipo-blue hover:bg-kobipo-pale hover:text-kobipo-blue"
          >
            <ArrowLeft className="h-4 w-4" />
            Girişe dön
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <FloatingInput
            id="email"
            label="E-posta"
            type="email"
            placeholder="ornek@email.com"
            value={email}
            onChange={setEmail}
            icon={<Mail className="h-4 w-4" />}
            disabled={isLoading}
            required
            delay="0.2s"
          />

          <button
            type="submit"
            disabled={isLoading}
            className="group relative mt-2 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-kobipo-blue to-kobipo-mid px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-kobipo-blue/30 transition-all hover:scale-[1.02] hover:shadow-xl active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100 animate-auth-slide-up"
            style={{ animationDelay: "0.3s" }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-1000 group-hover:translate-x-full"
            />
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Gönderiliyor...
              </>
            ) : (
              <>
                Sıfırlama bağlantısı gönder
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => router.push("/signin")}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-kobipo-border bg-white py-2.5 text-sm font-semibold text-kobipo-navy transition-all hover:border-kobipo-blue hover:bg-kobipo-pale hover:text-kobipo-blue animate-auth-slide-up"
            style={{ animationDelay: "0.35s" }}
          >
            <ArrowLeft className="h-4 w-4" />
            Girişe dön
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
  placeholder,
  value,
  onChange,
  icon,
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
          className="peer w-full rounded-xl border-2 border-kobipo-border bg-white/80 py-3 pl-10 pr-3 text-sm text-kobipo-text placeholder:text-kobipo-gray/50 transition-all focus:border-kobipo-blue focus:bg-white focus:outline-none focus:ring-4 focus:ring-kobipo-blue/10"
        />
      </div>
    </div>
  )
}
