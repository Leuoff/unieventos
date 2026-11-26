import "dotenv/config";
import { spawn } from "node:child_process";

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== "/unieventos_test" || url === process.env.DATABASE_URL) {
  throw new Error("Configure TEST_DATABASE_URL para o banco exclusivo unieventos_test, diferente do banco da aplicação.");
}
const mode = process.argv[2] ?? "migrate";
const args = mode === "integration"
  ? ["--conditions=react-server", "--import", "tsx", "--test", "--test-concurrency=1", "tests/auth-bootstrap.test.ts", "tests/auth.test.ts", "tests/inventory.test.ts", "tests/events.test.ts", "tests/requests.test.ts", "tests/movements.test.ts", "tests/movements-stock.test.ts"]
  : mode === "server"
    ? ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3100"]
    : ["node_modules/prisma/build/index.js", "migrate", "deploy"];

const child = spawn(process.execPath, args, { stdio: "inherit", windowsHide: true, env: { ...process.env, DATABASE_URL: url, AUTH_URL: "http://127.0.0.1:3100" } });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
