"use client"

import Link from "next/link"
import { forwardRef, type ComponentProps } from "react"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { withCompanyHref } from "@/lib/company/href"

type CompanyLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: string }

/**
 * Aktif firma/şubeyi (`?company=`) otomatik taşıyan panel linki. Panel içi gezinmelerde
 * düz `<Link>` yerine bunu kullanın: param'sız link bağlamı düşürür ve kullanıcı
 * sessizce başka firmanın verisine geçer. Bkz. [[lib/company/href.ts]]
 *
 * DİKKAT — sayfa, AKTİF seçimden farklı bir firmanın verisini gösteriyorsa (ör. şube
 * detayı: seçim ana firmadır ama ekranda şubenin rakamları vardır) bu bileşen YANLIŞ
 * firmaya götürür. O durumda `withCompanyHref(href, o firmanın id'si)` ile düz `<Link>`
 * kullanın.
 *
 * forwardRef ŞART: Radix menü öğeleri (`DropdownMenuItem asChild`) odak yönetimi için
 * çocuğa ref bağlar; ref iletilmezse React uyarır ve klavye navigasyonu bozulur.
 */
export const CompanyLink = forwardRef<HTMLAnchorElement, CompanyLinkProps>(
  function CompanyLink({ href, ...rest }, ref) {
    const { selectedCompany } = useDashboardCompany()
    const companyParam = selectedCompany?.slug ?? selectedCompany?.id ?? null
    return <Link ref={ref} href={withCompanyHref(href, companyParam)} {...rest} />
  }
)
