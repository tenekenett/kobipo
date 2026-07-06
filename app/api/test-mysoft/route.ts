import { NextResponse } from 'next/server';
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { ensureCompanyAccess } from "@/lib/middleware/company";
import { resolveCompanyId } from "@/lib/company/resolve-company";
import { decryptSecret } from "@/lib/crypto/secrets";
import { resolveMysoftBaseUrl } from "@/lib/integrations/e-invoice/constants";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    let { username, password, apiUrl } = body;

    // Dashboard URL'leri firmayı slug ile taşıyor (?company=<slug>). companyId slug
    // gelirse ensureCompanyAccess/prisma sorguları eşleşmez. Önce cuid'e çeviriyoruz —
    // ama best-effort: DB'ye ulaşılamıyorsa ham değeri koruyup devam ediyoruz ki tüm
    // kimlikler elle girildiğinde test DB'siz de çalışsın. [[resolve-company.ts]]
    let companyId: string | null = body.companyId ?? null;
    if (companyId) {
      try {
        companyId = (await resolveCompanyId(companyId)) ?? companyId;
      } catch (resolveError) {
        console.error("test-mysoft resolveCompanyId error:", resolveError);
      }
    }

    // Şifre boşsa veya placeholder *** ise DB'deki kayıtlı şifreyi kullan.
    // username de aynı şekilde — formdan gelmediyse DB'den al.
    const passwordIsPlaceholder = !password || password === "***";
    const usernameIsMissing = !username;

    // apiUrl body'de gelmediyse de firmadan yüklemeliyiz: aksi halde kullanıcı
    // forma YENİ canlı kimlik girip test ettiğinde apiUrl undefined kalır ve
    // istek yanlışlıkla TEST ortamına gider.
    if ((passwordIsPlaceholder || usernameIsMissing || !apiUrl) && companyId) {
      try {
        await ensureCompanyAccess(companyId);
        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: {
            eDonusumApiUsername: true,
            eDonusumApiPassword: true,
            eDonusumApiUrl: true,
          },
        });
        if (usernameIsMissing) username = company?.eDonusumApiUsername || "";
        if (passwordIsPlaceholder && company?.eDonusumApiPassword) {
          try {
            password = decryptSecret(company.eDonusumApiPassword);
          } catch {
            return NextResponse.json(
              { success: false, message: "Kayıtlı şifre çözülemedi. Lütfen şifreyi tekrar girip kaydedin." },
              { status: 400 }
            );
          }
        }
        if (!apiUrl) apiUrl = company?.eDonusumApiUrl || undefined;
      } catch (dbError: any) {
        const dbMessage = String(dbError?.message || "");
        if (dbMessage.toLowerCase().includes("access denied")) {
          return NextResponse.json({ success: false, message: "Access denied" }, { status: 403 });
        }
        // P1001/P2024 vb. — kayıtlı kimlikler DB'den okunamadı. Ham hatayı sızdırma.
        console.error("test-mysoft company lookup error:", dbError);
        return NextResponse.json(
          {
            success: false,
            message:
              "Kayıtlı bilgiler okunamadı — veritabanına ulaşılamıyor. Bağlantı düzelince tekrar deneyin ya da API şifresini elle girip test edin.",
          },
          { status: 503 }
        );
      }
    }

    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: "Kullanıcı adı veya şifre eksik. Formu doldurun ya da firmaya kaydedin." },
        { status: 400 }
      );
    }

    const baseUrl = resolveMysoftBaseUrl(apiUrl);

    const persistResult = async (success: boolean) => {
      if (!companyId) return
      try {
        await prisma.company.update({
          where: { id: companyId },
          data: {
            eDonusumLastTestedAt: new Date(),
            eDonusumLastTestSuccess: success,
          },
        });
      } catch (persistError) {
        console.error("Failed to persist e-donusum test result:", persistError);
      }
    };

    const res = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username,
        password,
        grant_type: "password",
      }),
    });

    const data = await res.json();

    if (data.access_token) {
      await persistResult(true);
      return NextResponse.json({ success: true });
    }
    await persistResult(false);
    return NextResponse.json(
      { success: false, message: data.error_description || data.error || "Kullanıcı adı veya şifre hatalı!" },
      { status: 400 }
    );
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : "";
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ success: false, message: "Access denied" }, { status: 403 });
    }
    console.error("test-mysoft error:", error);
    // Ham Prisma/Turbopack/stack mesajını kullanıcıya gösterme — sabit, anlaşılır bir metin dön.
    return NextResponse.json(
      { success: false, message: "Bağlantı test edilemedi. Lütfen bir süre sonra tekrar deneyin." },
      { status: 500 }
    );
  }
}