"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"

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
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/

    if (!formData.name.trim() || !formData.companyOrPersonName.trim() || !formData.phone.trim() || !formData.email.trim()) {
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
        description: "Şifre en az 8 karakter olmalı, en az bir büyük harf, bir rakam ve bir özel karakter içermelidir",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          companyOrPersonName: formData.companyOrPersonName.trim(),
          phone: formData.phone.trim(),
          email: formData.email.trim(),
          password: formData.password,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Kayıt başarısız")
      }

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
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-kobipo-border shadow-card p-8">
      <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-kobipo-navy">Kayıt Ol</h1>
      <p className="mb-6 text-sm text-kobipo-gray">Yeni bir hesap oluşturun ve hemen kullanmaya başlayın.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-1.5 block text-xs font-semibold text-kobipo-navy">Ad Soyad</label>
          <input
            id="name"
            type="text"
            placeholder="Adınız Soyadınız"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            disabled={isLoading}
            className="w-full rounded-lg border-[1.5px] border-kobipo-border bg-white px-3 py-2.5 text-sm text-kobipo-text placeholder:text-kobipo-gray/60 transition-colors focus:border-kobipo-blue focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="companyOrPersonName" className="mb-1.5 block text-xs font-semibold text-kobipo-navy">Firma/Şahıs Adı</label>
          <input
            id="companyOrPersonName"
            type="text"
            placeholder="Firma veya şahıs adı"
            value={formData.companyOrPersonName}
            onChange={(e) => setFormData({ ...formData, companyOrPersonName: e.target.value })}
            required
            disabled={isLoading}
            className="w-full rounded-lg border-[1.5px] border-kobipo-border bg-white px-3 py-2.5 text-sm text-kobipo-text placeholder:text-kobipo-gray/60 transition-colors focus:border-kobipo-blue focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="phone" className="mb-1.5 block text-xs font-semibold text-kobipo-navy">Telefon Numarası</label>
          <input
            id="phone"
            type="tel"
            placeholder="05xx xxx xx xx"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            required
            disabled={isLoading}
            className="w-full rounded-lg border-[1.5px] border-kobipo-border bg-white px-3 py-2.5 text-sm text-kobipo-text placeholder:text-kobipo-gray/60 transition-colors focus:border-kobipo-blue focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-kobipo-navy">E-posta</label>
          <input
            id="email"
            type="email"
            placeholder="ornek@email.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
            disabled={isLoading}
            className="w-full rounded-lg border-[1.5px] border-kobipo-border bg-white px-3 py-2.5 text-sm text-kobipo-text placeholder:text-kobipo-gray/60 transition-colors focus:border-kobipo-blue focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-kobipo-navy">Şifre</label>
          <input
            id="password"
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required
            disabled={isLoading}
            className="w-full rounded-lg border-[1.5px] border-kobipo-border bg-white px-3 py-2.5 text-sm text-kobipo-text placeholder:text-kobipo-gray/60 transition-colors focus:border-kobipo-blue focus:outline-none"
          />
          <p className="text-xs text-kobipo-gray">
            En az 8 karakter, bir buyuk harf, bir rakam ve bir ozel karakter icermelidir.
          </p>
        </div>
        <div>
          <label htmlFor="confirmPassword" className="mb-1.5 block text-xs font-semibold text-kobipo-navy">Şifre Tekrar</label>
          <input
            id="confirmPassword"
            type="password"
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            required
            disabled={isLoading}
            className="w-full rounded-lg border-[1.5px] border-kobipo-border bg-white px-3 py-2.5 text-sm text-kobipo-text placeholder:text-kobipo-gray/60 transition-colors focus:border-kobipo-blue focus:outline-none"
          />
        </div>
        <button type="submit" className="w-full mt-5 rounded-lg bg-kobipo-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-kobipo-mid" disabled={isLoading}>
          {isLoading ? "Kayıt yapılıyor..." : "Kayıt Ol"}
        </button>
        <button type="button" className="text-xs font-semibold text-kobipo-blue hover:text-kobipo-mid" onClick={() => router.push("/signin")}>
          Zaten hesabınız var mı? Giriş yapın
        </button>
      </form>
    </div>
  )
}
