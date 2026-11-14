"""Stream pytchat events as UTF-8 JSON lines for server.js."""
import json
import sys

import pytchat


def emit(data):
    print(json.dumps(data, ensure_ascii=False), flush=True)


def main():
    chat = None
    try:
        chat = pytchat.create(video_id=sys.argv[1])
        emit(dict(event="status", state="running", message="채팅 감시 중"))
        while chat.is_alive():
            for msg in chat.get().sync_items():
                if msg.type not in ("textMessage", "superChat"):
                    continue
                emit(dict(event="chat", id=msg.id, type=msg.type,
                          name=msg.author.name, avatar=msg.author.imageUrl,
                          message=msg.message, parts=msg.messageEx,
                          amount=getattr(msg, "amountString", ""),
                          amountValue=getattr(msg, "amountValue", None),
                          currency=getattr(msg, "currency", ""),
                          timestamp=getattr(msg, "timestamp", None), time=msg.datetime))
    except Exception as exc:
        emit(dict(event="status", state="error", message=str(exc)))
        return 1
    finally:
        if chat is not None:
            chat.terminate()
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
