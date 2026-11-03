const $ = (id) => document.getElementById(id);
const state = { pc:null, channel:null, room:null, role:null, token:null, peerName:"مستخدم NEXA", connected:false, pendingInvite:false, deferredInstall:null, currentChatId:null, pollTimer:null };
const STORAGE_KEY = "nexa.local.v1";
const defaultData = { name:"مستخدم NEXA", stun:"stun:stun.l.google.com:19302", chats:[] };
let data = loadData();

function loadData(){ try{return {...defaultData,...JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")}}catch{return {...defaultData}} }
function saveData(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(data)); }
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600)}
function showView(name){document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));$(name+"View").classList.add("active")}
function setNetwork(online){$("networkBadge").classList.toggle("online",online);$("networkBadge").innerHTML=`<i></i> ${online?"متصل بالإنترنت":"غير متصل"}`}
window.addEventListener("online",()=>setNetwork(true));window.addEventListener("offline",()=>setNetwork(false));setNetwork(navigator.onLine);
$("displayName").value=data.name;$("stunUrl").value=data.stun;
$("saveNameBtn").onclick=()=>{data.name=$("displayName").value.trim().slice(0,32)||"مستخدم NEXA";$("displayName").value=data.name;saveData();toast("تم حفظ الاسم على هذا الجهاز")};
$("settingsBtn").onclick=()=>showView("settings");$("settingsBackBtn").onclick=()=>showView("home");$("backBtn").onclick=()=>showView("home");
$("saveStunBtn").onclick=()=>{const v=$("stunUrl").value.trim();if(!v.startsWith("stun:")&&!v.startsWith("stuns:"))return toast("أدخل عنوان STUN صحيحاً");data.stun=v;saveData();toast("تم حفظ إعداد STUN")};
$("clearDataBtn").onclick=()=>{if(confirm("سيتم حذف الاسم وسجل المحادثات المحفوظ محلياً. هل تريد المتابعة؟")){localStorage.removeItem(STORAGE_KEY);location.reload()}};
$("chatInfoBtn").onclick=()=>{$("infoState").textContent=state.connected?"متصل مباشرة":"غير متصل";$("infoDialog").showModal()};
$("createBtn").onclick=createInvitation;$("joinBtn").onclick=()=>$("joinDialog").showModal();
$("joinCloseBtn").onclick=()=>$("joinDialog").close();
$("copyRoomBtn").onclick=async()=>{try{await navigator.clipboard.writeText(state.room);toast("تم نسخ رمز الدعوة")}catch{toast("تعذر النسخ؛ الرمز ظاهر أمامك")}};
$("joinForm").onsubmit=async(e)=>{e.preventDefault();$("joinError").textContent="";const code=$("joinCode").value.trim().toUpperCase();if(!/^[A-F0-9]{12}$/.test(code)){$("joinError").textContent="رمز الدعوة يجب أن يتكون من 12 خانة.";return} $("joinDialog").close();try{await joinRoom(code)}catch(err){$("joinDialog").showModal();$("joinError").textContent=err.message||"تعذر الانضمام"}};
$("messageForm").onsubmit=(e)=>{e.preventDefault();sendMessage()};
$("messageInput").addEventListener("input",()=>{$("sendBtn").disabled=!state.connected||!$("messageInput").value.trim()});
function api(action,body={}){return fetch("/api/signal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...body})}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"تعذر الاتصال بخدمة الإشارات");return j})}
function makeId(){return crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(16).slice(2)}
function waitIce(pc,timeout=18000){return new Promise((resolve,reject)=>{if(pc.iceGatheringState==="complete")return resolve();const timer=setTimeout(()=>{pc.removeEventListener("icegatheringstatechange",check);reject(new Error("انتهت مهلة جمع بيانات الاتصال. تحقق من STUN والإنترنت."))},timeout);function check(){if(pc.iceGatheringState==="complete"){clearTimeout(timer);pc.removeEventListener("icegatheringstatechange",check);resolve()}}pc.addEventListener("icegatheringstatechange",check)})}
function newPeerConnection(){const pc=new RTCPeerConnection({iceServers:[{urls:data.stun}]});pc.onconnectionstatechange=()=>{const s=pc.connectionState;if(s==="connected"){state.connected=true;updateConnectionUI(true)}else if(["failed","disconnected","closed"].includes(s)){state.connected=false;updateConnectionUI(false);if(s==="failed")toast("فشل الاتصال المباشر. قد لا تسمح الشبكة باتصال P2P.")}};pc.oniceconnectionstatechange=()=>{if(pc.iceConnectionState==="failed")toast("تعذر إنشاء مسار مباشر بين الجهازين.")};return pc}
function updateConnectionUI(connected){$("peerStatus").textContent=connected?"متصل مباشرة":"بانتظار الاتصال";$("deliveryHint").textContent=connected?"الرسائل تنتقل مباشرة بين الجهازين.":"لا يمكن إرسال الرسائل قبل الاتصال."; $("sendBtn").disabled=!connected||!$("messageInput").value.trim();if(state.role==="host"&&state.pendingInvite&&connected){$("inviteStatus").textContent="تم الاتصال بنجاح";setTimeout(()=>$("inviteDialog").close(),1000)}}
async function createInvitation(){
 if(!navigator.onLine)return toast("تحقق من اتصال الإنترنت أولاً");
 try{
  cleanupPeer();state.role="host";state.pendingInvite=true;
  const room=await api("create");state.room=room.room;state.token=room.token;
  $("roomCode").textContent=room.room;$("inviteStatus").textContent="جارٍ تجهيز الدعوة...";
  $("inviteDialog").showModal();
  const pc=newPeerConnection();state.pc=pc;
  const channel=pc.createDataChannel("nexa-chat",{ordered:true});attachChannel(channel);
  const offer=await pc.createOffer();await pc.setLocalDescription(offer);await waitIce(pc);
  await api("publish-offer",{room:state.room,token:state.token,sdp:pc.localDescription});
  $("inviteStatus").textContent="الدعوة جاهزة — شارك الرمز وانتظر الاتصال";
  pollForAnswer();
 }catch(err){toast(err.message||"تعذر إنشاء الدعوة");cleanupPeer()}
}
async function joinRoom(room){
 if(!navigator.onLine)throw new Error("تحقق من اتصال الإنترنت أولاً");
 cleanupPeer();state.role="guest";state.room=room;
 const joined=await api("join",{room});state.token=joined.token;
 $("peerName").textContent="محادثة مباشرة";showView("chat");
 const pc=newPeerConnection();state.pc=pc;pc.ondatachannel=(event)=>attachChannel(event.channel);
 let offerResult=null;
 for(let i=0;i<30;i++){try{offerResult=await api("get-offer",{room,token:state.token});if(offerResult.sdp)break}catch(e){if(i===29)throw e}await delay(1500)}
 if(!offerResult?.sdp)throw new Error("لم تصل دعوة الاتصال. تأكد من الرمز وأن الطرف الآخر ما زال ينتظر.");
 await pc.setRemoteDescription(offerResult.sdp);
 const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await waitIce(pc);
 await api("publish-answer",{room,token:state.token,sdp:pc.localDescription});
 toast("تم إرسال الرد؛ جارٍ إنشاء الاتصال");
}
async function pollForAnswer(){
 for(let i=0;i<70&&state.role==="host"&&!state.connected;i++){try{const r=await api("get-answer",{room:state.room,token:state.token});if(r.sdp){await state.pc.setRemoteDescription(r.sdp);showView("chat");$("peerName").textContent="محادثة مباشرة";ensureChat();return}}catch(e){if(i===69)toast(e.message)}await delay(1500)}
 if(!state.connected&&state.role==="host"){$("inviteStatus").textContent="لم يكتمل الاتصال. يمكنك المحاولة مجدداً."}
}
function delay(ms){return new Promise(r=>setTimeout(r,ms))}
function attachChannel(channel){state.channel=channel;channel.onopen=()=>{state.connected=true;ensureChat();showView("chat");updateConnectionUI(true);toast("أصبح الاتصال المباشر جاهزاً")};channel.onclose=()=>{state.connected=false;updateConnectionUI(false)};channel.onerror=()=>toast("حدث خطأ في قناة الاتصال");channel.onmessage=(event)=>{try{const packet=JSON.parse(event.data);if(packet.v!==1||packet.type!=="message"||typeof packet.text!=="string")return;addMessage({id:packet.id||makeId(),text:packet.text.slice(0,4000),mine:false,time:packet.time||Date.now(),status:"received"});channel.send(JSON.stringify({v:1,type:"ack",id:packet.id}))}catch{console.warn("Rejected malformed peer packet")}}}
function ensureChat(){const id=state.room;if(!id)return;let chat=data.chats.find(c=>c.id===id);if(!chat){chat={id,name:state.peerName||"مستخدم NEXA",messages:[],updated:Date.now()};data.chats.unshift(chat)}state.currentChatId=id;saveData();renderChats();renderMessages()}
function addMessage(message){const chat=data.chats.find(c=>c.id===state.currentChatId);if(!chat)return;chat.messages.push(message);chat.updated=Date.now();saveData();renderMessages();renderChats()}
function sendMessage(){const text=$("messageInput").value.trim();if(!text||!state.connected||!state.channel||state.channel.readyState!=="open")return;const packet={v:1,type:"message",id:makeId(),text,time:Date.now()};try{state.channel.send(JSON.stringify(packet));addMessage({...packet,mine:true,status:"sent"});$("messageInput").value="";$("sendBtn").disabled=true}catch{toast("تعذر إرسال الرسالة")}}
function renderMessages(){const box=$("messages");box.innerHTML='<div class="system-note">بدأت هذه المحادثة باتصال مباشر. لا تُرسل الرسائل إلى خادم NEXA.</div>';const chat=data.chats.find(c=>c.id===state.currentChatId);(chat?.messages||[]).forEach(m=>{const el=document.createElement("div");el.className="bubble"+(m.mine?" mine":"");el.textContent=m.text;const meta=document.createElement("span");meta.className="bubble-meta";meta.textContent=new Date(m.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+(m.mine?" · أُرسلت":" · وصلت");el.append(meta);box.append(el)});box.scrollTop=box.scrollHeight}
function renderChats(){$("chatCount").textContent=data.chats.length;const list=$("chatList");list.innerHTML="";if(!data.chats.length){list.innerHTML='<div class="empty-state"><div class="empty-symbol">◌</div><strong>لا توجد محادثات بعد</strong><span>أنشئ دعوة أو انضم إلى محادثة للبدء.</span></div>';return}data.chats.forEach(c=>{const item=document.createElement("div");item.className="chat-item";const avatar=document.createElement("div");avatar.className="peer-avatar";avatar.textContent="P";const info=document.createElement("div");info.style.flex="1";const title=document.createElement("strong");title.textContent=c.name;const last=document.createElement("small");last.textContent=c.messages.at(-1)?.text||"محادثة محفوظة محلياً";info.append(title,last);item.append(avatar,info);item.onclick=()=>{state.currentChatId=c.id;state.room=c.id;renderMessages();showView("chat");toast("السجل محلي؛ أعد الاتصال لإرسال رسائل جديدة")};list.append(item)})}
function cleanupPeer(){if(state.pc){try{state.pc.close()}catch{}}state.pc=null;state.channel=null;state.connected=false;state.pendingInvite=false}
$("backBtn").addEventListener("click",()=>{if(state.pc&&!state.connected)cleanupPeer()});
renderChats();
if("serviceWorker" in navigator&&location.protocol==="https:"){navigator.serviceWorker.register("/sw.js").catch(()=>{})}
window.addEventListener("beforeinstallprompt",(e)=>{e.preventDefault();state.deferredInstall=e;$("installBtn").classList.remove("hidden")});
$("installBtn").onclick=async()=>{if(!state.deferredInstall)return;state.deferredInstall.prompt();await state.deferredInstall.userChoice;state.deferredInstall=null;$("installBtn").classList.add("hidden")};
