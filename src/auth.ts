import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authenticateCredentials, getSessionUser, revokeSession, SESSION_MAX_AGE } from "@/server/auth-core";

const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32 || /SUBSTITUA|EXAMPLE|CHANGE.?ME/i.test(secret)) throw new Error("Configure um AUTH_SECRET aleatório exclusivo com npm run auth:setup antes de iniciar a aplicação.");

function secureCookies() {
  const configured = process.env.AUTH_URL;
  if (!configured) return true;
  try {
    const url = new URL(configured);
    if (url.protocol === "https:") return true;
    // HTTP is permitted only for an explicitly configured local development URL.
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  } catch { /* Invalid deployment configuration fails closed. */ }
  throw new Error("AUTH_URL deve usar HTTPS; HTTP é permitido somente em localhost ou 127.0.0.1.");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret,
  trustHost: true,
  useSecureCookies: secureCookies(),
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  jwt: { maxAge: SESSION_MAX_AGE },
  providers: [Credentials({
    credentials: { email: { label: "E-mail institucional", type: "email" }, password: { label: "Senha", type: "password" } },
    async authorize(credentials) {
      if (typeof credentials.email !== "string" || typeof credentials.password !== "string") return null;
      const authenticated = await authenticateCredentials(credentials.email, credentials.password);
      if (!authenticated) return null;
      return { id: authenticated.user.id, name: authenticated.user.name, email: authenticated.user.email, appSessionToken: authenticated.sessionToken };
    },
  })],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.appSessionToken) token.appSessionToken = user.appSessionToken;
      if (!token.appSessionToken) return null;
      // Ignore client-side session updates. Roles and grants are always loaded from PostgreSQL.
      const authenticatedUser = await getSessionUser(token.appSessionToken);
      if (!authenticatedUser) return null;
      token.authenticatedUser = authenticatedUser;
      return token;
    },
    async session({ session, token }) {
      // The raw token and password hash never leave the server callback.
      if (token.authenticatedUser) session.user = { ...session.user, ...token.authenticatedUser };
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/") && !url.startsWith("//")) return `${baseUrl}${url}`;
      try { if (new URL(url).origin === new URL(baseUrl).origin) return url; } catch { /* Reject invalid redirects. */ }
      return baseUrl;
    },
  },
  events: {
    async signOut(message) {
      if ("token" in message && message.token?.appSessionToken) await revokeSession(message.token.appSessionToken);
    },
  },
  logger: {
    // Avoid logging credentials, callback bodies, database URLs or token contents.
    error() { console.error("Falha no serviço de autenticação. Consulte a disponibilidade e configuração do serviço."); },
    warn(code) { if (code !== "debug-enabled") console.warn(`Auth.js: ${code}`); },
  },
});
