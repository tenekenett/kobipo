type JsonLdData = Record<string, unknown>

// Ters bölü (\) — kaynak kodda kaçış belirsizliği yaşamamak için kod noktasından üretilir.
const BACKSLASH = String.fromCharCode(92)

/**
 * JSON-LD'yi <script> içine GÜVENLİ göm. JSON çıktısındaki `<`, `>`, `&` karakterleri
 * unicode kaçışına (< gibi) çevrilir; böylece kullanıcı üretimli içerik (ör. blog
 * başlığı/özeti) `</script>` yazıp bloğu kırarak XSS yapamaz. Kaçışlar JSON'da geçerlidir
 * ve tüketiciler (arama motorları) tarafından aynen çözülür → SEO/görünüm birebir korunur.
 * Not: bu blok `application/ld+json` (veri) olduğundan JS olarak yürütülmez; tek risk HTML
 * kırılımıdır, onu da yukarıdaki üç karakterin kaçışı tümüyle kapatır.
 */
function serializeJsonLd(item: JsonLdData): string {
  return JSON.stringify(item).replace(
    /[<>&]/g,
    (c) => BACKSLASH + "u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  )
}

/**
 * schema.org JSON-LD bloğu. Tek nesne ya da nesne dizisi kabul eder; her biri ayrı
 * <script type="application/ld+json"> olarak render edilir. Server-render edildiği için
 * ilk HTML çıktısında yer alır (arama motorları tarafından okunur).
 */
export function JsonLd({ data }: { data: JsonLdData | JsonLdData[] }) {
  const items = Array.isArray(data) ? data : [data]
  return (
    <>
      {items.map((item, i) => (
        <script
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }}
        />
      ))}
    </>
  )
}
