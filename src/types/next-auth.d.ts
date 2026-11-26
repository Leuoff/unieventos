import type { AuthUser } from "@/types/auth";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session { user: AuthUser }
  interface User { appSessionToken?: string }
}
declare module "next-auth/jwt" {
  interface JWT { appSessionToken?: string; authenticatedUser?: AuthUser }
}
