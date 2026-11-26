import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const file = fileURLToPath(new URL("../.env", import.meta.url));
let contents = "";
try { contents = await readFile(file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const current = parse(contents);
const replace = (name, value) => {
  const expression = new RegExp(`^${name}=.*$`, "m");
  contents = expression.test(contents) ? contents.replace(expression, `${name}="${value}"`) : `${contents.trimEnd()}\n${name}="${value}"\n`;
};
if (!current.AUTH_SECRET || current.AUTH_SECRET.length < 32 || /SUBSTITUA|EXAMPLE|CHANGE.?ME/i.test(current.AUTH_SECRET)) replace("AUTH_SECRET", randomBytes(48).toString("base64url"));
if (!current.AUTH_URL) replace("AUTH_URL", "http://127.0.0.1:3000");
if (!current.AUTH_EMAIL_DOMAINS) replace("AUTH_EMAIL_DOMAINS", "unisalesiano.com.br");
await writeFile(file, contents, { mode: 0o600 });
console.log("Configuração de autenticação preservada no .env local. Nenhum segredo foi exibido. Reinicie a aplicação se ela estiver em execução.");
