import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <nav className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xl">M</span>
            </div>
            <span className="text-white font-semibold text-xl">Muhasebe</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/signin">
              <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-slate-700">
                Giriş Yap
              </Button>
            </Link>
            <Link href="/signup">
              <Button className="bg-emerald-500 hover:bg-emerald-600 text-white">
                Ücretsiz Başla
              </Button>
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <main className="container mx-auto px-4 py-20">
        <div className="text-center max-w-4xl mx-auto">
          <div className="inline-block mb-6 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <span className="text-emerald-400 text-sm font-medium">✨ Yeni nesil ön muhasebe çözümü</span>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
            İşletmenizi
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400"> Dijitalleştirin</span>
          </h1>
          
          <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto">
            Cari hesaplar, stok takibi, e-fatura ve finansal raporlarınızı 
            tek platformda yönetin. Bulut tabanlı, güvenli ve kolay kullanımlı.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link href="/signup">
              <Button size="lg" className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-6 text-lg">
                Ücretsiz Hesap Oluştur
                <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Button>
            </Link>
            <Link href="/signin">
              <Button size="lg" variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-800 px-8 py-6 text-lg">
                Giriş Yap
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-8 max-w-xl mx-auto mb-20">
            <div className="text-center">
              <div className="text-3xl font-bold text-white">%100</div>
              <div className="text-slate-500 text-sm">Bulut Tabanlı</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-white">7/24</div>
              <div className="text-slate-500 text-sm">Erişilebilir</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-white">SSL</div>
              <div className="text-slate-500 text-sm">Güvenli</div>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          <FeatureCard 
            icon="👥"
            title="Cari Hesaplar"
            description="Müşteri ve tedarikçi takibi, bakiye kontrolü, ekstre raporları"
          />
          <FeatureCard 
            icon="📦"
            title="Stok Yönetimi"
            description="Ürün ve hizmet takibi, stok hareketleri, kritik stok uyarıları"
          />
          <FeatureCard 
            icon="📄"
            title="E-Fatura"
            description="E-Fatura ve E-Arşiv oluşturma, GİB entegrasyonu"
          />
          <FeatureCard 
            icon="📊"
            title="Raporlar"
            description="Gelir-gider analizi, KDV raporları, finansal tablolar"
          />
        </div>

        {/* CTA Section */}
        <div className="mt-24 text-center">
          <div className="bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 rounded-2xl p-12 max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold text-white mb-4">
              Hemen Başlayın
            </h2>
            <p className="text-slate-400 mb-8">
              Kredi kartı gerektirmez. İlk ay ücretsiz deneyin.
            </p>
            <Link href="/signup">
              <Button size="lg" className="bg-emerald-500 hover:bg-emerald-600 text-white px-8">
                Ücretsiz Kayıt Ol
              </Button>
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-12 mt-20 border-t border-slate-800">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">M</span>
            </div>
            <span className="text-slate-400">Muhasebe SaaS</span>
          </div>
          <div className="text-slate-500 text-sm">
            © 2024 Muhasebe SaaS. Tüm hakları saklıdır.
          </div>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 hover:border-emerald-500/50 transition-colors">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-slate-400 text-sm">{description}</p>
    </div>
  )
}
