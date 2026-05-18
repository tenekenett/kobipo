import { NextResponse } from 'next/server';
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { ensureCompanyAccess } from "@/lib/middleware/company";
import { decryptSecret } from "@/lib/crypto/secrets";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { companyId } = body;
    let { username, password, apiUrl } = body;

    // Şifre boşsa veya placeholder *** ise DB'deki kayıtlı şifreyi kullan.
    // username de aynı şekilde — formdan gelmediyse DB'den al.
    const passwordIsPlaceholder = !password || password === "***";
    const usernameIsMissing = !username;

    if ((passwordIsPlaceholder || usernameIsMissing) && companyId) {
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
    }

    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: "Kullanıcı adı veya şifre eksik. Formu doldurun ya da firmaya kaydedin." },
        { status: 400 }
      );
    }

    const baseUrl = apiUrl || "https://edocumentapi.mytest.tr";

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
    return NextResponse.json(
      { success: false, message: message || "Mysoft sunucularına ulaşılamadı." },
      { status: 500 }
    );
  }
}