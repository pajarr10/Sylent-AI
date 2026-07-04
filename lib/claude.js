import crypto from "node:crypto";

const API = "https://api.overchat.ai/v1/chat/completions";

const UAS = [
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/147.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 Chrome/149.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Version/18.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36"
];

const MODEL = "claude-haiku-4-5-20251001";

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const sessions = new Map();

function getSession(name = "default") {
  if (!sessions.has(name)) {
    sessions.set(name, {
      chatId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      messages: []
    });
  }
  return sessions.get(name);
}

function clean(t) {
  return (t || "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/__/g, "")
    .replace(/_/g, "")
    .replace(/`/g, "")
    .replace(/\\n/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\t+/g, " ")
    .replace(/  +/g, " ")
    .trim();
}

export async function chat(prompt, sessionName = "default") {
  try {
    await sleep(100 + Math.random() * 300);

    const session = getSession(sessionName);

    const messages = [
      ...session.messages.slice(-10),
      { role: "user", content: prompt },
      {
        role: "system",
        content:
          "Jawab dengan bahasa natural, singkat, jelas. Jangan pakai markdown atau simbol formatting."
      }
    ];

    const res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": pick(UAS),
        origin: "https://overchat.ai",
        referer: "https://overchat.ai/"
      },
      body: JSON.stringify({
        chatId: session.chatId,
        model: MODEL,
        messages,
        personaId: "claude-haiku-4-5-landing",
        temperature: 0.5,
        max_tokens: 2000,
        stream: true
      })
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return {
        creator: "rynaqrtz",
        status: false,
        code: res.status,
        answer: err || "API error"
      };
    }

    if (!res.body) {
      return {
        creator: "rynaqrtz",
        status: false,
        code: 500,
        answer: "No response body"
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let buf = "";
    let answer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith("data:")) continue;

        const d = l.slice(5).trim();
        if (!d || d === "[DONE]") continue;

        try {
          const json = JSON.parse(d);
          const content = json?.choices?.[0]?.delta?.content;
          if (typeof content === "string") answer += content;
        } catch {}
      }
    }

    answer = clean(answer);

    session.messages.push(
      { role: "user", content: prompt },
      { role: "assistant", content: answer }
    );

    if (session.messages.length > 20) {
      session.messages = session.messages.slice(-20);
    }

    return {
      creator: "rynaqrtz",
      status: true,
      model: MODEL,
      answer,
      session: sessionName
    };
  } catch (err) {
    return {
      creator: "rynaqrtz",
      status: false,
      error: String(err),
      answer: ""
    };
  }
}