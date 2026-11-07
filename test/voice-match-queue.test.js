const fs=require('fs'), vm=require('vm'), assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname,'..','server.js'),'utf8');
const a=src.indexOf('const VOICE_MATCH_LIMIT'); const b=src.indexOf('// تحرير المستخدم من كل المقاعد');
const code=src.slice(a,b);
const events=[]; const blocks=new Set(); const logs=[];
const io={ to:(id)=>({emit:(ev,p)=>events.push({id,ev,p})}), sockets:{sockets:new Map()} };
const userSockets=new Map();
const users={ u1:{id:'u1',soul_tags:'a,b,c',soul_planet:'P',country_code:'JO'}, u2:{id:'u2',soul_tags:'a,b,c',soul_planet:'P',country_code:'JO'}, u3:{id:'u3',soul_tags:'a,b,c',soul_planet:'P',country_code:'JO'} };
for(const id of Object.keys(users)){ userSockets.set(id,new Set(['s_'+id])); io.sockets.sockets.set('s_'+id,{}); }
const ctx={ io,userSockets,console,setTimeout,clearTimeout,Date,Math,Promise,String,Set,Map,Array,parseInt,process:{env:{VOICE_MATCH_DURATION_MS:'400',VOICE_MATCH_CONNECT_TIMEOUT_MS:'300'}},
 uuidv4:()=>'abcdef12-0000', vipPerks:{hasPerk:()=>false},
 get:async(sql,p)=>{ if(sql.includes('user_blocks')) return (blocks.has(p[0]+'|'+p[1])||blocks.has(p[1]+'|'+p[0]))?{x:1}:undefined; if(sql.includes('COUNT')) return {c:0}; if(sql.includes('vip_level')) return {}; return undefined; },
 run:async(sql,p)=>{ logs.push(sql.slice(0,40)); }, all:async()=>[] };
vm.createContext(ctx); vm.runInContext(code+';this.X={vmGenderMutuallyAccepted,voiceMatchQueue,activeVoiceMatchSessions,tryMatchVoiceQueue,startVoiceMatchClock,finalizeVoiceMatchDeadline,endVoiceMatchSession,isBlockedEitherWay,removeFromVoiceMatchQueue};',ctx);
const X=ctx.X; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mk=(id)=>({userId:id,socketId:'s_'+id,user:users[id],enqueuedAt:Date.now(),timeout:null,state:'WAITING',requestId:'r'+id});
require('node:test')('voice-match queue/clock/reveal rules', async () => {
  // 1) فرد واحد لا يُطابق مع أحد
  const e1=mk('u1'); X.voiceMatchQueue.push(e1); assert.strictEqual(await X.tryMatchVoiceQueue(e1),false);
  // 2) حظر متبادل يمنع المطابقة
  blocks.add('u2|u1'); const e2=mk('u2'); X.voiceMatchQueue.push(e2); assert.strictEqual(await X.tryMatchVoiceQueue(e2),false);
  assert.strictEqual(X.voiceMatchQueue.length,2); blocks.clear();
  // 3) تزامن: ثلاثة يطلبون معاً → زوج واحد فقط، والثالث ينتظر
  const e3=mk('u3'); X.voiceMatchQueue.push(e3);
  await Promise.all([X.tryMatchVoiceQueue(e2),X.tryMatchVoiceQueue(e3),X.tryMatchVoiceQueue(e1)]);
  assert.strictEqual(X.activeVoiceMatchSessions.size,1,'one session only'); assert.strictEqual(X.voiceMatchQueue.length,1);
  const s=[...X.activeVoiceMatchSessions.values()][0];
  const ids=[s.userA.id,s.userB.id]; assert.strictEqual(new Set(ids).size,2);
  // 4) المؤقت لا يبدأ قبل اتصال الطرفين
  assert.strictEqual(s.clockStarted,false); assert.strictEqual(s.deadlineAt,null);
  X.startVoiceMatchClock(s); assert.ok(s.deadlineAt>Date.now()); 
  assert.ok(events.some(e=>e.ev==='voice_match_clock_started'));
  // 5) انتهاء المهلة دون كشف الطرفين → تنتهي
  await sleep(550); assert.strictEqual(X.activeVoiceMatchSessions.size,0,'ended at deadline');
  assert.ok(events.some(e=>e.ev==='voice_match_ended'&&e.p.reason==='time_up'));
  // 6) كشف الطرفين قبل المهلة → تستمر بلا حد
  X.voiceMatchQueue.length=0; events.length=0;
  const f1=mk('u1'),f2=mk('u2'); X.voiceMatchQueue.push(f1,f2); await X.tryMatchVoiceQueue(f2);
  const s2=[...X.activeVoiceMatchSessions.values()][0]; X.startVoiceMatchClock(s2);
  s2.userA.revealed=true; s2.userB.revealed=true; await sleep(550);
  assert.strictEqual(X.activeVoiceMatchSessions.size,1,'unlimited keeps going'); assert.strictEqual(s2.isUnlimited,true);
  X.endVoiceMatchSession(s2.id,'ended');
  // 7) عدم اتصال الصوت خلال المهلة → تُغلق دون احتساب الدقائق
  X.voiceMatchQueue.length=0; const g1=mk('u1'),g2=mk('u3'); X.voiceMatchQueue.push(g1,g2); await X.tryMatchVoiceQueue(g2);
  await sleep(400); assert.strictEqual(X.activeVoiceMatchSessions.size,0);
  assert.ok(events.some(e=>e.ev==='voice_match_ended'&&e.p.reason==='connect_timeout'));
  // 8) فلتر الجنس: أنثى تطلب أنثى فقط، والجميع عشوائي، والشرط متبادل
  X.voiceMatchQueue.length=0;
  const gu={ f1:{...users.u1,id:'f1',gender:'female'}, f2:{...users.u2,id:'f2',gender:'female'}, m1:{...users.u3,id:'m1',gender:'male'} };
  for(const id of Object.keys(gu)){ userSockets.set(id,new Set(['s_'+id])); io.sockets.sockets.set('s_'+id,{}); }
  const mg=(id,pref)=>({userId:id,socketId:'s_'+id,user:gu[id],enqueuedAt:Date.now(),timeout:null,state:'WAITING',prefGender:pref});
  const wm=mg('m1','all'); const wf=mg('f1','female');
  X.voiceMatchQueue.push(wm,wf);
  assert.strictEqual(await X.tryMatchVoiceQueue(wf),false,'female wants female: male must not match');
  const wf2=mg('f2','female'); X.voiceMatchQueue.push(wf2);
  assert.strictEqual(await X.tryMatchVoiceQueue(wf2),true,'female+female match');
  const s8=[...X.activeVoiceMatchSessions.values()].pop();
  assert.deepStrictEqual([s8.userA.id,s8.userB.id].sort(),['f1','f2']);
  assert.strictEqual(X.voiceMatchQueue.length,1,'male still waiting');
  // الرجل يطلب «ذكر» والمنتظر أنثى بلا قيود → لا يتطابقان
  X.endVoiceMatchSession(s8.id,'ended'); X.voiceMatchQueue.length=0;
  const wf3=mg('f1','all'); const wm2=mg('m1','male'); X.voiceMatchQueue.push(wf3,wm2);
  assert.strictEqual(await X.tryMatchVoiceQueue(wm2),false,'male wants male, waiting is female');
});
