export function handleAuthenticationResponse(response: Response) {
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("unieventos:session-expired"));
  }
}

export async function authRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...options.headers } });
  handleAuthenticationResponse(response);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Não foi possível concluir a operação.");
  return data as T;
}

export function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return "/";
  return value.startsWith("/login") ? "/" : value;
}
