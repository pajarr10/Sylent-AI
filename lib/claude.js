import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Endpoint tetap bisa dioverride lewat .env (konsisten dengan pola AI_API_BASE
// yang sudah ada di project ini), tapi default ke URL yang diberikan.
const API = process.env.AI_API_BASE || "https://api.overchat.ai/v1/chat/completions";

// Vercel/serverless punya filesystem read-only kecuali /tmp, jadi session
// disimpan di /tmp saat di lingkungan itu, dan tetap ke $HOME saat lokal/VPS.
const SESSION_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "overchat-sessions")
  : path.join(process.env.HOME || os.tmpdir(), "overchat-sessions");
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

const UAS = [
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/147.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 Chrome/149.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Version/18.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36"
];

const MODEL = "claude-haiku-4-5-20251001";

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function clean(t) {
  return (t || "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/__/g, "")
    .replace(/_/g, "")
    .replace(/\\n/g, "\n")   // literal "\n" escape sequences from upstream -> real newlines
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n") // collapse excessive blank lines, but keep structure/code fences intact
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function loadSession(name) {
  const file = path.join(SESSION_DIR, (name || "default") + ".json");
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!s.deviceId) s.deviceId = crypto.randomUUID();
    if (!Array.isArray(s.messages)) s.messages = [];
    return s;
  } catch {
    const s = { chatId: crypto.randomUUID(), deviceId: crypto.randomUUID(), messages: [] };
    fs.writeFileSync(file, JSON.stringify(s, null, 2));
    return s;
  }
}

function saveSession(name, s) {
  const file = path.join(SESSION_DIR, (name || "default") + ".json");
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
}

export async function chat(prompt, sessionName = null) {
  await sleep(100 + Math.random() * 500);
  const session = loadSession(sessionName);
  const messages = [
    ...session.messages.slice(-10),
    { id: crypto.randomUUID(), role: "user", content: prompt },
    { id: crypto.randomUUID(), role: "system", content: "Jawab dengan bahasa natural, singkat, dan jelas. Jangan gunakan markdown, asterik, atau formatting apapun. Jangan gunakan emoji." }
  ];

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "sec-ch-ua-platform": '"Android"',
      "x-device-uuid": session.deviceId,
      "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "sec-ch-ua-mobile": "?1",
      "x-device-language": "id-ID",
      "x-device-platform": "web",
      "x-device-version": "1.0.44",
      "user-agent": pick(UAS),
      accept: "*/*",
      "content-type": "application/json",
      origin: "https://overchat.ai",
      referer: "https://overchat.ai/",
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8"
    },
    body: JSON.stringify({
      chatId: session.chatId,
      model: MODEL,
      messages,
      personaId: "claude-haiku-4-5-landing",
      frequency_penalty: 0,
      max_tokens: 4000,
      presence_penalty: 0,
      stream: true,
      temperature: 0.5,
      top_p: 0.95
    })
  });

  if (!res.ok) return { creator: "pajar", status: false, code: res.status, model: MODEL, answer: "" };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", answer = "";

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
        const content = json.choices?.[0]?.delta?.content;
        if (typeof content === "string") answer += content;
      } catch {}
    }
  }

  answer = clean(answer);

  session.messages.push(
    { id: crypto.randomUUID(), role: "user", content: prompt },
    { id: crypto.randomUUID(), role: "assistant", content: answer }
  );
  if (session.messages.length > 20) session.messages = session.messages.slice(-20);
  saveSession(sessionName, session);

  return { creator: "pajar", status: true, model: MODEL, answer, session: sessionName || "default" };
}

if (process.argv[1]?.includes("claude")) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === "rename") {
    const oldFile = path.join(SESSION_DIR, (args[1] || "default") + ".json");
    const newFile = path.join(SESSION_DIR, (args[2] || "default") + ".json");
    const ok = fs.existsSync(oldFile);
    if (ok) { fs.renameSync(oldFile, newFile); }
    console.log(JSON.stringify({ status: ok, message: ok ? `Renamed '${args[1]}' to '${args[2]}'` : `Session '${args[1]}' not found` }));
    process.exit(0);
  }

  if (cmd === "delete") {
    const file = path.join(SESSION_DIR, (args[1] || "default") + ".json");
    const ok = fs.existsSync(file);
    if (ok) { fs.unlinkSync(file); }
    console.log(JSON.stringify({ status: ok, message: ok ? `Deleted '${args[1]}'` : `Session '${args[1]}' not found` }));
    process.exit(0);
  }

  if (cmd === "list") {
    const sessions = fs.existsSync(SESSION_DIR) ? fs.readdirSync(SESSION_DIR).filter(f => f.endsWith(".json")).map(f => f.replace(".json", "")) : [];
    console.log(JSON.stringify({ sessions }));
    process.exit(0);
  }

  const prompt = args[0];
  if (!prompt) {
    console.log(JSON.stringify({
      usage: {
        basic: 'node claude.js "<prompt>"',
        with_memory: 'node claude.js "<prompt>" <session>',
        rename: 'node claude.js rename <old> <new>',
        delete: 'node claude.js delete <session>',
        list: 'node claude.js list'
      },
      model: MODEL,
      features: "Memory + Rename/Delete/List + Rotating UA + Clean output",
      creator: "pajar"
    }, null, 2));
    process.exit(0);
  }

  const sessionName = args[1] || null;
  chat(prompt, sessionName).then(r => console.log(JSON.stringify(r, null, 2)));
                                }

