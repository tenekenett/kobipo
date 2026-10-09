import { NextResponse } from "next/server"
import { kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { muhasebeOzeti } from "@/lib/muhasebe/ozet.server"

export const dynamic = "force-dynamic"

/** Muhasebe özeti — GET ?companyId → yapılacaklar + bu yılın rakamları (lib/muhasebe/ozet.server.ts). */
export const GET = muhasebeUcu(async (request: Request) => {
  const { ctx } = await muhasebeGirisi(new URL(request.url).searchParams.get("companyId"))
  return NextResponse.json(await muhasebeOzeti(kuruluDefter(ctx)))
})
