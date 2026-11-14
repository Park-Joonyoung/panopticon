# PANOPTICON

[홍준성(개념쌓기)](https://www.youtube.com/@%EA%B0%9C%EB%85%90%EC%8C%93%EA%B8%B0) 작가님의 원활한 방송 진행을 돕고자 만든 프로그램입니다.
- 이 프로그램은 해당 작가의 공식 프로그램이 아니며, 팬 제작 프로그램입니다.
- ChatGPT를 이용하여 빠르게 제작되었으므로 버그가 발생할 수 있습니다.
- 버그를 issue로 남겨 주신다면 감사합니다만, 언제 fix가 될지는 장담할 수 없습니다.

# 사용 Asset 및 Third-Party Libraries

- [pytchat](https://github.com/taizan-hokuto/pytchat)
- 글꼴: Neo둥근모 ([https://neodgm.dalgona.dev/](https://neodgm.dalgona.dev/))
- 디자인 레퍼런스: 개념쌓기 채널 (https://www.youtube.com/@%EA%B0%9C%EB%85%90%EC%8C%93%EA%B8%B0)

# 사용법

Node.js를 미리 설치해야 합니다.

```
git clone git@github.com:Park-Joonyoung/panopticon.git
python -m venv .venv
pip install -r requirements.txt
node server.js
```

이후 인터넷 브라우저에 `http://127.0.0.1:3000` 을 입력합니다.