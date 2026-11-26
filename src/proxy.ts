import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((request) => {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login") return NextResponse.next();
  if (!request.auth?.user) {
    const target = new URL("/login", request.url);
    target.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(target);
  }
  if ((pathname === "/usuarios" || pathname.startsWith("/usuarios/")) && request.auth.user.role !== "ADMIN") return NextResponse.redirect(new URL("/acesso-negado", request.url));
  return NextResponse.next();
});

export const config = { matcher: ["/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"] };
