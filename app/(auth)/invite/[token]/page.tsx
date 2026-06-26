"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useSession, signIn } from "next-auth/react"
import { roleLabel } from "@/lib/auth/role-labels"
import { User, Phone, Lock, Eye, EyeOff, Check, Circle, Loader2 } from "lucide-react"

type InvitationInfo = {
  valid: boolean
  email: string
  role: string
  companyName: string
  hasAccount: boolean
}

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/

/** Türk cep telefonunu yazarken canlı biçimlendirir: 0XXX XXX XX XX (maks 11 hane). */
function formatTrPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11)
  const parts: string[] = []
  if (d.length > 0) parts.push(d.slice(0, 4))
  if (d.length > 4) parts.push(d.slice(4, 7))
  if (d.length > 7) parts.push(d.slice(7, 9))
  if (d.length > 9) parts.push(d.slice(9, 11))
  return parts.join(" ")
}

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const { data: session } = useSession()
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/invitations/${token}`)
      .then(async (response) => {
        if (!response.ok) {
          setStatus("error")
          setError("Davet bulunamadı veya süresi dolmuş.")
          return
        }
        const data = await response.json()
        setInvitation(data)
        setStatus("ready")
      })
      .catch(() => {
        setStatus("error")
        setError("Davet doğrulanamadı.")
      })
  }, [token])

  // Davet edilen e-postanın hesabı yoksa yeni şube müdürü kendi şifresini belirler.
  const needsPassword = invitation ? !invitation.hasAccount : false
  const differentSession =
    Boolean(session?.user?.email) &&
    Boolean(invitation?.email) &&
    session!.user!.email!.toLowerCase() !== invitation!.email.toLowerCase()

  // Telefon: 11 hane ve 0 ile başlamalı (05xx...).
  const phoneDigits = phone.replace(/\D/g, "")
  const phoneValid = phoneDigits.length === 11 && phoneDigits.startsWith("0")

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

  const accept = async () => {
    setError("")

    if (needsPassword) {
      if (!name.trim() || !phone.trim() || !password) {
        setError("Ad soyad, telefon ve şifre zorunludur.")
        return
      }
      if (!phoneValid) {
        setError("Geçerli bir telefon numarası girin (0 ile başlayan 11 hane).")
        return
      }
      if (!PASSWORD_REGEX.test(password)) {
        setError("Şifre en az 8 karakter olmalı; bir büyük harf, bir rakam ve bir özel karakter içermelidir.")
        return
      }
      if (password !== confirm) {
        setError("Şifreler eşleşmiyor.")
        return
      }
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/invitations/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Telefon DB'ye boşluksuz (yalnızca rakam) kaydedilir; ekranda formatlı gösterilir.
        body: JSON.stringify({ name, phone: phoneDigits, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error || "Davet kabul edilemedi")
        return
      }

      // Yeni hesap oluşturulduysa signupToken ile otomatik giriş (captcha atlanır).
      if (data.signupToken) {
        const signInResult = await signIn("credentials", {
          email: data.email,
          password,
          signupToken: data.signupToken,
          redirect: false,
        })
        if (signInResult?.error) {
          router.push("/signin")
          return
        }
        router.push("/dashboard")
        return
      }

      // Mevcut hesap: bu e-postayla zaten giriş yapılmışsa panele, değilse girişe.
      if (session?.user?.email?.toLowerCase() === String(data.email).toLowerCase()) {
        router.push("/dashboard")
      } else {
        router.push("/signin")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto mt-16 w-full max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>Firma Daveti</CardTitle>
          <CardDescription>Davet edilen firmaya katılım işlemini tamamlayın</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "loading" && <p className="text-sm text-muted-foreground">Davet doğrulanıyor...</p>}
          {status === "error" && <p className="text-sm text-red-600">{error}</p>}
          {status === "ready" && invitation && (
            <>
              <div className="rounded border p-3 text-sm">
                <p><strong>Firma:</strong> {invitation.companyName}</p>
                <p><strong>E-posta:</strong> {invitation.email}</p>
                <p><strong>Rol:</strong> {roleLabel(invitation.role)}</p>
              </div>

              {differentSession && (
                <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  Şu an <strong>{session!.user!.email}</strong> olarak giriş yaptınız. Bu davet{" "}
                  <strong>{invitation.email}</strong> içindir; kabul edince bu hesaba geçeceksiniz.
                </p>
              )}

              {needsPassword ? (
                <div className="space-y-4">
                  <Field id="name" label="Ad Soyad" icon={<User className="h-4 w-4" />}>
                    <input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Adınız Soyadınız"
                      className={inputClass(true, false)}
                    />
                  </Field>

                  <Field
                    id="phone"
                    label="Telefon"
                    icon={<Phone className="h-4 w-4" />}
                    hint={
                      phone && !phoneValid
                        ? { text: "0 ile başlayan 11 haneli numara girin.", tone: "error" }
                        : undefined
                    }
                  >
                    <input
                      id="phone"
                      type="tel"
                      inputMode="numeric"
                      value={phone}
                      onChange={(e) => setPhone(formatTrPhone(e.target.value))}
                      placeholder="05xx xxx xx xx"
                      className={inputClass(true, false)}
                    />
                  </Field>

                  <Field
                    id="password"
                    label="Şifre"
                    icon={<Lock className="h-4 w-4" />}
                    rightSlot={
                      <ToggleEye shown={showPassword} onClick={() => setShowPassword((s) => !s)} />
                    }
                  >
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={inputClass(true, true)}
                    />
                  </Field>

                  {password && (
                    <div className="-mt-2">
                      <div className="flex h-1.5 gap-1">
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className={`h-full flex-1 rounded-full transition-colors ${
                              i < strength ? strengthColor : "bg-muted"
                            }`}
                          />
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] font-semibold text-muted-foreground">{strengthLabel}</p>
                      <ul className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
                        {passwordChecks.map((c) => (
                          <li
                            key={c.label}
                            className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                              c.ok ? "font-medium text-emerald-600" : "text-muted-foreground"
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
                  )}

                  <Field
                    id="confirm"
                    label="Şifre (Tekrar)"
                    icon={<Lock className="h-4 w-4" />}
                    rightSlot={
                      <ToggleEye shown={showConfirm} onClick={() => setShowConfirm((s) => !s)} />
                    }
                    hint={
                      confirmMismatch
                        ? { text: "Şifreler eşleşmiyor.", tone: "error" }
                        : undefined
                    }
                  >
                    <input
                      id="confirm"
                      type={showConfirm ? "text" : "password"}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      className={inputClass(true, true)}
                    />
                  </Field>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Bu e-posta ile bir hesabınız zaten var. Daveti kabul edince{" "}
                  <strong>{roleLabel(invitation.role)}</strong> yetkisi hesabınıza eklenir;
                  ardından mevcut şifrenizle giriş yapabilirsiniz.
                </p>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                onClick={accept}
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSubmitting ? "Katılım tamamlanıyor..." : "Firmaya Katıl"}
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function inputClass(hasIcon: boolean, hasRight: boolean): string {
  return `w-full rounded-md border border-input bg-background py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${
    hasIcon ? "pl-9" : "pl-3"
  } ${hasRight ? "pr-10" : "pr-3"}`
}

function Field({
  id,
  label,
  icon,
  rightSlot,
  hint,
  children,
}: {
  id: string
  label: string
  icon?: React.ReactNode
  rightSlot?: React.ReactNode
  hint?: { text: string; tone: "error" | "muted" }
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            {icon}
          </div>
        )}
        {children}
        {rightSlot}
      </div>
      {hint && (
        <p className={`text-[11px] ${hint.tone === "error" ? "text-red-600" : "text-muted-foreground"}`}>
          {hint.text}
        </p>
      )}
    </div>
  )
}

function ToggleEye({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={-1}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-primary"
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  )
}
