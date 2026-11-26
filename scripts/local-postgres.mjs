import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { readFile, writeFile, mkdir, access, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { parse } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, ".local", "postgres");
const data = path.join(local, "data");
const configFile = path.join(local, "config.json");
const binaryPlatform = process.platform === "win32" ? "windows" : process.platform;
const bin = await import(`@embedded-postgres/${binaryPlatform}-${process.arch}`);
const command = process.argv[2] ?? "start";
await mkdir(local, { recursive: true });
let config;
try { config = JSON.parse(await readFile(configFile, "utf8")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  config = { port: 55432, admin: "unieventos_admin", adminPassword: randomBytes(24).toString("hex"), user: "unieventos_app", password: randomBytes(24).toString("hex") };
  await writeFile(configFile, JSON.stringify(config), { flag: "wx", mode: 0o600 });
}

function connection(database, admin = false) {
  return { host: "127.0.0.1", port: config.port, user: admin ? config.admin : config.user, password: admin ? config.adminPassword : config.password, database, connectionTimeoutMillis: 5000 };
}

async function run(binary, args) {
  // File handles avoid Windows descendants keeping execFile's output pipes open.
  const logFile = path.join(local, "control.log");
  const descriptor = openSync(logFile, "w");
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(binary, args, { cwd: root, windowsHide: true, stdio: ["ignore", descriptor, descriptor], timeout: 60_000 });
      child.once("error", reject);
      child.once("exit", resolve);
    });
    if (code !== 0) throw new Error((await readFile(logFile, "utf8")).slice(-3000));
  } finally { closeSync(descriptor); }
}

async function isInitialized() {
  try { await access(path.join(data, "PG_VERSION")); return true; } catch { return false; }
}

async function isRunning() {
  const client = new Client(connection("postgres", true));
  try { await client.connect(); await client.query("SELECT 1"); return true; }
  catch { return false; }
  finally { await client.end().catch(() => {}); }
}

try {
  if (command === "stop") {
    if (await isRunning()) await run(bin.pg_ctl, ["-D", data, "-m", "fast", "-w", "stop"]);
    console.log("PostgreSQL local parado; os dados foram preservados.");
  } else if (command === "status") {
    console.log(await isRunning() ? "PostgreSQL local em execução na porta 55432." : "PostgreSQL local parado.");
  } else if (command === "start" || command === "setup") {
    if (!await isInitialized()) {
      const passwordFile = path.join(local, "init-password.tmp");
      await writeFile(passwordFile, `${config.adminPassword}\n`, { flag: "wx", mode: 0o600 });
      try {
        await run(bin.initdb, ["-D", data, "-U", config.admin, "--pwfile", passwordFile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"]);
      } finally { await unlink(passwordFile).catch(() => {}); }
    }
    if (!await isRunning()) await run(bin.pg_ctl, ["-D", data, "-l", path.join(local, "postgres.log"), "-o", `-h 127.0.0.1 -p ${config.port}`, "-w", "start"]);
    const admin = new Client(connection("postgres", true));
    await admin.connect();
    try {
      const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [config.user]);
      if (!role.rowCount) {
        // Generated credentials contain hex only; escape literals explicitly.
        const escaped = config.password.replaceAll("'", "''");
        await admin.query(`CREATE ROLE unieventos_app LOGIN PASSWORD '${escaped}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
      }
      for (const database of ["unieventos", "unieventos_test"]) {
        const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
        if (!found.rowCount) await admin.query(`CREATE DATABASE "${database}" OWNER unieventos_app`);
      }
    } finally { await admin.end(); }
    const localUrl = `postgresql://${config.user}:${config.password}@127.0.0.1:${config.port}/unieventos`;
    const envFile = path.join(root, ".env");
    let contents = "";
    try { contents = await readFile(envFile, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const existing = parse(contents);
    if (existing.DATABASE_URL && existing.DATABASE_URL !== localUrl) throw new Error("O .env aponta para outro banco; a configuração existente foi preservada. Revise a conexão antes de migrar.");
    if (!existing.DATABASE_URL) contents += `\nDATABASE_URL="${localUrl}"\n`;
    if (!existing.TEST_DATABASE_URL) contents += `TEST_DATABASE_URL="${localUrl}_test"\n`;
    await writeFile(envFile, contents, { mode: 0o600 });
    console.log("PostgreSQL local pronto em 127.0.0.1:55432; bancos de desenvolvimento e teste separados. Credenciais salvas no .env ignorado pelo Git.");
  } else throw new Error("Use start, stop, status ou setup.");
} catch (error) {
  // Never emit configuration, connection URLs or generated credentials.
  const message = String(error.stderr || error.message || "Falha ao iniciar PostgreSQL local.");
  console.error(message.replaceAll(config.password, "[redigido]").replaceAll(config.adminPassword, "[redigido]"));
  process.exitCode = 1;
}
