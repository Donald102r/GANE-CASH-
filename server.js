const express=require('express');
const session=require('express-session');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const bcrypt=require('bcryptjs');
const Database=require('better-sqlite3');
const path=require('path');
const crypto=require('crypto');

const app=express();
const db=new Database(process.env.DB_FILE || 'gagne-cash.sqlite');
const PORT=process.env.PORT || 3000;
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||'').toLowerCase();
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'';
const SESSION_SECRET=process.env.SESSION_SECRET;
if(!SESSION_SECRET || SESSION_SECRET.length<32) {
  console.error('Configure SESSION_SECRET (au moins 32 caractères).'); process.exit(1);
}
if(!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Configure ADMIN_EMAIL et ADMIN_PASSWORD avant le démarrage.'); process.exit(1);
}
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, referral_code TEXT UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS referrals(id INTEGER PRIMARY KEY, referrer_id INTEGER NOT NULL, referred_user_id INTEGER UNIQUE NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(referrer_id) REFERENCES users(id), FOREIGN KEY(referred_user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, reward INTEGER NOT NULL CHECK(reward>0), active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, task_id INTEGER NOT NULL, proof TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(task_id) REFERENCES tasks(id));
CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS withdrawals(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL, phone TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id));
`);
try { db.exec("ALTER TABLE users ADD COLUMN referral_code TEXT"); } catch(e) {}
const count=db.prepare('SELECT COUNT(*) n FROM tasks').get().n;
if(!count) {
 const ins=db.prepare('INSERT INTO tasks(title,description,reward) VALUES(?,?,?)');
 ins.run('Découverte du site','Lisez les règles de la plateforme et envoyez le mot CASH dans la preuve.',100);
 ins.run('Mini-sondage','Indiquez en quelques mots quel type de missions vous intéresse.',150);
 ins.run('Avis utilisateur','Proposez une amélioration utile pour GAGNE CASH.',200);
}
app.use(helmet({contentSecurityPolicy:{directives:{"default-src":["'self'"],"style-src":["'self'","'unsafe-inline'"],"script-src":["'self'"],"img-src":["'self'","data:"]}}}));
app.use(express.json({limit:'20kb'}));
app.use(session({name:'gc.sid',secret:SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}}));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:120,standardHeaders:true,legacyHeaders:false}));
app.use(express.static(path.join(__dirname,'public')));
const getUser=(req)=>req.session.user||null;
const auth=(req,res,next)=>{if(!getUser(req))return res.status(401).json({error:'Connexion requise'});next();};
const admin=(req,res,next)=>{if(!getUser(req)?.admin)return res.status(403).json({error:'Accès administrateur refusé'});next();};
const balance=id=>db.prepare('SELECT COALESCE(SUM(amount),0) amount FROM ledger WHERE user_id=?').get(id).amount;
app.post('/api/register',async(req,res)=>{
 const {name,email,password}=req.body||{};
 if(!name||name.trim().length<2||!email||!/^.+@.+\..+$/.test(email)||!password||password.length<10) return res.status(400).json({error:'Nom, e-mail valide et mot de passe de 10 caractères minimum requis.'});
 try {
  const refCode=String(req.body.ref||'').trim().slice(0,40);
  const referrer=refCode?db.prepare('SELECT id FROM users WHERE referral_code=?').get(refCode):null;
  const code=crypto.randomBytes(5).toString('hex').toUpperCase();
  const info=db.prepare('INSERT INTO users(name,email,password,referral_code) VALUES(?,?,?,?)').run(name.trim().slice(0,80),email.toLowerCase(),await bcrypt.hash(password,12),code);
  if(referrer && referrer.id!==Number(info.lastInsertRowid)) db.prepare('INSERT INTO referrals(referrer_id,referred_user_id) VALUES(?,?)').run(referrer.id,Number(info.lastInsertRowid));
  req.session.user={id:Number(info.lastInsertRowid),name:name.trim(),email:email.toLowerCase(),admin:false};
  res.json({ok:true,user:req.session.user});
 } catch(e){res.status(409).json({error:'Cette adresse e-mail est déjà utilisée.'});}
});
app.post('/api/login',async(req,res)=>{
 const {email,password}=req.body||{};
 const user=db.prepare('SELECT * FROM users WHERE email=?').get(String(email||'').toLowerCase());
 if(!user||!await bcrypt.compare(password||'',user.password))return res.status(401).json({error:'Identifiants incorrects.'});
 req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Erreur de session'});req.session.user={id:user.id,name:user.name,email:user.email,admin:false};res.json({ok:true,user:req.session.user});});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',(req,res)=>{const u=getUser(req);res.json({user:u,balance:u?balance(u.id):0});});
app.get('/api/referral',auth,(req,res)=>{
 const u=db.prepare('SELECT referral_code FROM users WHERE id=?').get(req.session.user.id);
 const stats=db.prepare("SELECT COUNT(*) total, SUM(status='approved') approved, SUM(status='pending') pending FROM referrals WHERE referrer_id=?").get(req.session.user.id);
 res.json({code:u.referral_code,stats});
});
app.get('/api/tasks',auth,(req,res)=>res.json(db.prepare('SELECT id,title,description,reward FROM tasks WHERE active=1 ORDER BY id DESC').all()));
app.post('/api/submit',auth,(req,res)=>{
 const {taskId,proof}=req.body||{};
 const task=db.prepare('SELECT * FROM tasks WHERE id=? AND active=1').get(Number(taskId));
 if(!task||typeof proof!=='string'||proof.trim().length<8||proof.length>1500)return res.status(400).json({error:'Mission ou preuve invalide (8 à 1500 caractères).'});
 const exists=db.prepare("SELECT id FROM submissions WHERE user_id=? AND task_id=? AND status IN ('pending','approved')").get(req.session.user.id,task.id);
 if(exists)return res.status(409).json({error:'Vous avez déjà soumis cette mission.'});
 db.prepare('INSERT INTO submissions(user_id,task_id,proof) VALUES(?,?,?)').run(req.session.user.id,task.id,proof.trim());
 res.json({ok:true,message:'Preuve envoyée. La mission sera vérifiée par l’équipe.'});
});
app.get('/api/history',auth,(req,res)=>{
 const id=req.session.user.id;
 res.json({ledger:db.prepare('SELECT amount,reason,created_at FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 50').all(id),
 withdrawals:db.prepare('SELECT amount,method,phone,status,created_at FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 30').all(id)});
});
app.post('/api/withdraw',auth,(req,res)=>{
 const {amount,method,phone}=req.body||{};
 const allowed=['TMoney','Flooz','Mobile Money'];
 const n=Number(amount);
 if(!Number.isInteger(n)||n<5000||!allowed.includes(method)||typeof phone!=='string'||phone.trim().length<8||phone.length>30)return res.status(400).json({error:'Retrait minimum : 5 000 FCFA. Vérifiez le moyen et le numéro.'});
 const run=db.transaction(()=>{
  const pending=db.prepare("SELECT COALESCE(SUM(amount),0) n FROM withdrawals WHERE user_id=? AND status='pending'").get(req.session.user.id).n;
  if(balance(req.session.user.id)-pending<n)throw new Error('Solde disponible insuffisant.');
  db.prepare('INSERT INTO withdrawals(user_id,amount,method,phone) VALUES(?,?,?,?)').run(req.session.user.id,n,method,phone.trim());
 });
 try{run();res.json({ok:true,message:'Demande enregistrée. Le paiement reste en attente de validation.'});}catch(e){res.status(400).json({error:e.message});}
});
app.get('/api/admin/referrals',auth,admin,(req,res)=>res.json(db.prepare("SELECT r.id,r.created_at,u.name,u.email,v.name referred_name,v.email referred_email FROM referrals r JOIN users u ON u.id=r.referrer_id JOIN users v ON v.id=r.referred_user_id WHERE r.status='pending' ORDER BY r.id").all()));
app.post('/api/admin/referrals/:id/approve',auth,admin,(req,res)=>{
 const r=db.prepare("SELECT * FROM referrals WHERE id=? AND status='pending'").get(Number(req.params.id));
 if(!r)return res.status(404).json({error:'Parrainage introuvable.'});
 const tx=db.transaction(()=>{db.prepare("UPDATE referrals SET status='approved' WHERE id=?").run(r.id);db.prepare("INSERT INTO ledger(user_id,amount,reason) VALUES(?,?,?)").run(r.referrer_id,1000,'Inscription parrainée validée');});
 tx();res.json({ok:true});
});
app.post('/api/admin/referrals/:id/reject',auth,admin,(req,res)=>{
 const info=db.prepare("UPDATE referrals SET status='rejected' WHERE id=? AND status='pending'").run(Number(req.params.id));
 if(!info.changes)return res.status(404).json({error:'Parrainage introuvable.'});res.json({ok:true});
});
app.get('/api/admin/submissions',auth,admin,(req,res)=>res.json(db.prepare(`SELECT s.id,s.proof,s.created_at,u.name,u.email,t.title,t.reward FROM submissions s JOIN users u ON u.id=s.user_id JOIN tasks t ON t.id=s.task_id WHERE s.status='pending' ORDER BY s.id`).all()));
app.post('/api/admin/submissions/:id/approve',auth,admin,(req,res)=>{
 const s=db.prepare("SELECT s.*,t.reward FROM submissions s JOIN tasks t ON t.id=s.task_id WHERE s.id=? AND s.status='pending'").get(Number(req.params.id));
 if(!s)return res.status(404).json({error:'Soumission introuvable.'});
 const tx=db.transaction(()=>{db.prepare("UPDATE submissions SET status='approved' WHERE id=?").run(s.id);db.prepare('INSERT INTO ledger(user_id,amount,reason) VALUES(?,?,?)').run(s.user_id,s.reward,'Mission validée');});
 tx();res.json({ok:true});
});
app.post('/api/admin/submissions/:id/reject',auth,admin,(req,res)=>{
 const info=db.prepare("UPDATE submissions SET status='rejected' WHERE id=? AND status='pending'").run(Number(req.params.id));
 if(!info.changes)return res.status(404).json({error:'Soumission introuvable.'});res.json({ok:true});
});
app.get('/api/admin/withdrawals',auth,admin,(req,res)=>res.json(db.prepare("SELECT w.*,u.name,u.email FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.status='pending' ORDER BY w.id").all()));
app.post('/api/admin/withdrawals/:id/paid',auth,admin,(req,res)=>{
 const info=db.prepare("UPDATE withdrawals SET status='paid' WHERE id=? AND status='pending'").run(Number(req.params.id));
 if(!info.changes)return res.status(404).json({error:'Demande introuvable.'});res.json({ok:true});
});
app.post('/api/admin/withdrawals/:id/reject',auth,admin,(req,res)=>{
 const info=db.prepare("UPDATE withdrawals SET status='rejected' WHERE id=? AND status='pending'").run(Number(req.params.id));
 if(!info.changes)return res.status(404).json({error:'Demande introuvable.'});res.json({ok:true});
});
app.listen(PORT,()=>console.log(`GAGNE CASH disponible sur le port ${PORT}`));
