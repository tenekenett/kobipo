"use client"

import { useMemo } from "react"
import { Label } from "@/components/ui/label"
import { SearchSelect } from "@/components/ui/search-select"
import { TURKISH_CITIES } from "@/lib/data/turkish-cities"
import {
  TURKISH_PROVINCE_DISTRICTS,
  PROVINCE_DISTRICT_SEPARATOR as SEP,
} from "@/lib/data/turkish-districts"

/**
 * İl/ilçe SEÇİCİ — adres alanlarının tek kaynağı. Serbest metin kabul edilmez:
 * yazılan şey yalnızca listeyi süzer, değer her zaman sabit listeden gelir.
 * Böylece "Istanbul / İstanbul / ist" gibi varyantlar veriye girmez ve e-belgeye
 * geçen il/ilçe adları GİB'in tanıdığı yazımda kalır.
 *
 * İki kural bu bileşende toplanmıştır:
 *  - İlçe <option> değeri `il||ilçe` biçiminde KODLANIR. Aynı isimli ilçeler
 *    ("Merkez" 30+ ilde var) yalnız isimle ile bağlanamaz; kodlanmış değer
 *    sayesinde ilçe seçmek ili de otomatik doldurur.
 *  - İl değişince mevcut ilçe yeni ile ait değilse SIFIRLANIR — aksi halde
 *    "Ankara / Kadıköy" gibi tutarsız çift kaydedilebilirdi.
 *
 * Listede olmayan (eski serbest metinle girilmiş) bir değer varsa seçenek olarak
 * "(kayıtlı)" etiketiyle korunur; kaydı açan kullanıcı istemeden değiştirmesin.
 */
type CityDistrictSelectProps = {
  city: string
  district: string
  /** İl ve ilçe BİRLİKTE döner: ilçe seçimi ili de değiştirebilir. */
  onChange: (next: { city: string; district: string }) => void
  /** `${idPrefix}-city` / `${idPrefix}-district` id'lerini üretir (Label eşleşmesi). */
  idPrefix: string
  disabled?: boolean
  /** Etiketleri bileşen bassın mı? (Kapalıysa yalnız iki seçici çıkar.) */
  withLabels?: boolean
  cityLabel?: string
  districtLabel?: string
  cityPlaceholder?: string
  districtPlaceholder?: string
  /** İl kutusuna eklenecek sınıf — 412/doğrulama hatasında kırmızıya boyamak için. */
  cityClassName?: string
  districtClassName?: string
  /** Alan bloğunun sınıfı (etiket + seçici arası boşluk). */
  fieldClassName?: string
  /**
   * Verilirse iki alan bu sınıfa sahip bir kaba sarılır; verilmezse KAPSIZ
   * basılır (fragment) ve dıştaki grid hücreleri doğrudan yerleştirir.
   */
  containerClassName?: string
}

export function CityDistrictSelect({
  city,
  district,
  onChange,
  idPrefix,
  disabled,
  withLabels = true,
  cityLabel = "İl",
  districtLabel = "İlçe",
  cityPlaceholder = "İl seçin veya arayın…",
  districtPlaceholder = "İlçe seçin veya arayın…",
  cityClassName,
  districtClassName,
  fieldClassName = "space-y-1.5",
  containerClassName,
}: CityDistrictSelectProps) {
  const cityInList = !city || TURKISH_CITIES.includes(city as (typeof TURKISH_CITIES)[number])
  // useMemo: liste referansı sabit kalsın, aşağıdaki memo her render'da yeniden koşmasın.
  const districtsForCity = useMemo(() => (city ? TURKISH_PROVINCE_DISTRICTS[city] ?? [] : null), [city])
  const districtInList = Boolean(districtsForCity?.includes(district))
  const districtValue = district ? `${city}${SEP}${district}` : ""

  const cityOptions = useMemo(() => {
    const opts: { id: string; name: string }[] = []
    if (city && !cityInList) opts.push({ id: city, name: `${city} (kayıtlı)` })
    for (const c of TURKISH_CITIES) opts.push({ id: c, name: c })
    return opts
  }, [city, cityInList])

  const districtOptions = useMemo(() => {
    const opts: { id: string; name: string }[] = []
    if (district && !districtInList) opts.push({ id: districtValue, name: `${district} (kayıtlı)` })
    if (districtsForCity) {
      for (const d of districtsForCity) opts.push({ id: `${city}${SEP}${d}`, name: d })
    } else {
      // İl seçilmemişse tüm ilçeler "İlçe — İl" biçiminde listelenir: kullanıcı
      // yalnız ilçeyi biliyorsa da ilerleyebilsin (seçim ili de dolduracak).
      for (const [province, districts] of Object.entries(TURKISH_PROVINCE_DISTRICTS)) {
        for (const d of districts) opts.push({ id: `${province}${SEP}${d}`, name: `${d} — ${province}` })
      }
    }
    return opts
  }, [city, district, districtInList, districtValue, districtsForCity])

  const handleCityChange = (nextCity: string) => {
    const districts = TURKISH_PROVINCE_DISTRICTS[nextCity] ?? []
    const keepDistrict = district && districts.includes(district)
    onChange({ city: nextCity, district: keepDistrict ? district : "" })
  }

  const handleDistrictChange = (encoded: string) => {
    if (!encoded) {
      onChange({ city, district: "" })
      return
    }
    const [province, nextDistrict] = encoded.split(SEP)
    onChange({ city: province || city, district: nextDistrict || "" })
  }

  const fields = (
    <>
      <div className={fieldClassName}>
        {withLabels && <Label htmlFor={`${idPrefix}-city`}>{cityLabel}</Label>}
        <SearchSelect
          id={`${idPrefix}-city`}
          options={cityOptions}
          value={city}
          onChange={handleCityChange}
          placeholder={cityPlaceholder}
          className={cityClassName}
          disabled={disabled}
          allowClear
        />
      </div>
      <div className={fieldClassName}>
        {withLabels && <Label htmlFor={`${idPrefix}-district`}>{districtLabel}</Label>}
        <SearchSelect
          id={`${idPrefix}-district`}
          options={districtOptions}
          value={districtValue}
          onChange={handleDistrictChange}
          placeholder={districtPlaceholder}
          className={districtClassName}
          disabled={disabled}
          allowClear
        />
      </div>
    </>
  )

  return containerClassName ? <div className={containerClassName}>{fields}</div> : fields
}
