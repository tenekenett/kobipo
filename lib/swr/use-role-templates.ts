"use client"

import { useMemo } from "react"
import useSWR from "swr"
import { jsonFetcher } from "./fetcher"
import { DEFAULT_ROLE_TEMPLATES, toRoleTemplate, type RoleTemplate } from "@/lib/nav/role-templates"

/**
 * Hazır rol kalıpları — Rol Yetkileri ekranı ve rol düzenleme diyaloğu için.
 *
 * Katalog GENEL olduğundan anahtar firmaya bağlı değil: aynı yanıt tüm firmalar için
 * geçerli ve SWR önbelleği ekranlar arasında paylaşılıyor (kalıplar iki yerde
 * gösteriliyor, ikisi de aynı isteği tetiklemesin).
 *
 * İstek DÜŞERSE kodda gömülü yedeğe düşeriz. Ekranın kalıp bölümünün boşalması
 * "kalıp yok" gibi okunur ve kullanıcıyı her rolü sıfırdan tanımlamaya iter; tek bir
 * ağ hatası bunu hak etmiyor.
 */
export function useRoleTemplates() {
  const { data, error, isLoading, mutate } = useSWR<unknown[]>(
    "/api/company/role-templates",
    jsonFetcher
  )
  const templates = useMemo<RoleTemplate[]>(() => {
    if (!Array.isArray(data)) return error ? DEFAULT_ROLE_TEMPLATES : []
    return data.map((row) => toRoleTemplate(row as Parameters<typeof toRoleTemplate>[0]))
  }, [data, error])
  return { templates, isLoading, error, mutate }
}
