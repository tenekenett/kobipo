export type BlogPost = {
  slug: string
  title: string
  excerpt: string
  category: string
  readTime: string
  date: string
  author: string
  coverTone: "blue" | "navy" | "green"
  content: string[]
}

export const blogPosts: BlogPost[] = [
  {
    slug: "kobi-icin-nakit-akisi-yonetimi",
    title: "KOBI'ler icin nakit akisina guc katan 7 adim",
    excerpt: "Gunluk tahsilat ve odeme dengesini bozmadan, surdurulebilir buyume icin uygulanabilir nakit akisi pratikleri.",
    category: "Finans Yonetimi",
    readTime: "6 dk",
    date: "2026-04-02",
    author: "Kobipo Ekibi",
    coverTone: "blue",
    content: [
      "Nakit akisi, satis rakamindan daha kritik bir metrik olabilir. Karlilik gorunen donemlerde bile tahsilat-vade dengesizligi sirketi zorlayabilir.",
      "Ilk adim, haftalik bazda gerceklesen veriye dayali bir nakit akisi tablosu olusturmaktir. Planlanan yerine gerceklesen veriyi izlemek karar kalitesini artirir.",
      "Kritik musteri grubunda otomatik hatirlatma, erken odeme indirimi ve tedarikci vade optimizasyonu birlikte kullanildiginda nakit sikisikligi belirgin sekilde azalir.",
    ],
  },
  {
    slug: "e-fatura-surecinde-5-yaygin-hata",
    title: "E-fatura surecinde yapilan 5 yaygin hata",
    excerpt: "GIB sureclerinde sik karsilasilan operasyonel hatalari ve bu hatalarin pratik cozumlerini derledik.",
    category: "E-Donusum",
    readTime: "5 dk",
    date: "2026-03-24",
    author: "Operasyon Takimi",
    coverTone: "navy",
    content: [
      "E-faturada en yaygin sorunlar; eksik unvan, yanlis VKN/TCKN, hatali vergi orani ve belge tipi seciminden kaynaklanir.",
      "Standart bir kontrol listesi ve dogru sablon yapisi kullanmak red ve iade oranlarini ciddi bicimde dusurur.",
      "Belge olusurken cari kart ve urun karti bilgisinin guncel olmasi kritik onemdedir; bu nedenle veri bakimi duzenli hale getirilmelidir.",
    ],
  },
  {
    slug: "stokta-kritik-seviye-alarmi-nasil-kurulur",
    title: "Stokta kritik seviye alarmi nasil kurulur?",
    excerpt: "Siparis kacirmadan ve fazla stok tasimadan surdurulebilir seviyeler icin alarm tasarimi.",
    category: "Stok",
    readTime: "4 dk",
    date: "2026-03-10",
    author: "Urun Ekibi",
    coverTone: "green",
    content: [
      "Kritik stok seviyesi belirlenirken yalnizca satis hizi degil, tedarik suresi ve kampanya etkisi de hesaba katilmalidir.",
      "ABC analizi ile yuksek etkili urunleri ayrismak, alarm sisteminin dogruluk oranini artirir.",
      "Alarm sisteminin amaci sadece bildirim degil, dogru zamanda dogru satin alma aksiyonunu tetiklemektir.",
    ],
  },
  {
    slug: "kobi-raporlama-icin-yonetim-paneli-rehberi",
    title: "KOBI raporlama icin yonetim paneli rehberi",
    excerpt: "Hangi metrikler her gun, hangileri haftalik izlenmeli? Sade ve karar odakli panel cercevesi.",
    category: "Raporlama",
    readTime: "7 dk",
    date: "2026-02-28",
    author: "Kobipo Ekibi",
    coverTone: "blue",
    content: [
      "Gunluk panelde tahsilat, acik fatura ve stok alarmi gibi operasyonel metrikler; haftalik panelde marj ve kategori performansi izlenmelidir.",
      "Metrik sayisini artirmak yerine karar aldiran az sayida metrik secmek daha saglikli sonuclar verir.",
      "Her metrik icin hedef aralik tanimlamak, paneli pasif gorselden aktif karar destek aracina donusturur.",
    ],
  },
  {
    slug: "musteri-tedarikci-cari-bakiye-disiplini",
    title: "Musteri ve tedarikci cari bakiye disiplini",
    excerpt: "Cari hesaplarda duzenli mutabakat ve limit yonetimi ile finansal riskleri erken kontrol altina alin.",
    category: "Cari Yonetimi",
    readTime: "5 dk",
    date: "2026-02-15",
    author: "Finans Takimi",
    coverTone: "navy",
    content: [
      "Cari yonetiminde temel hedef; gorunurluk, hiz ve disiplin uclulugunu kurmaktir.",
      "Riskli musteriler icin dinamik limit ve vade kontrolu, tedarikci tarafinda ise merkezi odeme takvimi kritik fayda saglar.",
      "Aylik mutabakat rutini standart hale geldiginde surpriz borc-alacak farklari minimuma iner.",
    ],
  },
  {
    slug: "kobi-dijital-donusumde-ilk-90-gun",
    title: "KOBI dijital donusumunde ilk 90 gun plani",
    excerpt: "Surecleri bozmadan dijital donusume gecis icin 3 fazli pratik yol haritasi.",
    category: "Dijital Donusum",
    readTime: "8 dk",
    date: "2026-01-30",
    author: "Danismanlik Ekibi",
    coverTone: "green",
    content: [
      "Ilk 30 gunde veri temizligi ve surec haritasi, ikinci 30 gunde otomasyon, son 30 gunde raporlama disiplini kurulmalidir.",
      "Degisim surecinde ekip adaptasyonu teknik altyapi kadar onemlidir; net rol dagilimi ve kisa egitimler gereklidir.",
      "Basari gostergeleri en basta tanimlandiginda donusumun yatirim geri donusu olculebilir hale gelir.",
    ],
  },
]

export const blogCategories = ["Tumu", ...Array.from(new Set(blogPosts.map((post) => post.category)))]

export function getBlogPostBySlug(slug: string) {
  return blogPosts.find((post) => post.slug === slug)
}
