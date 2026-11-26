import { z } from "zod";
import { permissionLabels, roleLabels } from "@/types/auth";

const INSTITUTIONAL_DOMAIN = "unisalesiano.com.br";
// Configuration may narrow access, but cannot silently authorize another domain.
export const institutionalDomains = () => {
  const configured = process.env.AUTH_EMAIL_DOMAINS;
  if (configured === undefined) return [INSTITUTIONAL_DOMAIN];
  return configured.split(",").map((domain) => domain.trim().toLowerCase()).filter((domain) => domain === INSTITUTIONAL_DOMAIN);
};
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const isInstitutionalEmail = (value: string) => z.email().safeParse(value).success && institutionalDomains().includes(value.split("@")[1]);
export const passwordSchema = z.string().min(12, "A senha deve ter pelo menos 12 caracteres.").max(128, "A senha deve ter no máximo 128 caracteres.");
const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome completo.").max(120),
  email: z.email("Informe um e-mail válido.").transform(normalizeEmail).refine(isInstitutionalEmail, "Use um e-mail institucional autorizado."),
  role: z.enum(Object.keys(roleLabels) as [keyof typeof roleLabels, ...Array<keyof typeof roleLabels>]),
  active: z.boolean(),
  permissions: z.array(z.enum(Object.keys(permissionLabels) as [keyof typeof permissionLabels, ...Array<keyof typeof permissionLabels>])).max(20)
    .refine((items) => new Set(items).size === items.length, "Não repita permissões.")
    .refine((items) => !items.includes("USERS_MANAGE"), "A administração de usuários é exclusiva do perfil ADMIN."),
  password: passwordSchema.optional(),
  version: z.number().int().positive().optional(),
}).strict();
export const createUserSchema = schema.refine((input) => !!input.password, { path: ["password"], message: "Defina uma senha inicial segura." });
export const updateUserSchema = schema.refine((input) => !!input.version, { path: ["version"], message: "Atualize a página antes de alterar o usuário." });
