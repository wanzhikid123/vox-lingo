import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { Store } from "../server/store.js";
import { root } from "../server/config.js";

test(
  "Windows stop script gracefully stops this checkout and saves the interrupted lesson",
  { skip: process.platform !== "win32", timeout: 30000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "english-stop-"));
    const seed = new Store(join(directory, "learning.sqlite"));
    seed.saveLessonPlan("colors", 1, 0, {
      goal: "Colors",
      steps: [
        {
          id: "red",
          mode: "repeat",
          word: "red",
          meaning: "Rot",
          distractors: [],
          stage: "new",
          seconds: 30,
        },
      ],
    });
    seed.close();
    const probe = createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== "gemini_api_key",
      ),
    );
    Object.assign(env, {
      KI_PORT: String(port),
      KI_DATA_DIR: directory,
    });
    const child = spawn(process.execPath, [join(root, "server/index.js")], {
      cwd: root,
      env,
      windowsHide: true,
      stdio: "ignore",
    });
    const exited = new Promise((r) => child.once("exit", r));
    t.after(async () => {
      if (child.exitCode === null) {
        child.kill();
        await exited;
      }
      rmSync(directory, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = (await fetch(base + "/api/health")).ok;
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(ready, true);
    const response = await fetch(base + "/api/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId: "colors", eventId: "stop-test" }),
    });
    assert.equal(response.status, 201);
    const lesson = await response.json();
    const run = promisify(execFile);
    const { stdout } = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(root, "Stop-vox-lingo.ps1"),
      ],
      { env, windowsHide: true, timeout: 20000 },
    );
    assert.match(stdout, /wurde beendet/);
    await exited;
    assert.equal(child.exitCode, 0);
    await assert.rejects(fetch(base + "/api/health"));
    const store = new Store(join(directory, "learning.sqlite"));
    try {
      assert.equal(store.lesson(lesson.id).status, "interrupted");
    } finally {
      store.close();
    }
    const repeated = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(root, "Stop-vox-lingo.ps1"),
      ],
      { env, windowsHide: true, timeout: 10000 },
    );
    assert.match(repeated.stdout, /bereits beendet/);
  },
);
