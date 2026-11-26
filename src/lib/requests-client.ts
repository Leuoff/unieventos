import { handleAuthenticationResponse } from "@/lib/auth-client";

export class RequestsApiError extends Error {
  constructor(message: string, public fieldErrors: Record<string, string> = {}, public status = 400) {
    super(message);
    this.name = "RequestsApiError";
  }
}

export async function requestsRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...options.headers } });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new RequestsApiError("Não foi possível conectar às solicitações. Verifique sua conexão e tente novamente.", {}, 0);
  }
  handleAuthenticationResponse(response);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new RequestsApiError(data?.error ?? "Não foi possível concluir esta operação.", data?.fieldErrors ?? {}, response.status);
  return data as T;
}
