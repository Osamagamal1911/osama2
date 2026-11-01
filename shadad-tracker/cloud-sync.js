/* Shadad Split 2.0: offline-first Supabase account sync. No secret keys. */
(function(){
'use strict';
const AUTH_KEY=KEY+'_cloud_auth_v1', CONFIG_KEY=KEY+'_cloud_config_v1';
let auth=null,account=null,config=null,busy=false,pending=false,timer=0,status='local',message='',lastSync='';
const cloud=window.ShadadCloud={storageKey:KEY,localSaved:function(){if(account){pending=true;status='local';schedule()}},view:panel,isSignedIn:function(){return !!account}};
function lang(en,ar){return state.lang==='ar'?ar:en}
function read(k){try{return JSON.parse(localStorage.getItem(k))}catch{return null}}
function write(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}}
function escape(s){return esc(String(s==null?'':s))}
function configOk(o){if(!o)return null;const url=String(o.url||'').trim().replace(/\/+$/,'');const key=String(o.publishableKey||'').trim();try{const u=new URL(url);if(u.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/i.test(u.hostname)||u.pathname!=='/'||u.search||u.hash||!key.startsWith('sb_publishable_')||key.length<25)return null;return {url:url,publishableKey:key}}catch{return null}}
config=configOk(read(CONFIG_KEY))||configOk(window.SHADAD_CLOUD_CONFIG);
function valid(s){return !!(s&&s.version===1&&Array.isArray(s.sessions)&&Number.isInteger(s.nextSlot)&&s.nextSlot>=0&&s.nextSlot<=6)}
function populated(s){return !!(s&&(s.sessions||[]).length||s&&s.draft||s&&(s.restDays||[]).length)}
function moment(s){return Date.parse(s&&(s.updatedAt||s.completedAt||s.startedAt)||'')||0}
function clone(o){return JSON.parse(JSON.stringify(o))}
function merge(one,two){
 if(!valid(one))return valid(two)?clone(two):blankState();
 if(!valid(two))return clone(one);
 const a=clone(one),b=two,deleted=Object.assign({},b.deletedSessionIds||{});
 for(const id of Object.keys(a.deletedSessionIds||{})){const t=a.deletedSessionIds[id];if(!deleted[id]||Date.parse(t)>Date.parse(deleted[id]))deleted[id]=t}
 const map=new Map();
 for(const s of (b.sessions||[]).concat(a.sessions||[])){if(!s||typeof s.id!=='string'||!Number.isInteger(s.day))continue;const old=map.get(s.id);if(!old||moment(s)>=moment(old))map.set(s.id,s)}
 a.sessions=Array.from(map.values()).filter(s=>!deleted[s.id]||Date.parse(deleted[s.id])<moment(s)).sort((x,y)=>String(x.completedAt||x.startedAt||'').localeCompare(String(y.completedAt||y.startedAt||'')));
 a.deletedSessionIds=deleted;
 a.restDays=Array.from(new Set((a.restDays||[]).concat(b.restDays||[]))).sort();
 const t1=Date.parse(one.lastSavedAt||'')||0,t2=Date.parse(two.lastSavedAt||'')||0;
 a.nextSlot=t1>=t2?one.nextSlot:two.nextSlot;
 a.lastSavedAt=t1>=t2?one.lastSavedAt:two.lastSavedAt;
 if(!a.draft||(b.draft&&moment(b.draft)>moment(a.draft)))a.draft=b.draft?clone(b.draft):a.draft;
 if(a.draft&&a.sessions.some(s=>s.id===a.draft.id))a.draft=null;
 a.lastBackupCount=Math.max(one.lastBackupCount||0,two.lastBackupCount||0);
 a.lastBackupAt=one.lastBackupAt||two.lastBackupAt||null;
 a.lang=one.lang||two.lang||'en';
 return a;
}
function draw(){if(route==='settings')render()}
function tell(s){message=String(s||'');draw()}
function switchTo(session){
 const u=session&&session.user;if(!u||!/^[0-9a-f-]{36}$/i.test(u.id))throw Error('Invalid account identity');
 auth=session;
 if(!account||account.id!==u.id){account={id:u.id,email:String(u.email||'')};cloud.storageKey=KEY+'_account_'+u.id;state=valid(read(cloud.storageKey))?read(cloud.storageKey):blankState();status='local';render()}
 write(AUTH_KEY,auth);pending=true;schedule(100);
}
function logout(){
 // Retain the per-account local cache, but do not show it to other users.
 auth=null;account=null;pending=false;clearTimeout(timer);localStorage.removeItem(AUTH_KEY);
 cloud.storageKey=KEY;state=valid(read(KEY))?read(KEY):blankState();status='local';message='';lastSync='';render();
}
async function post(path,body,access){
 if(!config)throw Error('Cloud configuration is missing');
 const headers={'apikey':config.publishableKey,'Content-Type':'application/json'};
 if(access)headers.Authorization='Bearer '+access;
 const res=await fetch(config.url+path,{method:'POST',headers:headers,body:JSON.stringify(body)});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(data.error_description||data.message||data.msg||data.error||('HTTP '+res.status));
 return data;
}
async function accessToken(){
 if(!auth||!account)throw Error('Please sign in');
 if(Date.now()<(auth.expires_at_ms||0)-60000)return auth.access_token;
 if(!navigator.onLine)throw Error('Offline');
 const r=await post('/auth/v1/token?grant_type=refresh_token',{refresh_token:auth.refresh_token});
 if(r.user?.id!==account.id)throw Error('The authenticated user changed. Sign in again.');
 auth=Object.assign({},r,{expires_at_ms:Date.now()+(r.expires_in||3600)*1000});
 write(AUTH_KEY,auth);return auth.access_token;
}
async function database(path,method,body){
 const token=await accessToken();
 const opt={method:method||'GET',headers:{apikey:config.publishableKey,Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'}};
 if(body!==undefined)opt.body=JSON.stringify(body);
 const res=await fetch(config.url+'/rest/v1/'+path,opt);
 const json=await res.json().catch(()=>null);
 if(!res.ok)throw Error(json?.message||json?.hint||('Database HTTP '+res.status));
 return json;
}
function schedule(delay){
 clearTimeout(timer);
 if(!account||!config||!navigator.onLine)return;
 timer=setTimeout(sync,delay===undefined?1200:delay);
}
async function sync(){
 clearTimeout(timer);
 if(!account||!config||!navigator.onLine)return;
 if(busy){pending=true;return}
 busy=true;pending=false;status='syncing';draw();
 const identity=account.id;
 try{
  const rows=await database('shadad_workout_snapshots?select=payload,revision&user_id=eq.'+encodeURIComponent(identity));
  if(!account||account.id!==identity)return;
  let remote=rows&&rows[0]?rows[0].payload:null;
  let revision=rows&&rows[0]?rows[0].revision:null;
  let success=false;
  for(let i=0;i<5;i++){
   const combined=merge(state,remote);
   const required=!remote||JSON.stringify(combined)!==JSON.stringify(merge(remote,remote));
   if(required){
    const response=await database('rpc/shadad_save_snapshot','POST',{p_payload:combined,p_expected_revision:revision});
    if(!account||account.id!==identity)return;
    const r=response&&response[0];
    if(!r)throw Error('Database schema missing. Run supabase-schema.sql in Supabase.');
    if(!r.applied){remote=r.current_payload;revision=r.new_revision;continue}
    remote=combined;revision=r.new_revision;
   }
   state=merge(state,remote);write(cloud.storageKey,state);
   success=true;status='synced';lastSync=new Date().toISOString();message='';draw();break;
  }
  if(!success)throw Error('Another device changed the data repeatedly. Retry synchronization.');
 }catch(err){status=navigator.onLine?'error':'offline';message=String(err&&err.message||err);draw()}
 finally{busy=false;if(pending&&account)schedule(1000)}
}
async function login(mode,email,password){
 if(!config)return tell('Connect your Supabase project first.');
 if(!email||!password||password.length<6)return tell('Enter an email and a password (6+ characters).');
 if(!navigator.onLine)return tell('Offline. Sign in when connected to the internet.');
 if(busy)return;
 busy=true;
 try{
  const endpoint=mode==='signup'?'/auth/v1/signup':'/auth/v1/token?grant_type=password';
  const response=await post(endpoint,{email:email.trim(),password:password});
  if(response.access_token&&response.user&&response.user.id){
   switchTo(Object.assign({},response,{expires_at_ms:Date.now()+(response.expires_in||3600)*1000}));
   message='';
  }else tell(lang('Account created. Confirm your email and sign in.','تم إنشاء الحساب. أكد البريد الإلكتروني ثم سجل دخولك.'));
 }catch(err){tell(err&&err.message||String(err))}
 finally{busy=false;draw()}
}
function setConfig(){
 const c=configOk({url:document.getElementById('cloudUrl')?.value,publishableKey:document.getElementById('cloudKey')?.value});
 if(!c)return tell('Use https://PROJECT.supabase.co and an sb_publishable_ key. Do not use a secret key.');
 config=c;write(CONFIG_KEY,c);tell(lang('Cloud settings saved. Sign in below.','اتحفظت إعدادات السحابة. سجل دخولك دلوقتي.'));
}
function importGuest(){
 const guest=read(KEY);
 if(!account||!populated(guest))return;
 if(!confirm(lang('Import your previous guest workouts into this private account? The original guest history remains saved.','تستورد تمارينك السابقة إلى حسابك الخاص؟ السجل الأصلي هيفضل محفوظ.')))return;
 state=merge(state,guest);write(cloud.storageKey,state);
 pending=true;draw();schedule(50);
}
function panel(){
 const en=state.lang!=='ar',x=(a,b)=>escape(en?a:b);
 const statusText=!navigator.onLine?x('Offline — saving locally','من غير نت — الحفظ محلي'):
 status==='syncing'?x('Syncing…','بيزامن...'):status==='synced'?x('Cloud synced','تمت المزامنة'):
 status==='error'?x('Sync error — saved locally','خطأ في المزامنة — محفوظ محليًا'):x('Saved locally — waiting to sync','محفوظ محليًا — مستني المزامنة');
 const link='<a target="_blank" rel="noopener" href="https://github.com/Osamagamal1911/osama2/blob/main/shadad-tracker/CLOUD-SETUP.md">'+x('Setup guide','شرح الإعداد')+'</a>';
 let content='';
 if(!config)content='<p class="hint">'+x('You need a Supabase project and the database SQL schema before cloud sync can work.','لازم مشروع Supabase وتنفيذ ملف SQL قبل ما المزامنة تشتغل.')+' '+link+'</p>'+
 '<div class="field"><label>'+x('Project URL','رابط المشروع')+'</label><input id="cloudUrl" type="url" placeholder="https://xxxx.supabase.co"></div>'+
 '<div class="field"><label>'+x('Publishable key (public)','المفتاح العام')+'</label><input id="cloudKey" placeholder="sb_publishable_..."></div>'+
 '<button type="button" class="btn primary" data-cloud-action="configure">'+x('Save settings','حفظ الإعدادات')+'</button>';
 else if(!account)content='<form id="shadadCloudLogin"><div class="field"><label>'+x('Email','البريد الإلكتروني')+'</label><input type="email" name="cloudEmail" autocomplete="email" required></div>'+
 '<div class="field"><label>'+x('Password','كلمة المرور')+'</label><input type="password" name="cloudPassword" minlength="6" autocomplete="current-password" required></div>'+
 '<div class="row hspace"><button type="submit" class="btn primary" data-mode="login">'+x('Sign in','تسجيل دخول')+'</button><button type="submit" class="btn ghost" data-mode="signup">'+x('Create account','إنشاء حساب')+'</button></div></form>'+
 '<p class="hint hspace">'+x('Account data is private. Email confirmation may be required.','البيانات خاصة بحسابك. قد تحتاج تأكيد الإيميل.')+' '+link+'</p>'+
 '<button type="button" class="btn ghost small" data-cloud-action="change-config">'+x('Change cloud settings','تغيير الإعدادات')+'</button>';
 else content='<p>'+x('Account','الحساب')+': <b>'+escape(account.email)+'</b></p>'+
 '<span class="pill '+(status==='synced'?'green':'')+'">'+statusText+'</span>'+
 (lastSync?'<p class="hint">'+escape(new Date(lastSync).toLocaleString())+'</p>':'')+
 '<div class="row hspace"><button type="button" class="btn primary" data-cloud-action="sync">'+x('Sync now','مزامنة الآن')+'</button>'+
 '<button type="button" class="btn ghost" data-cloud-action="logout">'+x('Sign out','تسجيل خروج')+'</button></div>'+
 (populated(read(KEY))?'<p class="hint hspace">'+x('Old guest workouts are not uploaded without your consent.','تمارين ما قبل تسجيل الدخول مش هتترفع من غير موافقتك.')+'</p><button type="button" class="btn ghost" data-cloud-action="import">'+x('Import guest workouts','استيراد التمارين القديمة')+'</button>':'');
 return '<div class="card section" id="shadadCloud"><h3>'+x('Private cloud backup & sync','مزامنة سحابية خاصة')+'</h3><p class="muted">'+x('Your workouts save immediately on this device, and sync privately when online.','تمارينك بتتحفظ على الجهاز فورًا وتزامن مع حسابك لما النت يرجع.')+'</p>'+content+
 (message?'<p class="hint hspace" role="status">'+escape(message)+'</p>':'')+
 '<p class="hint hspace">'+x('Keep JSON backups. The browser cache is not a guaranteed permanent backup.','احتفظ بنسخ JSON احتياطية. بيانات المتصفح وحدها مش ضمان دائم.')+'</p></div>';
}
document.addEventListener('submit',function(e){
 if(e.target?.id!=='shadadCloudLogin')return;
 e.preventDefault();const form=e.target,mode=e.submitter?.dataset?.mode||'login';
 login(mode,form.elements.cloudEmail.value,form.elements.cloudPassword.value);
});
document.addEventListener('click',function(e){
 const el=e.target.closest('[data-cloud-action]');if(!el)return;
 e.preventDefault();
 switch(el.dataset.cloudAction){
 case 'configure':setConfig();break;
 case 'change-config':config=null;localStorage.removeItem(CONFIG_KEY);tell('');break;
 case 'sync':pending=true;schedule(10);break;
 case 'logout':logout();break;
 case 'import':importGuest();break;
 }
});
window.addEventListener('online',function(){if(account){pending=true;schedule(100)}draw()});
window.addEventListener('offline',draw);
document.addEventListener('visibilitychange',function(){if(!document.hidden&&account){pending=true;schedule(100)}});
const stored=read(AUTH_KEY);
if(config&&stored?.user?.id&&stored.refresh_token){try{switchTo(stored)}catch(e){logout()}}
draw();
})();