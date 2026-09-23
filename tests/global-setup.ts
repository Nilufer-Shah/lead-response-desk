import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a PostgreSQL test port"));
      server.close(() => resolve(address.port));
    });
  });
}

export default async function setup() {
  let directory: string | undefined;
  let databaseUrl = process.env.TEST_DATABASE_URL;

  if (!databaseUrl) {
    directory = mkdtempSync(join(tmpdir(), "lead-response-desk-test-"));
    const data = join(directory, "data");
    const port = await availablePort();
    execFileSync("initdb", ["-D", data, "--no-locale", "--encoding=UTF8"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", data, "-o", `-p ${port} -h 127.0.0.1 -k ${directory}`, "-w", "start"], { stdio: "ignore" });
    execFileSync("createdb", ["-h", "127.0.0.1", "-p", String(port), "lead_response_desk_test"], { stdio: "ignore" });
    databaseUrl = `postgres://127.0.0.1:${port}/lead_response_desk_test`;
  }

  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "test" });
  execFileSync("npm", ["run", "db:migrate"], { cwd: process.cwd(), env: process.env, stdio: "inherit" });

  return () => {
    if (!directory) return;
    execFileSync("pg_ctl", ["-D", join(directory, "data"), "-m", "fast", "-w", "stop"], { stdio: "ignore" });
    rmSync(directory, { recursive: true, force: true });
  };
}
