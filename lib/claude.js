import crypto from "node:crypto";

const API = "https://api.overchat.ai/v1/chat/completions";
const MODEL = "claude-haiku-4-5-20251001";

const sessions = new Map();

function getSession(name = "default") {
  if (!sessions.has(name)) {
    sessions.set(name, {
      chatId: crypto.randomUUID(),
      messages: []
    });
  }
  return sessions.get(name);
}

export async function chat(prompt, sessionName = "default") {
  try {
    const session = getSession(sessionName);

    const messages = [
      ...session.messages.slice(-10),
      { role: "user", content: prompt }
    ];

    const res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "origin": "https://overchat.ai",
        "referer": "https://overchat.ai/"
      },
      body: JSON.stringify({
        chatId: session.chatId,
        model: MODEL,
        messages,
        personaId: "claude-haiku-4-5-landing",
        temperature: 0.5,
        max_tokens: 2000,
        stream: false
      })
    });

    const raw = await res.text().catch(() => "");

    // kalau HTTP error
    if (!res.ok) {
      return {
        status: false,
        code: res.status,
        answer: raw || "HTTP ERROR"
      };
    }

    let answer = "";

    try {
      const json = JSON.parse(raw);

      answer =
        json?.choices?.[0]?.message?.content ||
        json?.choices?.[0]?.delta?.content ||
        json?.data ||
        json?.output ||
        json?.answer ||
        json?.message ||
        "";
    } catch {
      // kalau bukan JSON, pakai raw text
      answer = raw;
    }

    if (!answer || answer.trim() === "") {
      return {
        status: false,
        answer: "Empty response from API"
      };
    }

    session.messages.push(
      { role: "user", content: prompt },
      { role: "assistant", content: answer }
    );

    if (session.messages.length > 20) {
      session.messages = session.messages.slice(-20);
    }

    return {
      status: true,
      model: MODEL,
      answer: answer.trim()
    };
  } catch (err) {
    return {
      status: false,
      error: String(err),
      answer: ""
    };
  }
}