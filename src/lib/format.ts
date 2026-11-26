const locale = "pt-BR";
const timeZone = "America/Sao_Paulo";

function parseDate(value: string) {
  // Noon in São Paulo keeps date-only values on their intended calendar day.
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value);
}

export function formatDate(iso: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
    timeZone,
  }).format(parseDate(iso));
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatUnits(quantity: number) {
  return `${formatNumber(quantity)} ${quantity === 1 ? "unidade" : "unidades"}`;
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(parseDate(iso));
}

export function matchesSearch(search: string, ...values: (string | undefined)[]) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(locale);
  return normalize(values.filter(Boolean).join(" ")).includes(normalize(search.trim()));
}
