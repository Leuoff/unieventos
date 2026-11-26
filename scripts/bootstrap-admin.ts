import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { bootstrapFirstAdmin } from "../src/server/users-service";
import { getPrisma } from "../src/server/prisma";
import { InventoryError } from "../src/server/inventory-error";

class BootstrapInputError extends Error {}

function readPassword(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) throw new BootstrapInputError("Execute o bootstrap em um terminal interativo para digitar a senha de forma oculta.");
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => { stdin.removeListener("data", onData); stdin.setRawMode(false); stdin.pause(); stdout.write("\n"); };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") { finish(); reject(new BootstrapInputError("Bootstrap cancelado.")); return; }
        if (character === "\r" || character === "\n") { finish(); resolve(value); return; }
        if (character === "\u007f" || character === "\b") { value = value.slice(0, -1); continue; }
        if (character >= " " && value.length < 129) value += character;
      }
    };
    stdin.on("data", onData);
  });
}
async function main() {
  if (process.argv.length > 2) throw new BootstrapInputError("Não informe credenciais em argumentos. O bootstrap solicita os dados no terminal.");
  if (await getPrisma().user.count()) throw new BootstrapInputError("O primeiro administrador já existe. Use a tela de usuários com uma conta ADMIN.");
  if (!stdin.isTTY || !stdout.isTTY) throw new BootstrapInputError("Abra um terminal interativo para executar o bootstrap com senha oculta.");
  const terminal = createInterface({ input: stdin, output: stdout });
  const name = await terminal.question("Nome do primeiro administrador: ");
  const email = await terminal.question("E-mail institucional: ");
  terminal.close();
  const password = await readPassword("Senha (mínimo de 12 caracteres, entrada oculta): ");
  const confirmation = await readPassword("Confirme a senha (entrada oculta): ");
  if (password !== confirmation) throw new BootstrapInputError("As senhas não coincidem.");
  await bootstrapFirstAdmin({ name, email, password });
  stdout.write("Administrador criado. Entre no UniEventos com as credenciais informadas. Nenhuma senha foi registrada na saída.\n");
}
main().catch((error: unknown) => {
  console.error(error instanceof InventoryError || error instanceof BootstrapInputError ? error.message : "Não foi possível concluir o bootstrap. Confira a configuração e disponibilidade do banco.");
  process.exitCode = 1;
}).finally(async () => {
  try { await getPrisma().$disconnect(); }
  catch { process.exitCode = 1; }
});
