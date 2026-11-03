const crypto = require("node:crypto");

const TTL_SECONDS = 600;
const ROOM_RE = /^[A-F0-9]{12}$/;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}
function token(){ return crypto.randomBytes(24).toString("base64url"); }
function roomCode(){ return crypto.randomBytes(6).toString("hex").toUpperCase(); }

async function redis(command, ...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const secret = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !secret) throw new Error("Server configuration missing: Upstash credentials are not configured.");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify([command, ...args])
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Temporary signaling storage error.");
  return data.result;
}
async function getMeta(room){
  const raw = await redis("GET", `nexa:${room}:meta`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function validSdp(sdp){
  return sdp && typeof sdp === "object" &&
    ["offer","answer"].includes(sdp.type) &&
    typeof sdp.sdp === "string" &&
    sdp.sdp.length > 0 && sdp.sdp.length <= 100000 &&
    sdp.sdp.includes("v=0");
}
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." });
  const body = req.body || {};
  const action = body.action;
  try {
    if (action === "create") {
      let room, hostToken, result;
      for (let i=0; i<4; i++) {
        room = roomCode(); hostToken = token();
        result = await redis("SET", `nexa:${room}:meta`, JSON.stringify({hostToken, createdAt:Date.now(), guestJoined:false}), "EX", TTL_SECONDS, "NX");
        if (result === "OK") break;
      }
      if (result !== "OK") return send(res, 503, {error:"Could not allocate a room. Please retry."});
      return send(res, 200, {room, token:hostToken, expiresIn:TTL_SECONDS});
    }
    const room = String(body.room || "").toUpperCase();
    if (!ROOM_RE.test(room)) return send(res, 400, {error:"Invalid room code."});
    const meta = await getMeta(room);
    if (!meta) return send(res, 404, {error:"Room not found or expired."});

    if (action === "join") {
      const guestToken = token();
      const lock = await redis("SET", `nexa:${room}:guest`, guestToken, "EX", TTL_SECONDS, "NX");
      if (lock !== "OK") return send(res, 409, {error:"This invitation has already been used."});
      return send(res, 200, {token:guestToken});
    }
    if (action === "publish-offer") {
      if (!safeEqual(body.token, meta.hostToken)) return send(res, 403, {error:"Invalid host token."});
      if (!validSdp(body.sdp) || body.sdp.type !== "offer") return send(res, 400, {error:"Invalid SDP offer."});
      await redis("SET", `nexa:${room}:offer`, JSON.stringify(body.sdp), "EX", TTL_SECONDS);
      return send(res, 200, {ok:true});
    }
    if (action === "get-offer") {
      const guestToken = await redis("GET", `nexa:${room}:guest`);
      if (!safeEqual(body.token, guestToken)) return send(res, 403, {error:"Join this room first."});
      const raw = await redis("GET", `nexa:${room}:offer`);
      return send(res, 200, {sdp: raw ? JSON.parse(raw) : null});
    }
    if (action === "publish-answer") {
      const guestToken = await redis("GET", `nexa:${room}:guest`);
      if (!safeEqual(body.token, guestToken)) return send(res, 403, {error:"Invalid guest token."});
      if (!validSdp(body.sdp) || body.sdp.type !== "answer") return send(res, 400, {error:"Invalid SDP answer."});
      await redis("SET", `nexa:${room}:answer`, JSON.stringify(body.sdp), "EX", TTL_SECONDS);
      return send(res, 200, {ok:true});
    }
    if (action === "get-answer") {
      if (!safeEqual(body.token, meta.hostToken)) return send(res, 403, {error:"Invalid host token."});
      const raw = await redis("GET", `nexa:${room}:answer`);
      return send(res, 200, {sdp: raw ? JSON.parse(raw) : null});
    }
    if (action === "close") {
      const guestToken = await redis("GET", `nexa:${room}:guest`);
      if (!safeEqual(body.token, meta.hostToken) && !safeEqual(body.token, guestToken)) return send(res, 403, {error:"Invalid room token."});
      await redis("DEL", `nexa:${room}:meta`, `nexa:${room}:guest`, `nexa:${room}:offer`, `nexa:${room}:answer`);
      return send(res, 200, {ok:true});
    }
    return send(res, 400, {error:"Unknown action."});
  } catch (error) {
    console.error("NEXA signaling error:", error.message);
    return send(res, 500, {error:"Signaling service is temporarily unavailable. Check server configuration."});
  }
};
function safeEqual(a,b){
  if(typeof a!=="string"||typeof b!=="string") return false;
  const aa=Buffer.from(a), bb=Buffer.from(b);
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
