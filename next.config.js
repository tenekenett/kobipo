/** @type {import('next').NextConfig} */
// Vercel sets VERCEL_URL at build time; NextAuth needs NEXTAUTH_URL in production when not set in dashboard.
const vercelUrl = process.env.VERCEL_URL
const nextAuthUrl = process.env.NEXTAUTH_URL

const nextConfig = {
  // Server Actions are available by default in Next.js 16+
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },
  // Keep Prisma engine outside of the server bundler so it cold-starts faster.
  //
  // pdfmake da harici: CommonJS ve fontlarını çalışma anında fs ile okuyor;
  // sunucu paketine gömülürse font yolları bozuluyor.
  serverExternalPackages: ["@prisma/client", "prisma", "pdfmake"],
  // Bundled örnek XSLT şablonları çalışma anında fs ile okunuyor; Vercel'in
  // serverless fonksiyon paketine dahil edilmeleri için trace'e ekliyoruz.
  //
  // Kapsam GÖNDERİM YOLUNU da içerir (invoices/**), yalnız şablon ekranını değil:
  // taban XSLT'yi okuyan ikinci yer, fatura Mysoft'a giderken kayıtlı tasarımın
  // bayatlığına bakan otomatik tazelemedir
  // ([[lib/integrations/e-invoice/template-refresh.ts]]).
  //
  // DÜRÜST NOT: Next'in izleyicisi bu dosyaları zaten kendiliğinden buluyor —
  // `SAMPLES_DIR` sabit parçalardan kurulduğu için statik analiz yolu görebiliyor
  // ve .nft.json'lar dar kapsamla da iki .xslt'yi invoices/** paketine koyuyordu
  // (ölçüldü). Yani bu satır bir hatayı DÜZELTMİYOR; izleyicinin sezgisine
  // güvenmemek için konmuş açık bir garanti. Bedeli o alt ağaçtaki fonksiyonlara
  // ~380 KB; karşılığı, sezgi bir gün kaybolursa ortaya çıkacak arızanın sessiz
  // ve müşteriye görünür olması (belgeler eski tasarımla basılır).
  outputFileTracingIncludes: {
    "/api/e-donusum/**": ["./lib/integrations/e-invoice/sample-templates/**"],
    // PDF fontları fs ile okunuyor (lib/pdf/doc/font.ts); Next'in izleyicisi
    // dinamik yolu göremediği için fonksiyon paketine açıkça eklenir.
    "/api/**": ["./node_modules/dejavu-fonts-ttf/ttf/**", "./public/fonts/**"],
  },
  env: {
    ...(!nextAuthUrl && vercelUrl ? { NEXTAUTH_URL: `https://${vercelUrl}` } : {}),
  },
  // Güvenlik başlıkları. 2026-09-18 taramasına kadar HİÇ yoktu: panel başka sitede
  // iframe'e alınabiliyor (clickjacking), tarayıcı MIME tahmini açık, Referer tam
  // URL'yi (`?company=<id>` dahil) dış sitelere taşıyordu.
  //
  // Bilerek eklenmeyen: Content-Security-Policy. Next inline script'leri, PayTR
  // iframe'i, reCAPTCHA, Google Fonts ve pdfmake blob URL'leri için nonce/allowlist
  // çalışması ister; körlemesine eklenirse ödeme ekranı sessizce kırılır. Önce
  // `Content-Security-Policy-Report-Only` ile ölçülmeli.
  //
  // `frame-ancestors` yerine X-Frame-Options SAMEORIGIN: kendi önizleme iframe'leri
  // (fatura/fiş tasarımı, PDF) aynı origin'den yüklenir, dış gömme yok.
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // `payment` kısıtlanmaz: PayTR iframe'i (www.paytr.com) kendi ödeme akışını yürütür.
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
      // Vercel özel alan adlarında HSTS'i kendisi eklemez; 6 ay, alt alanlar dahil.
      { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
    ]
    return [{ source: "/:path*", headers: security }]
  },
}

module.exports = nextConfig

