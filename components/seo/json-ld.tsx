type JsonLdData = Record<string, unknown>

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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }}
        />
      ))}
    </>
  )
}
