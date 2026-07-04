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
        stream: false
      })
    });

    const text = await res.text();

    if (!res.ok) {
      return {
        status: false,
        code: res.status,
        answer: text
      };
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return {
        status: false,
        answer: "Invalid JSON response from API"
      };
    }

    const answer =
      json?.choices?.[0]?.message?.content ||
      json?.answer ||
      "";

    session.messages.push(
      { role: "user", content: prompt },
      { role: "assistant", content: answer }
    );

    return {
      status: true,
      model: MODEL,
      answer
    };
  } catch (err) {
    return {
      status: false,
      error: String(err)
    };
  }
}