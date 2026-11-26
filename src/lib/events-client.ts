import { handleAuthenticationResponse } from "@/lib/auth-client";

export class EventsApiError extends Error {
  constructor(message: string, public fieldErrors: Record<string, string> = {}, public status = 400) {
    super(message);
    this.name = "EventsApiError";
  }
}

export async function eventsRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...options.headers } });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new EventsApiError("Não foi possível conectar à agenda. Verifique sua conexão e tente novamente.", {}, 0);
  }
  handleAuthenticationResponse(response);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new EventsApiError(data?.error ?? "Não foi possível concluir esta operação.", data?.fieldErrors ?? {}, response.status);
  return data as T;
}
