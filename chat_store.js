const fs = require("node:fs");
const path = require("node:path");

// One source file keeps the full chat and Super Chat views consistent.
class ChatStore {
  constructor(root) {
    this.root = root;
    this.video = null;
  }

  open(video) {
    if (!/^[\w-]{11}$/.test(video)) throw new Error("잘못된 영상 ID입니다.");
    const directory = path.join(this.root, video);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "chats.jsonl");
    const readFile = path.join(directory, "read.json");
    const readIds = fs.existsSync(readFile)
      ? JSON.parse(fs.readFileSync(readFile, "utf8")) : [];
    if (!Array.isArray(readIds) || !readIds.every(id => typeof id === "string")) {
      throw new Error("저장된 읽음 상태 형식이 올바르지 않습니다.");
    }
    const records = [];
    if (fs.existsSync(file)) {
      const buffer = fs.readFileSync(file);
      let offset = 0;
      while (offset < buffer.length) {
        const end = buffer.indexOf(10, offset);
        if (end === -1) {
          // Recover an interrupted append, without discarding complete lines.
          fs.truncateSync(file, offset);
          break;
        }
        const line = buffer.subarray(offset, end).toString("utf8").trim();
        if (line) {
          const record = JSON.parse(line);
          if (record.event !== "chat" || !record.id ||
              !["textMessage", "superChat"].includes(record.type)) {
            throw new Error("저장된 채팅 데이터 형식이 올바르지 않습니다.");
          }
          records.push(record);
        }
        offset = end + 1;
      }
    }
    this.file = file;
    this.readFile = readFile;
    this.readIds = new Set(readIds);
    this.records = new Map();
    this.video = video;
    this.ids = new Set();
    this.chats = [];
    this.paid = [];
    this.count = 0;
    this.paidCount = 0;
    for (const record of records) {
      if (this.ids.has(record.id)) continue;
      this.remember(record);
    }
  }

  remember(record) {
    record.read = record.type === "superChat" && this.readIds.has(record.id);
    this.records.set(record.id, record);
    this.ids.add(record.id);
    this.count++;
    this.chats.push(record);
    if (record.type === "superChat") {
      this.paidCount++;
      this.paid.push(record);
    }
  }

  append(record) {
    if (!this.video) throw new Error("저장할 영상이 선택되지 않았습니다.");
    if (!record.id || !["textMessage", "superChat"].includes(record.type)) {
      throw new Error("채팅 ID 또는 유형이 올바르지 않습니다.");
    }
    if (this.ids.has(record.id)) return false;
    fs.appendFileSync(this.file, JSON.stringify(record) + "\n", "utf8");
    this.remember(record);
    return true;
  }

  setRead(id, read) {
    const record = this.records?.get(id);
    if (!record || record.type !== "superChat") {
      throw new Error("슈퍼챗을 찾을 수 없습니다.");
    }
    if (typeof read !== "boolean") throw new Error("잘못된 읽음 상태입니다.");
    const next = new Set(this.readIds);
    if (read) next.add(id);
    else next.delete(id);
    // Replace atomically so a failed write preserves the previous state.
    const temporary = this.readFile + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify([...next]) + "\n", "utf8");
    fs.renameSync(temporary, this.readFile);
    this.readIds = next;
    record.read = read;
    return { event: "read", video: this.video, id, read };
  }

  snapshot() {
    return {
      event: "history", video: this.video,
      chats: this.chats || [], paid: this.paid || [],
      count: this.count || 0, paidCount: this.paidCount || 0,
    };
  }
}

module.exports = { ChatStore };
