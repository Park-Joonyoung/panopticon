const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { ChatStore } = require("./chat_store");
const store = new ChatStore(path.join(__dirname, "data"));
const clients = new Set();
let worker = null;
let status = {
  event: "status",
  state: "idle",
  message: "방송 URL을 입력해 주세요",
};
function broadcast(event) {
  if (event.event === "status") status = event;
  for (const client of clients)
    client.write(`data: ${JSON.stringify(event)}\n\n`);
}
function stop() {
  if (worker) {
    const previous = worker;
    worker = null;
    previous.kill();
  }
}
function videoId(value) {
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (
      !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
        url.hostname
      )
    )
      return null;
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : url.searchParams.get("v") ||
          url.pathname.match(/^\/(?:live|shorts)\/([\w-]{11})/)?.[1];
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, "dashboard.html")).pipe(res);
  } else if (req.method === "GET" && url.pathname === "/dashboard.css") {
    res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, "dashboard.css")).pipe(res);
  } else if (req.method === "GET" && ["/dashboard.js", "/theme.js"].includes(url.pathname)) {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, url.pathname.slice(1))).pipe(res);
  } else if (req.method === "GET" && /^\/assets\/fonts\/neodgm\.(woff2|woff|ttf)$/.test(url.pathname)) {
    const types = { ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };
    const font = path.join(__dirname, "assets", "fonts", path.basename(url.pathname));
    fs.readFile(font, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": types[path.extname(font)] });
      res.end(data);
    });
  } else if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(store.snapshot())}\n\n`);
    res.write(`data: ${JSON.stringify(status)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  } else if (
    req.method === "POST" &&
    ["/start", "/stop", "/read"].includes(url.pathname)
  ) {
    if (req.headers.origin !== `http://${req.headers.host}`) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (url.pathname === "/read") {
      if (!store.video || url.searchParams.get("video") !== store.video) {
        res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("선택된 영상이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
        return;
      }
      const read = url.searchParams.get("read");
      if (!["true", "false"].includes(read)) {
        res.writeHead(400); res.end("Invalid read state"); return;
      }
      try {
        broadcast(store.setRead(url.searchParams.get("id"), read === "true"));
        res.writeHead(200); res.end("ok");
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`읽음 상태 저장 실패: ${error.message}`);
      }
      return;
    }
    const id = videoId(url.searchParams.get("video") || "");
    if (url.pathname === "/start" && !id) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("올바른 YouTube URL 또는 영상 ID를 입력해 주세요.");
      return;
    }
    stop();
    if (url.pathname === "/stop")
      broadcast({ event: "status", state: "idle", message: "감시 중지됨" });
    else {
      try {
        store.open(id);
      } catch (error) {
        const message = `채팅 기록을 불러오지 못했습니다: ${error.message}`;
        broadcast({ event: "status", state: "error", message });
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(message);
        return;
      }
      broadcast(store.snapshot());
      broadcast({
        event: "status",
        state: "connecting",
        message: "유튜브에 연결 중…",
      });
      const python = path.join(
        __dirname,
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
      );
      if (!fs.existsSync(python)) {
        const message = `프로젝트 가상환경의 Python을 찾을 수 없습니다: ${python}. .venv 환경을 먼저 구성해 주세요.`;
        broadcast({ event: "status", state: "error", message });
        res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(message);
        return;
      }
      const child = spawn(
        python,
        ["-u", path.join(__dirname, "chat_bridge.py"), id],
        {
          cwd: __dirname,
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
          windowsHide: true,
        }
      );
      worker = child;
      let failed = false,
        stderr = "";
      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        if (worker !== child) return;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          /* Ignore non-event library output. */
          return;
        }
        if (event.event === "chat") {
          try {
            if (!store.append(event)) return;
          } catch (error) {
            stop();
            broadcast({ event: "status", state: "error",
              message: `채팅 저장 실패로 감시을 중지했습니다: ${error.message}` });
            return;
          }
        }
        if (event.state === "error") failed = true;
        broadcast(event);
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-2000);
      });
      child.on("error", (error) => {
        if (worker !== child) return;
        failed = true;
        broadcast({
          event: "status",
          state: "error",
          message: `Python 실행 실패: ${error.message}`,
        });
      });
      child.on("close", (code) => {
        if (worker !== child) return;
        worker = null;
        if (!failed)
          broadcast({
            event: "status",
            state: code ? "error" : "idle",
            message: code
              ? `감시 실패: ${stderr || `종료 코드 ${code}`}`
              : "방송 종료 또는 감시 완료",
          });
      });
    }
    res.writeHead(200);
    res.end("ok");
  } else {
    res.writeHead(404);
    res.end();
  }
});
const heartbeat = setInterval(() => {
  for (const client of clients) client.write(": heartbeat\n\n");
}, 15000);
server.listen(3000, "127.0.0.1", () =>
  console.log("대시보드: http://127.0.0.1:3000")
);
server.on("error", (error) => {
  console.error(error.message);
  clearInterval(heartbeat);
  stop();
  process.exitCode = 1;
});
function shutdown() {
  clearInterval(heartbeat);
  stop();
  for (const client of clients) client.end();
  server.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
