"use strict";

/* ---------- basis ---------- */
const MONTHS=["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
const DOW=["ma","di","wo","do","vr","za","zo"];
const KEY="budget_v8";
const THEMES=["system","light","dark"];
/* na zoveel dagen zonder export vraagt de app er in de instellingen om */
const EXPORT_STALE_DAYS=30;

const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,"0");
const ymKey=(y,m)=>y+"_"+pad(m+1);
function ymParse(k){const p=k.split("_");return{y:+p[0],m:+p[1]-1};}
function ymShift(k,d){const p=ymParse(k);const x=new Date(p.y,p.m+d,1);return ymKey(x.getFullYear(),x.getMonth());}
function ymLabel(k){const p=ymParse(k);return MONTHS[p.m]+" "+p.y;}
function ymOfDate(d){return ymKey(d.getFullYear(),d.getMonth());}
const isoOf=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const fromISO=s=>s?new Date(s+"T00:00"):null;
function startOfDay(d){const x=new Date(d);x.setHours(0,0,0,0);return x;}

let NOW=startOfDay(new Date());
let TODAY_YM=ymOfDate(NOW);
let view=TODAY_YM;

function eur(n){return (n<0?"−":"")+"€"+Math.abs(n).toLocaleString("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2});}
function eurBig(n){
  const s=Math.abs(n).toLocaleString("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2}).split(",");
  return (n<0?"−":"")+"€"+s[0]+'<span class="cents">,'+s[1]+"</span>";
}
function parseAmt(v){
  if(typeof v==="number")return v;
  const s=String(v).replace(/\s|€/g,"").replace(/\.(?=\d{3}\b)/g,"").replace(",",".");
  const n=parseFloat(s);
  return isNaN(n)?null:Math.round(n*100)/100;
}
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function dayLabel(d){return d.getDate()+" "+MONTHS[d.getMonth()].slice(0,3);}
/* getal naar de komma-notatie die de invoervelden verwachten */
const toInput=n=>(n===null||n===undefined||n==="")?"":String(n).replace(".",",");
/* "€ 1.200,00  ·  € 40,00 contant", of alleen het totaal als er geen contant deel is */
const withCash=(total,cash,suffix)=>cash>0?eur(total)+"  ·  "+eur(cash)+suffix:eur(total);

/* ---------- startgegevens ---------- */
function seed(){return{
  v:8,
  theme:"system",
  lastExport:null,
  income:[],
  expenses:[],
  categories:[
    {id:"c_bood",label:"Boodschappen",budget:0},
    {id:"c_uit",label:"Uitgaan",budget:0},
    {id:"c_verv",label:"Vervoer",budget:0},
    {id:"c_rest",label:"Overig",budget:0}
  ],
  savings:[],
  months:{}
}}

const blankMonth=()=>({start:null,paid:{},recv:{},exc:{},skip:{},oneoff:[],tx:[]});

/* zet rehomeTx als er echt iets verhuisd is, zodat de schijf ook bijtrekt
   en een export de nieuwe indeling meeneemt */
let migrated=false;
let loadFailed=false;
let state=load();
if(migrated)save();

function load(){
  let raw=null;
  try{raw=localStorage.getItem(KEY);}catch(e){}
  if(!raw)return seed();
  try{
    return fix(JSON.parse(raw));
  }catch(e){
    /* Nooit stilletjes met een lege app verder: dan denkt iemand dat zijn
       gegevens weg zijn en schrijft de eerstvolgende bewerking ze echt weg. */
    loadFailed=true;
    return seed();
  }
}
function fix(d){
  d.income=d.income||[];d.expenses=d.expenses||[];
  d.categories=d.categories||[];d.savings=d.savings||[];d.months=d.months||{};
  if(!THEMES.includes(d.theme))d.theme="system";
  if(typeof d.lastExport!=="string")d.lastExport=null;
  d.expenses.forEach(e=>{if(!e.pay)e.pay="digital";});
  d.savings.forEach(sv=>{
    if(!sv.kind)sv.kind="free";
    if(sv.kind==="term"){sv.deposits=sv.deposits||[];sv.termMonths=sv.termMonths||12;}
    /* vrij opneembare rekeningen houden losse bij- en afboekingen bij, zodat
       geld dat naar sparen gaat ook echt uit je beschikbare saldo verdwijnt */
    else sv.movements=sv.movements||[];
  });
  Object.keys(d.months).forEach(k=>{
    const m=d.months[k];
    m.oneoff=m.oneoff||[];m.tx=m.tx||[];
    /* vlaggenlijsten aanvullen: een geïmporteerd bestand mag ze missen */
    m.paid=m.paid||{};m.recv=m.recv||{};m.exc=m.exc||{};m.skip=m.skip||{};
    m.oneoff.forEach(o=>{if(!o.pay)o.pay=o.ckind||"digital";});
    m.tx.forEach(t=>{if(!t.pay)t.pay="digital";});
    if(typeof m.start==="number")m.start={d:m.start,c:0};
  });
  rehomeTx(d);
  return d;
}
/* Boekingen hoorden vroeger bij de maand die je toevallig openhad, niet bij
   hun eigen datum. Zet ze alsnog in de juiste maand; draait bij elke lading
   en doet daarna niets meer. */
function rehomeTx(d){
  const moves=[];
  Object.keys(d.months).forEach(k=>{
    d.months[k].tx=d.months[k].tx.filter(t=>{
      if(!t.date)return true;
      const home=ymOfDate(fromISO(t.date));
      if(home===k)return true;
      moves.push({home:home,tx:t});
      return false;
    });
  });
  moves.forEach(mv=>{
    if(!d.months[mv.home])d.months[mv.home]=blankMonth();
    d.months[mv.home].tx.push(mv.tx);
  });
  if(moves.length)migrated=true;
}
function save(){
  try{localStorage.setItem(KEY,JSON.stringify(state));}
  catch(e){toast("Opslaan lukt niet. De opslag is vol of je bent in privémodus.",null);}
}
function readM(k){return state.months[k]||blankMonth();}
function editM(k){if(!state.months[k])state.months[k]=blankMonth();return state.months[k];}

/* ---------- datums ---------- */
function dayInMonth(k,day,shift){
  const p=ymParse(k);
  const last=new Date(p.y,p.m+1,0).getDate();
  let d=new Date(p.y,p.m,Math.min(day,last));
  if(shift){const w=d.getDay();if(w===6)d=new Date(p.y,p.m,d.getDate()+2);else if(w===0)d=new Date(p.y,p.m,d.getDate()+1);}
  return d;
}
function addMonths(d,n){
  const x=new Date(d.getFullYear(),d.getMonth()+n,d.getDate());
  if(x.getDate()!==d.getDate())x.setDate(0);
  return x;
}
function depositsOf(sv){return (sv.kind==="term")?(sv.deposits||[]):[];}
function movementsOf(sv){return (sv.kind==="term")?[]:(sv.movements||[]);}
/* elke geldstroom van of naar een spaarrekening, met teken: bij een vaste
   termijn zijn dat de stortingen, bij een vrije rekening de bij- en
   afboekingen. Alleen deze tellen mee in de maandberekening. */
function flowsOf(sv){return sv.kind==="term"?depositsOf(sv):movementsOf(sv);}
function savBalance(sv){
  if(sv.kind==="term")return depositsOf(sv).reduce((s,x)=>s+x.amount,0);
  return sv.amount||0;
}
function savSplit(sv){
  /* vastgezet versus al vrijgekomen */
  let locked=0,free=0,next=null;
  depositsOf(sv).forEach(dp=>{
    const m=addMonths(fromISO(dp.date),sv.termMonths||12);
    if(startOfDay(m)<=NOW)free+=dp.amount;
    else{locked+=dp.amount;if(!next||m<next.date)next={date:m,amount:dp.amount};}
  });
  return{locked:locked,free:free,next:next};
}
function fullDate(d){return d.getDate()+" "+MONTHS[d.getMonth()]+" "+d.getFullYear();}
function effDate(k,item){
  const m=readM(k);
  if(m.exc&&m.exc[item.id])return fromISO(m.exc[item.id]);
  if(item.day)return dayInMonth(k,item.day,item.shift);
  return null;
}

/* ---------- berekening ---------- */
function hasStart(k){
  const m=state.months[k];
  return !!(m&&m.start!==null&&m.start!==undefined);
}
/* vroegste maand waarvan iets is vastgelegd; de sleutels zijn
   "jjjj_mm" met voorloopnul, dus gewoon vergelijken werkt */
function firstMonth(){
  const keys=Object.keys(state.months);
  return keys.length?keys.reduce((a,b)=>a<b?a:b):null;
}
function startBalance(k,depth){
  depth=depth||0;
  if(hasStart(k)){const s=state.months[k].start;return{d:s.d||0,c:s.c||0};}
  if(depth>24)return{d:0,c:0};
  const prev=ymShift(k,-1);
  /* Vóór de eerste vastgelegde maand valt niets door te rekenen, dus daar
     stopt de keten. Erná telt elke maand mee, ook een maand zonder eigen
     gegevens: die draagt de vaste lasten en inkomsten gewoon door. Zonder
     dat laatste stond elke maand verder dan één vooruit op nul. */
  const first=firstMonth();
  if(!first||prev<first)return{d:0,c:0};
  return endBalance(prev,depth+1);
}
function endBalance(k,depth){
  const c=calc(k,depth);
  return{d:c.start.d+c.incExpD-c.fixPlanD-c.varD-c.savD,c:c.start.c+c.incExpC-c.fixPlanC-c.varC-c.savC};
}
function calc(k,depth){
  const m=readM(k);
  const past=k<TODAY_YM, future=k>TODAY_YM;

  const inc=[];
  state.income.forEach(it=>{
    if(m.skip[it.id])return;
    const d=effDate(k,it);
    let got;
    if(d) got = past || (!future && startOfDay(d)<=NOW);
    else  got = !!m.recv[it.id];
    inc.push({ref:it,id:it.id,label:it.label,amount:it.amount,date:d,kind:it.kind,got:got,manual:!d,rec:true,exc:!!m.exc[it.id]});
  });
  m.oneoff.filter(o=>o.kind==="income").forEach(o=>{
    const d=fromISO(o.date);
    inc.push({ref:o,id:o.id,label:o.label,amount:o.amount,date:d,kind:o.ckind||"digital",got:past||(!future&&d&&startOfDay(d)<=NOW),manual:false,rec:false,exc:false});
  });
  inc.sort((a,b)=>(a.date?a.date.getTime():9e15)-(b.date?b.date.getTime():9e15));

  const exp=[];
  state.expenses.forEach(it=>{
    if(m.skip[it.id])return;
    exp.push({ref:it,id:it.id,label:it.label,amount:it.amount,date:effDate(k,it),paid:!!m.paid[it.id],rec:true,exc:!!m.exc[it.id],pay:it.pay||"digital"});
  });
  m.oneoff.filter(o=>o.kind==="expense").forEach(o=>{
    exp.push({ref:o,id:o.id,label:o.label,amount:o.amount,date:fromISO(o.date),paid:!!m.paid[o.id],rec:false,exc:false,pay:o.pay||"digital"});
  });
  exp.sort((a,b)=>(a.date?a.date.getTime():9e15)-(b.date?b.date.getTime():9e15));

  const sum=(a,f)=>a.reduce((s,x)=>s+(f(x)?x.amount:0),0);
  const D=x=>(x.kind||x.pay)!=="cash", C=x=>(x.kind||x.pay)==="cash";
  const incExpD=sum(inc,D), incExpC=sum(inc,C);
  const incGotD=sum(inc,x=>x.got&&D(x)), incGotC=sum(inc,x=>x.got&&C(x));
  const fixPlanD=sum(exp,D), fixPlanC=sum(exp,C);
  const fixPaidD=sum(exp,x=>x.paid&&D(x)), fixPaidC=sum(exp,x=>x.paid&&C(x));
  const varD=m.tx.reduce((s,t)=>s+(t.pay==="cash"?0:t.amount),0);
  const varC=m.tx.reduce((s,t)=>s+(t.pay==="cash"?t.amount:0),0);
  let savD=0,savC=0,savMonth=0;
  state.savings.forEach(sv=>flowsOf(sv).forEach(fl=>{
    const dd=fromISO(fl.date);
    if(!dd||ymOfDate(dd)!==k)return;
    savMonth+=fl.amount;
    if(fl.pay==="cash")savC+=fl.amount;else savD+=fl.amount;
  }));
  const start=startBalance(k,depth||0);

  const incExpected=incExpD+incExpC, incGot=incGotD+incGotC;
  const fixPlanned=fixPlanD+fixPlanC, fixPaid=fixPaidD+fixPaidC, varSpent=varD+varC;
  const availD=start.d+incGotD-fixPaidD-varD-savD, availC=start.c+incGotC-fixPaidC-varC-savC;
  const freeD=start.d+incExpD-fixPlanD-varD-savD, freeC=start.c+incExpC-fixPlanC-varC-savC;

  return{
    inc,exp,tx:m.tx.slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")),
    start,incExpected,incGot,fixPlanned,fixPaid,varSpent,
    incExpD,incExpC,fixPlanD,fixPlanC,varD,varC,savD,savC,savMonth,
    availD,availC,freeD,freeC,
    available:availD+availC,
    free:freeD+freeC,
    outstanding:fixPlanned-fixPaid,
    incoming:incExpected-incGot
  };
}

/* ---------- render ---------- */
function render(){
  const k=view, c=calc(k), m=readM(k);
  const p=ymParse(k);

  $("today").textContent=NOW.getDate()+" "+MONTHS[NOW.getMonth()];
  $("mname").innerHTML=MONTHS[p.m]+'<span class="yr num">'+p.y+"</span>";
  $("jumpNow").style.display=(k===TODAY_YM)?"none":"inline-block";

  $("heroLbl").textContent=(k===TODAY_YM)?"Beschikbaar nu":(k<TODAY_YM?"Eindsaldo van die maand":"Verwacht beschikbaar");
  const live=(k===TODAY_YM);
  const heroVal=live?c.available:c.free;
  $("heroBig").innerHTML=eurBig(heroVal);
  $("heroBig").className="big num"+(heroVal<0?" neg":"");
  const dv=live?c.availD:c.freeD, cv=live?c.availC:c.freeC;
  setAmount($("sDig"),dv);
  setAmount($("sCash"),cv);
  setAmount($("sFree"),c.free);

  const fixPct=c.fixPlanned>0?Math.min(100,c.fixPaid/c.fixPlanned*100):0;
  $("mFix").style.width=fixPct+"%";
  $("mFixTxt").textContent=eur(c.fixPaid)+" van "+eur(c.fixPlanned);

  const budgetTotal=state.categories.reduce((s,x)=>s+(x.budget||0),0);
  const varWrap=$("mVarWrap");
  if(budgetTotal>0){
    varWrap.style.display="";
    const vp=Math.min(100,c.varSpent/budgetTotal*100);
    const el=$("mVar");
    el.style.width=vp+"%";el.className="fill"+(c.varSpent>budgetTotal?" over":"");
    $("mVarTxt").textContent=eur(c.varSpent)+" van "+eur(budgetTotal);
  }else{
    varWrap.style.display="none";
  }

  /* inkomsten */
  const got=c.inc.filter(x=>x.got), wait=c.inc.filter(x=>!x.got);
  let h="";
  if(got.length){
    h+='<div class="glabel"><span>Binnen</span><span class="num">'+eur(c.incGot)+"</span></div>";
    got.forEach(x=>h+=incRow(x,true));
  }
  if(wait.length){
    h+='<div class="glabel"><span>Nog te komen</span><span class="num">'+eur(c.incoming)+"</span></div>";
    wait.forEach(x=>h+=incRow(x,false));
  }
  h+=skippedRows(state.income.filter(i=>m.skip[i.id]),"income");
  $("incList").innerHTML=h||'<div class="empty">Nog geen inkomsten. Voeg je eerste bron toe.</div>';
  $("incTot").textContent=withCash(c.incExpected,c.incExpC," contant");

  /* vaste lasten */
  const recu=c.exp.filter(x=>x.rec), once=c.exp.filter(x=>!x.rec);
  h="";
  if(recu.length){
    h+='<div class="glabel"><span>Elke maand</span><span class="num">'+eur(recu.reduce((s,x)=>s+x.amount,0))+"</span></div>";
    recu.forEach(x=>h+=expRow(x));
  }
  if(once.length){
    h+='<div class="glabel"><span>Alleen deze maand</span><span class="num">'+eur(once.reduce((s,x)=>s+x.amount,0))+"</span></div>";
    once.forEach(x=>h+=expRow(x));
  }
  h+=skippedRows(state.expenses.filter(e=>m.skip[e.id]),"expense");
  $("expList").innerHTML=h||'<div class="empty">Nog geen vaste lasten. Voeg je eerste maandelijkse last toe.</div>';
  $("expTot").textContent=withCash(c.fixPlanned,c.fixPlanC," contant");

  /* categorieën */
  const perCat={};
  m.tx.forEach(t=>{perCat[t.cat]=(perCat[t.cat]||0)+t.amount;});
  h="";
  state.categories.forEach(cat=>{
    const spent=perCat[cat.id]||0;
    const pct=cat.budget>0?Math.min(100,spent/cat.budget*100):0;
    h+='<div class="cat" data-edit="cat" data-id="'+cat.id+'">'+
      '<div class="line1"><span>'+esc(cat.label)+'</span><span class="spent num">'+eur(spent)+
      (cat.budget>0?' <span class="of">van '+eur(cat.budget)+"</span>":' <span class="of">geen budget</span>')+"</span></div>"+
      (cat.budget>0?'<div class="track"><div class="fill'+(spent>cat.budget?" over":"")+'" style="width:'+pct+'%"></div></div>':"")+
      "</div>";
  });
  $("catList").innerHTML=h;
  $("varTot").textContent=withCash(c.varSpent,c.varC," contant");

  const catSel=$("txCat");
  const keep=catSel.value;
  catSel.innerHTML=state.categories.map(x=>'<option value="'+x.id+'">'+esc(x.label)+"</option>").join("");
  if(keep&&state.categories.some(x=>x.id===keep))catSel.value=keep;

  h="";
  if(c.tx.length){
    h+='<div class="glabel"><span>Geboekt</span><span class="num">'+eur(c.varSpent)+"</span></div>";
    c.tx.forEach(t=>{
      const cat=state.categories.find(x=>x.id===t.cat);
      const d=fromISO(t.date);
      h+='<div class="row"><div class="rinfo"><div class="rname">'+esc(t.label)+'</div><div class="rsub">'+
        (cat?esc(cat.label):"zonder categorie")+(d?" · "+dayLabel(d):"")+(t.pay==="cash"?" · contant":"")+"</div></div>"+
        '<div class="ramt num">'+eur(t.amount)+'</div><button class="x" data-del="tx" data-id="'+t.id+'" aria-label="Verwijder">×</button></div>';
    });
  }
  $("txList").innerHTML=h;

  /* sparen */
  h="";let savSum=0;
  state.savings.forEach(sv=>{
    const bal=savBalance(sv);
    savSum+=bal;
    const pct=sv.goal>0?Math.min(100,bal/sv.goal*100):0;
    h+='<div class="sav">'+
      '<div class="line1" data-edit="sav" data-id="'+sv.id+'"><span class="nm">'+esc(sv.label)+
      (sv.kind==="term"?' <span class="tag exc">'+(sv.termMonths||12)+" mnd vast</span>":"")+
      '</span><span class="bal num">'+eur(bal)+"</span></div>";
    if(sv.goal>0){
      h+='<div class="track"><div class="fill" style="width:'+pct+'%"></div></div><div class="goal num">'+Math.round(pct)+"% van "+eur(sv.goal)+"</div>";
    }
    if(sv.kind==="term"){
      const sp=savSplit(sv);
      let meta="";
      if(sp.next)meta+="Eerstvolgende vrijval "+fullDate(sp.next.date)+" ("+eur(sp.next.amount)+")";
      else if(!depositsOf(sv).length)meta+="Nog geen stortingen";
      if(sp.free>0)meta+=(meta?" · ":"")+eur(sp.free)+" vrijgekomen";
      h+='<div class="meta">'+meta+"</div>";
      const deps=depositsOf(sv).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
      if(deps.length){
        h+='<div class="deps">';
        deps.forEach(dp=>{
          const dd=fromISO(dp.date), mt=addMonths(dd,sv.termMonths||12);
          const done=startOfDay(mt)<=NOW;
          h+='<div class="dep"><div class="di">'+dayLabel(dd)+" "+dd.getFullYear()+
            (dp.pay==="cash"?' <span class="tag cash">contant</span>':"")+
            '<div class="dm">'+(done?"vrijgekomen op ":"vrij op ")+fullDate(mt)+"</div></div>"+
            '<div class="da num">'+eur(dp.amount)+"</div>"+
            '<button class="x" data-deldep="'+sv.id+'" data-id="'+dp.id+'" aria-label="Verwijder storting">×</button></div>';
        });
        h+="</div>";
      }
      h+='<button class="depadd" data-newdep="'+sv.id+'">Storting toevoegen</button>';
    }else{
      const mv=movementsOf(sv).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
      if(mv.length){
        h+='<div class="deps">';
        mv.forEach(fl=>{
          const dd=fromISO(fl.date);
          h+='<div class="dep"><div class="di">'+dayLabel(dd)+" "+dd.getFullYear()+
            (fl.pay==="cash"?' <span class="tag cash">contant</span>':"")+
            '<div class="dm">'+(fl.amount<0?"opgenomen":"ingelegd")+"</div></div>"+
            '<div class="da num'+(fl.amount<0?" neg":"")+'">'+eur(fl.amount)+"</div>"+
            '<button class="x" data-deldep="'+sv.id+'" data-id="'+fl.id+'" aria-label="Verwijder boeking">×</button></div>';
        });
        h+="</div>";
      }
      h+='<button class="depadd" data-newdep="'+sv.id+'">Inleg of opname boeken</button>';
    }
    h+="</div>";
  });
  $("savList").innerHTML=h||'<div class="empty">Nog geen spaardoel. Voeg er een toe, vrij opneembaar of met een vaste looptijd.</div>';
  /* deze maand kan ook negatief zijn, dan is er netto geld uit sparen gehaald */
  $("savTot").textContent=c.savMonth===0
    ? eur(savSum)
    : eur(savSum)+"  ·  "+eur(c.savMonth)+" deze maand";

  /* instellingen */
  $("startMonthLbl").textContent=ymLabel(k);
  $("startBtn").textContent=eur(c.start.d)+" + "+eur(c.start.c)+" contant";
  const explicit=hasStart(k);
  $("startPrompt").style.display=(!explicit&&c.start.d===0&&c.start.c===0)?"block":"none";
  $("startNote").textContent=explicit
    ? "Handmatig ingesteld. Dit is het bedrag waarmee de maand begint."
    : "Automatisch overgenomen uit de vorige maand. Tik om je werkelijke saldo in te vullen.";

  const theme=THEMES.includes(state.theme)?state.theme:"system";
  $("thSystem").classList.toggle("on",theme==="system");
  $("thLight").classList.toggle("on",theme==="light");
  $("thDark").classList.toggle("on",theme==="dark");

  const stale=exportIsStale();
  $("exportNote").textContent=state.lastExport
    ? "Laatst geëxporteerd op "+fullDate(fromISO(state.lastExport))+(stale?". Dat is alweer even geleden.":".")
    : (hasAnyData()?"Nog nooit geëxporteerd.":"");
  $("exportNote").className="setnote"+(stale?" warn":"");
  $("setNudge").style.display=stale?"inline-block":"none";

  $("txDate").innerHTML=txDate?dayLabel(fromISO(txDate)):'<span class="ph">Datum</span>';
  $("txPay").textContent=txPay==="cash"?"Contant":"Rekening";
}

function hasAnyData(){
  return !!(state.income.length||state.expenses.length||state.savings.length||
    Object.keys(state.months).some(k=>{
      const m=state.months[k];
      return m.tx.length||m.oneoff.length||m.start;
    }));
}
/* pas zeuren als er iets te verliezen valt */
function exportIsStale(){
  if(!hasAnyData())return false;
  if(!state.lastExport)return true;
  const days=(NOW-startOfDay(fromISO(state.lastExport)))/86400000;
  return days>EXPORT_STALE_DAYS;
}

/* bedrag plus de negatief-opmaak in één keer */
function setAmount(el,n){
  el.textContent=eur(n);
  el.className="v num"+(n<0?" neg":"");
}
/* posten die deze maand zijn overgeslagen, identiek voor inkomsten en lasten */
function skippedRows(items,editKind){
  if(!items.length)return "";
  return '<div class="glabel"><span>Overgeslagen deze maand</span><span></span></div>'+
    items.map(it=>
      '<div class="row tap" data-edit="'+editKind+'" data-id="'+it.id+'">'+
      '<div class="rinfo"><div class="rname">'+esc(it.label)+
      ' <span class="tag off">overgeslagen</span></div></div>'+
      '<div class="ramt soft num">'+eur(it.amount)+"</div></div>"
    ).join("");
}

function incRow(x,isGot){
  const tag=isGot?'<span class="tag in">binnen</span>':'<span class="tag wait">verwacht</span>';
  const excTag=x.exc?' <span class="tag exc">afwijkend</span>':"";
  const cash=x.kind==="cash"?' <span class="tag off">contant</span>':"";
  const sub=x.date?dayLabel(x.date)+(x.ref.shift?" · schuift bij weekend":""):"Geen vaste dag";
  const check=x.manual?'<button class="check'+(x.got?" on":"")+'" data-toggle="recv" data-id="'+x.id+
    '" aria-pressed="'+(x.got?"true":"false")+'" aria-label="Markeer als ontvangen">✓</button>':"";
  return '<div class="row">'+check+
    '<div class="rinfo tap" data-edit="'+(x.rec?"income":"oneincome")+'" data-id="'+x.id+'">'+
    '<div class="rname">'+esc(x.label)+" "+tag+excTag+cash+"</div>"+
    '<div class="rsub">'+sub+"</div></div>"+
    '<div class="ramt num'+(isGot?"":" soft")+'">'+eur(x.amount)+"</div></div>";
}
function expRow(x){
  const excTag=x.exc?' <span class="tag exc">afwijkend</span>':"";
  const cashTag=x.pay==="cash"?' <span class="tag cash">contant</span>':"";
  const sub=x.date?dayLabel(x.date)+(x.ref.shift?" · schuift bij weekend":""):"Geen datum";
  return '<div class="row'+(x.paid?" done":"")+'">'+
    '<button class="check'+(x.paid?" on":"")+'" data-toggle="paid" data-id="'+x.id+
    '" aria-pressed="'+(x.paid?"true":"false")+'" aria-label="Markeer als betaald">✓</button>'+
    '<div class="rinfo tap" data-edit="'+(x.rec?"expense":"oneexpense")+'" data-id="'+x.id+'">'+
    '<div class="rname">'+esc(x.label)+excTag+cashTag+'</div><div class="rsub">'+sub+'</div></div>'+
    '<div class="ramt num">'+eur(x.amount)+"</div></div>";
}

/* ---------- dialoogbeheer ----------
   Beide overlays (bewerkscherm en kalender) delen dit: achtergrond
   vastzetten, focus binnen het venster houden, Escape sluit, en bij
   sluiten gaat de focus terug naar de knop die het venster opende.
   De kalender kan bovenop het bewerkscherm liggen, vandaar een stapel. */
const dialogs=[];
const FOCUSABLE='button:not([disabled]),input:not([disabled]),select:not([disabled]),[href],[tabindex]:not([tabindex="-1"])';

function enterDialog(veilId,boxId,closeFn){
  const veil=$(veilId), box=$(boxId);
  /* al open: alleen opnieuw scherpstellen, geen tweede laag op de stapel */
  if(!dialogs.some(d=>d.veil===veil)){
    dialogs.push({veil:veil,box:box,close:closeFn,opener:document.activeElement});
  }
  veil.classList.add("open");
  document.body.classList.add("locked");
  box.focus();
}
function leaveDialog(veilId){
  const veil=$(veilId);
  veil.classList.remove("open");
  const i=dialogs.findIndex(d=>d.veil===veil);
  const gone=i>=0?dialogs.splice(i,1)[0]:null;
  if(!dialogs.length)document.body.classList.remove("locked");
  /* de opener kan intussen weggerenderd zijn, dan laten we de focus los */
  if(gone&&gone.opener&&gone.opener.isConnected&&gone.opener.focus)gone.opener.focus();
  else if(dialogs.length)dialogs[dialogs.length-1].box.focus();
}
function visibleFocusable(box){
  return Array.from(box.querySelectorAll(FOCUSABLE)).filter(el=>el.offsetParent!==null);
}
document.addEventListener("keydown",e=>{
  if(!dialogs.length)return;
  const top=dialogs[dialogs.length-1];
  if(e.key==="Escape"){
    e.preventDefault();
    top.close();
    return;
  }
  if(e.key!=="Tab")return;
  const items=visibleFocusable(top.box);
  if(!items.length){e.preventDefault();top.box.focus();return;}
  const first=items[0], last=items[items.length-1];
  const here=document.activeElement;
  if(e.shiftKey&&(here===first||here===top.box)){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&here===last){e.preventDefault();first.focus();}
});

/* ---------- kalender ---------- */
let calCtx=null, calMonth=null;
function openCal(opts){
  calCtx=opts;
  calMonth=opts.value?ymOfDate(fromISO(opts.value)):(opts.month||view);
  drawCal();
  enterDialog("calveil","calBox",closeCal);
}
function drawCal(){
  const grid=$("cGrid"), dow=$("cDow"), title=$("cTitle");
  const monthNav=(calCtx.mode!=="day");
  $("cPrev").style.visibility=monthNav?"visible":"hidden";
  $("cNext").style.visibility=monthNav?"visible":"hidden";
  let h="";
  if(!monthNav){
    title.textContent="Dag van de maand";
    dow.innerHTML="";
    for(let d=1;d<=31;d++){
      h+='<button class="cell'+(String(calCtx.value)===String(d)?" sel":"")+'" data-day="'+d+'">'+d+"</button>";
    }
    $("cToday").textContent="Vandaag ("+NOW.getDate()+")";
  }else{
    const p=ymParse(calMonth);
    title.textContent=MONTHS[p.m]+" "+p.y;
    dow.innerHTML=DOW.map(d=>"<span>"+d+"</span>").join("");
    const lead=(new Date(p.y,p.m,1).getDay()+6)%7;
    const last=new Date(p.y,p.m+1,0).getDate();
    const prevLast=new Date(p.y,p.m,0).getDate();
    for(let i=lead;i>0;i--)h+='<button class="cell mut" disabled>'+(prevLast-i+1)+"</button>";
    for(let d=1;d<=last;d++){
      const iso=p.y+"-"+pad(p.m+1)+"-"+pad(d);
      h+='<button class="cell'+(iso===isoOf(NOW)?" now":"")+(calCtx.value===iso?" sel":"")+'" data-iso="'+iso+'">'+d+"</button>";
    }
    $("cToday").textContent="Vandaag";
  }
  grid.innerHTML=h;
  $("cClear").style.display=calCtx.clearable===false?"none":"";
}
function closeCal(){if(!calCtx)return;calCtx=null;leaveDialog("calveil");}
/* geeft de gekozen waarde door en sluit; calCtx is daarna leeg */
function pickCal(val){const f=calCtx.onPick;closeCal();f(val);}
$("cPrev").onclick=()=>{calMonth=ymShift(calMonth,-1);drawCal();};
$("cNext").onclick=()=>{calMonth=ymShift(calMonth,1);drawCal();};
$("cClear").onclick=()=>pickCal(null);
$("cToday").onclick=()=>pickCal(calCtx.mode==="day"?NOW.getDate():isoOf(NOW));
$("cGrid").addEventListener("click",e=>{
  const b=e.target.closest("button[data-iso],button[data-day]");
  if(!b)return;
  pickCal(b.dataset.iso?b.dataset.iso:parseInt(b.dataset.day,10));
});
$("calveil").addEventListener("click",e=>{if(e.target.id==="calveil")closeCal();});

/* ---------- toast met ongedaan maken ---------- */
let toastTimer=null;
function toast(msg,undoFn,label){
  $("toastMsg").textContent=msg;
  const btn=$("toastAct");
  btn.textContent=label||"Ongedaan maken";
  btn.style.display=undoFn?"":"none";
  btn.onclick=undoFn?()=>{undoFn();hideToast();}:hideToast;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(hideToast,6000);
}
function hideToast(){$("toast").classList.remove("show");}
function withUndo(msg,fn){
  const snap=JSON.stringify(state);
  fn();save();render();
  toast(msg,()=>{state=JSON.parse(snap);save();render();});
}

/* ---------- bevestigen ----------
   Vervangt confirm(): dat blokkeert de pagina en ziet er op een telefoon
   uit alsof het bij de browser hoort in plaats van bij de app. Kan ook een
   keuzelijst tonen, bijvoorbeeld om boekingen te verhuizen. */
let askCtx=null;
function ask(opts){
  askCtx=opts;
  $("askTitle").textContent=opts.title;
  $("askBody").textContent=opts.body||"";
  $("askBody").style.display=opts.body?"":"none";
  $("askYes").textContent=opts.okLabel||"Doorgaan";
  $("askYes").className="ok"+(opts.danger?" danger":"");
  const choices=opts.choices||[];
  show("fMove",choices.length>0);
  if(choices.length){
    $("lblMove").textContent=opts.choiceLabel||"Verplaatsen naar";
    $("askSelect").innerHTML=choices.map(c=>'<option value="'+esc(c.value)+'">'+esc(c.label)+"</option>").join("");
  }
  enterDialog("askveil","askBox",closeAsk);
}
function closeAsk(){if(!askCtx)return;askCtx=null;leaveDialog("askveil");}
$("askNo").onclick=closeAsk;
$("askYes").onclick=()=>{
  const fn=askCtx.onOk, value=$("askSelect").value;
  closeAsk();
  fn(value);
};
$("askveil").addEventListener("click",e=>{if(e.target.id==="askveil")closeAsk();});

/* ---------- bewerkscherm ---------- */
let edit=null;
function show(id,on){$(id).classList.toggle("hidden",!on);}
function clearErrors(){document.querySelectorAll(".field.bad").forEach(f=>f.classList.remove("bad"));}
function fail(id){$(id).classList.add("bad");}

function openPanel(kind,id){
  clearErrors();
  const FAM={income:"income",newincome:"income",oneincome:"income",
             expense:"expense",newexpense:"expense",oneexpense:"expense"};
  const family=(kind==="newone")?(id==="income"?"income":"expense"):(FAM[kind]||null);
  edit={kind:kind,id:id,family:family,day:null,date:null,exc:null,ckind:"digital",pay:"digital",shift:false,skip:false,rec:true};
  const m=readM(view);
  ["fType","fLabel","fAmount","fKind","fPay","fCash","fDay","fDate","fShift","fExc","fSkip","fGoal","fSavKind","fTerm","fDir"].forEach(f=>show(f,false));
  $("excMonth").textContent=ymLabel(view);
  $("pLabel").value="";$("pAmount").value="";$("pGoal").value="";$("pCash").value="";$("pTerm").value="";

  if(kind==="income"||kind==="newincome"){
    const it=kind==="income"?state.income.find(x=>x.id===id):null;
    $("pTitle").textContent=it?"Inkomstenbron":"Nieuwe inkomstenbron";
    $("lblLabel").textContent="Naam";
    show("fType",true);show("fLabel",true);show("fAmount",true);show("fKind",true);
    edit.rec=true;setSeg(true);
    if(it){
      $("pLabel").value=it.label;$("pAmount").value=toInput(it.amount);
      edit.day=it.day;edit.ckind=it.kind;edit.shift=!!it.shift;
      edit.exc=m.exc[it.id]||null;edit.skip=!!m.skip[it.id];
      show("fExc",true);show("fSkip",true);
    }
    setKind(edit.ckind);setShift(edit.shift);setSkip(edit.skip);
  }
  else if(kind==="expense"||kind==="newexpense"){
    const it=kind==="expense"?state.expenses.find(x=>x.id===id):null;
    $("pTitle").textContent=it?"Vaste last":"Nieuwe vaste last";
    $("lblLabel").textContent="Naam";
    show("fType",true);show("fLabel",true);show("fAmount",true);show("fPay",true);
    edit.rec=true;setSeg(true);
    if(it){
      $("pLabel").value=it.label;$("pAmount").value=toInput(it.amount);
      edit.day=it.day;edit.exc=m.exc[it.id]||null;edit.skip=!!m.skip[it.id];edit.pay=it.pay||"digital";
      edit.shift=!!it.shift;
      show("fExc",true);show("fSkip",true);
    }else{edit.day=1;}
    setPay(edit.pay);setSkip(edit.skip);setShift(edit.shift);
  }
  else if(kind==="oneincome"||kind==="oneexpense"||kind==="newone"){
    const it=(kind==="newone")?null:m.oneoff.find(x=>x.id===id);
    if(it)edit.family=it.kind;
    const isInc=edit.family==="income";
    $("pTitle").textContent=it?(isInc?"Eenmalige inkomst":"Eenmalige uitgave"):(isInc?"Nieuwe eenmalige inkomst":"Nieuwe eenmalige uitgave");
    $("lblLabel").textContent="Naam";
    show("fType",true);show("fLabel",true);show("fAmount",true);show("fDate",true);
    edit.rec=false;setSeg(false);
    if(isInc){show("fKind",true);}else{show("fPay",true);}
    if(it){
      $("pLabel").value=it.label;$("pAmount").value=toInput(it.amount);edit.date=it.date;
      edit.pay=it.pay||"digital";edit.ckind=it.ckind||"digital";
    }else{
      edit.date=defaultDate();
    }
    setPay(edit.pay);setKind(edit.ckind);
  }
  else if(kind==="cat"||kind==="newcat"){
    const it=kind==="cat"?state.categories.find(x=>x.id===id):null;
    $("pTitle").textContent=it?"Categorie":"Nieuwe categorie";
    $("lblLabel").textContent="Naam";$("lblAmount").textContent="Maandbudget, nul is geen budget";
    show("fLabel",true);show("fAmount",true);
    if(it){$("pLabel").value=it.label;$("pAmount").value=it.budget?toInput(it.budget):"";}
  }
  else if(kind==="sav"||kind==="newsav"){
    const it=kind==="sav"?state.savings.find(x=>x.id===id):null;
    $("pTitle").textContent=it?"Spaarrekening":"Nieuwe spaarrekening";
    $("lblLabel").textContent="Naam";$("lblAmount").textContent="Huidig saldo";
    show("fLabel",true);show("fSavKind",true);show("fGoal",true);
    edit.savKind=it?(it.kind||"free"):"free";
    edit.term=it?(it.termMonths||12):12;
    $("pTerm").value=String(edit.term);
    if(it){$("pLabel").value=it.label;$("pAmount").value=toInput(it.amount||0);$("pGoal").value=it.goal?toInput(it.goal):"";}
    setSavKind(edit.savKind);
  }
  else if(kind==="newdep"){
    const sv=state.savings.find(x=>x.id===id);
    const term=sv&&sv.kind==="term";
    edit.savId=id;
    edit.savKind=term?"term":"free";
    $("pTitle").textContent=(term?"Storting op ":"Boeking op ")+(sv?sv.label:"spaarrekening");
    $("lblAmount").textContent="Bedrag";
    show("fAmount",true);show("fDate",true);show("fPay",true);
    /* een vaste termijn kent alleen stortingen, een vrije rekening ook opnames */
    show("fDir",!term);
    edit.rec=false;
    edit.date=defaultDate();
    setPay("digital");setDir(1);
  }
  else if(kind==="start"){
    $("pTitle").textContent="Beginsaldo "+ymLabel(view);
    $("lblAmount").textContent="Saldo op je rekening";
    show("fAmount",true);show("fCash",true);
    const cur=hasStart(view)?state.months[view].start:null;
    if(cur){$("pAmount").value=toInput(cur.d||0);$("pCash").value=toInput(cur.c||0);}
  }
  const removable=["income","expense","oneincome","oneexpense","cat","sav"].includes(kind);
  $("pDelete").style.display=removable?"block":"none";
  syncDateFields();
  enterDialog("veil","panelBox",closePanel);
}
function defaultDate(){
  return (view===TODAY_YM)?isoOf(NOW):(ymParse(view).y+"-"+pad(ymParse(view).m+1)+"-01");
}
/* elk keuzeblok is één paar knoppen: links aan als de vlag uit staat */
function setSegPair(leftId,rightId,right){
  $(leftId).classList.toggle("on",!right);
  $(rightId).classList.toggle("on",right);
}
function setSeg(rec){edit.rec=rec;setSegPair("segO","segR",rec);syncDateFields();}
function setKind(k){edit.ckind=k;setSegPair("segD","segC",k==="cash");}
function setPay(k){edit.pay=k;setSegPair("segPD","segPC",k==="cash");}
function setShift(v){edit.shift=v;setSegPair("segSN","segSY",v);}
function setSkip(v){edit.skip=v;setSegPair("segKA","segKS",v);}
function setDir(sign){edit.dir=sign;setSegPair("segDI","segDO",sign<0);}
function setSavKind(k){
  edit.savKind=k;
  setSegPair("segSF","segST",k==="term");
  show("fTerm",k==="term");
  show("fAmount",k!=="term");
  $("savKindHint").textContent=(k==="term")
    ? "Je voegt losse stortingen toe. Elke storting staat vanaf zijn eigen datum vast en krijgt een eigen vrijvaldatum."
    : "Je boekt inleg en opnames, die gaan van je beschikbare geld af of komen erbij. Het saldo hier aanpassen geldt als correctie en verandert je maand niet.";
}
function syncDateFields(){
  if(!edit)return;
  const k=edit.kind;
  if(k==="newdep"){
    $("pDate").innerHTML=edit.date?dayLabel(fromISO(edit.date)):'<span class="ph">Vandaag</span>';
    return;
  }
  const scheduled=(k==="income"||k==="newincome"||k==="expense"||k==="newexpense"||k==="oneincome"||k==="oneexpense"||k==="newone");
  if(!scheduled)return;
  show("fDay",edit.rec);
  show("fDate",!edit.rec);
  show("fShift",edit.rec&&!!edit.day);
  $("pDay").innerHTML=edit.day?("Dag "+edit.day):'<span class="ph">Geen vaste dag</span>';
  $("pDate").innerHTML=edit.date?dayLabel(fromISO(edit.date)):'<span class="ph">Vandaag</span>';
  $("pExc").innerHTML=edit.exc?dayLabel(fromISO(edit.exc)):'<span class="ph">Geen afwijking</span>';
  $("excClear").style.display=edit.exc?"":"none";
  $("dayHint").style.display=(k==="income"||k==="newincome")?"":"none";
}
function closePanel(){if(!edit)return;edit=null;leaveDialog("veil");}

function savePanel(){
  clearErrors();
  const k=edit.kind;
  const label=$("pLabel").value.trim();
  const amt=parseAmt($("pAmount").value);

  if(k==="start"){
    const cash=parseAmt($("pCash").value);
    editM(view).start={d:amt===null?0:amt,c:cash===null?0:cash};
    save();render();closePanel();toast("Beginsaldo bijgewerkt",null);return;
  }
  const needsLabel=!["start","newdep"].includes(k);
  if(needsLabel&&!label){fail("fLabel");return;}

  if(k==="newdep"){
    if(amt===null||amt<=0){fail("fAmount");return;}
    const sv=state.savings.find(x=>x.id===edit.savId);
    const iso=edit.date||defaultDate();
    if(!sv){closePanel();return;}
    if(sv.kind==="term"){
      sv.deposits=sv.deposits||[];
      sv.deposits.push({id:uid(),amount:amt,date:iso,pay:edit.pay});
      save();render();closePanel();
      toast("Storting vast tot "+fullDate(addMonths(fromISO(iso),sv.termMonths||12)),null);
      return;
    }
    const signed=(edit.dir<0?-amt:amt);
    sv.movements=sv.movements||[];
    sv.movements.push({id:uid(),amount:signed,date:iso,pay:edit.pay});
    sv.amount=Math.round(((sv.amount||0)+signed)*100)/100;
    save();render();closePanel();
    toast((signed<0?"Opname van ":"Inleg van ")+eur(Math.abs(signed))+" geboekt",null);
    return;
  }
  if(k==="cat"||k==="newcat"){
    const b=amt===null?0:Math.max(0,amt);
    if(k==="newcat")state.categories.push({id:uid(),label:label,budget:b});
    else{const it=state.categories.find(x=>x.id===edit.id);it.label=label;it.budget=b;}
    save();render();closePanel();return;
  }
  if(k==="sav"||k==="newsav"){
    const goal=parseAmt($("pGoal").value)||0;
    const isTerm=edit.savKind==="term";
    const term=Math.max(1,Math.round(parseAmt($("pTerm").value)||12));
    const bal=(amt===null?0:amt);
    if(k==="newsav"){
      state.savings.push({id:uid(),label:label,goal:goal,kind:isTerm?"term":"free",
        amount:isTerm?0:bal,termMonths:term,
        deposits:isTerm?[]:undefined,movements:isTerm?undefined:[]});
    }else{
      const it=state.savings.find(x=>x.id===edit.id);
      it.label=label;it.goal=goal;it.kind=isTerm?"term":"free";it.termMonths=term;
      if(isTerm)it.deposits=it.deposits||[];
      else{it.amount=bal;it.movements=it.movements||[];}
    }
    save();render();closePanel();return;
  }
  if(amt===null||amt<=0){fail("fAmount");return;}

  if(!edit.rec){
    if(!edit.date)edit.date=defaultDate();
    const m=editM(view);
    const fam=edit.family||"expense";
    if(k==="oneincome"||k==="oneexpense"){
      const it=m.oneoff.find(x=>x.id===edit.id);
      if(it){it.label=label;it.amount=amt;it.date=edit.date;it.ckind=edit.ckind;it.pay=edit.pay;}
    }else if(k==="income"||k==="expense"){
      /* bestaande maandelijkse post omzetten naar eenmalig */
      convertToOneoff(fam,edit.id,label,amt,edit.date);
    }else{
      m.oneoff.push({id:uid(),kind:fam,label:label,amount:amt,date:edit.date,ckind:edit.ckind,pay:edit.pay});
    }
    save();render();closePanel();return;
  }

  const m=editM(view);
  if(k==="oneincome"||k==="oneexpense"){
    m.oneoff=m.oneoff.filter(x=>x.id!==edit.id);
    if(edit.family==="income")state.income.push({id:uid(),label:label,amount:amt,day:edit.day,kind:edit.ckind,shift:edit.shift});
    else state.expenses.push({id:uid(),label:label,amount:amt,day:edit.day,pay:edit.pay,shift:edit.shift});
    save();render();closePanel();return;
  }

  if(k==="income"||k==="newincome"){
    if(k==="newincome"){
      state.income.push({id:uid(),label:label,amount:amt,day:edit.day,kind:edit.ckind,shift:edit.shift});
    }else{
      const it=state.income.find(x=>x.id===edit.id);
      it.label=label;it.amount=amt;it.day=edit.day;it.kind=edit.ckind;it.shift=edit.shift;
      applyExcSkip(m,edit.id);
    }
    save();render();closePanel();return;
  }
  if(k==="expense"||k==="newexpense"){
    if(k==="newexpense"){
      state.expenses.push({id:uid(),label:label,amount:amt,day:edit.day,pay:edit.pay,shift:edit.shift});
    }else{
      const it=state.expenses.find(x=>x.id===edit.id);
      it.label=label;it.amount=amt;it.day=edit.day;it.pay=edit.pay;it.shift=edit.shift;
      applyExcSkip(m,edit.id);
    }
    save();render();closePanel();return;
  }
}
function applyExcSkip(m,id){
  if(edit.exc)m.exc[id]=edit.exc;else delete m.exc[id];
  if(edit.skip)m.skip[id]=true;else delete m.skip[id];
}
function convertToOneoff(fam,id,label,amt,date){
  const m=editM(view);
  const isInc=(fam==="income");
  const list=isInc?state.income:state.expenses;
  const i=list.findIndex(x=>x.id===id);
  if(i>=0)list.splice(i,1);
  m.oneoff.push({id:uid(),kind:isInc?"income":"expense",label:label,amount:amt,date:date,ckind:edit.ckind,pay:edit.pay});
}

/* ---------- knoppen ---------- */
$("prevM").onclick=()=>{view=ymShift(view,-1);render();};
$("nextM").onclick=()=>{view=ymShift(view,1);render();};
$("jumpNow").onclick=()=>{view=TODAY_YM;render();};

$("pDay").onclick=()=>openCal({mode:"day",value:edit.day,onPick:v=>{edit.day=v;syncDateFields();}});
$("pDate").onclick=()=>openCal({mode:"date",value:edit.date,month:view,onPick:v=>{edit.date=v;syncDateFields();}});
$("pExc").onclick=()=>openCal({mode:"date",value:edit.exc,month:view,onPick:v=>{edit.exc=v;syncDateFields();}});
$("excClear").onclick=()=>{edit.exc=null;syncDateFields();};
$("segR").onclick=()=>setSeg(true);
$("segO").onclick=()=>setSeg(false);
$("segD").onclick=()=>setKind("digital");
$("segC").onclick=()=>setKind("cash");
$("segSF").onclick=()=>setSavKind("free");
$("segST").onclick=()=>setSavKind("term");
$("segPD").onclick=()=>setPay("digital");
$("segPC").onclick=()=>setPay("cash");
$("segSN").onclick=()=>setShift(false);
$("segSY").onclick=()=>setShift(true);
$("segDI").onclick=()=>setDir(1);
$("segDO").onclick=()=>setDir(-1);
$("segKA").onclick=()=>setSkip(false);
$("segKS").onclick=()=>setSkip(true);
/* boekingen op een categorie, over alle maanden heen */
function txOfCat(id){
  let n=0;
  Object.keys(state.months).forEach(mk=>{
    n+=state.months[mk].tx.filter(t=>t.cat===id).length;
  });
  return n;
}
function moveTx(fromId,toId){
  Object.keys(state.months).forEach(mk=>{
    state.months[mk].tx.forEach(t=>{if(t.cat===fromId)t.cat=toId;});
  });
}
function dropItem(k,id,extra){
  if(k==="income")state.income=state.income.filter(x=>x.id!==id);
  else if(k==="expense")state.expenses=state.expenses.filter(x=>x.id!==id);
  else if(k==="cat")state.categories=state.categories.filter(x=>x.id!==id);
  else if(k==="sav")state.savings=state.savings.filter(x=>x.id!==id);
  else{const m=editM(view);m.oneoff=m.oneoff.filter(x=>x.id!==id);}
  if(k==="income"||k==="expense"){
    Object.keys(state.months).forEach(mk=>{
      const mm=state.months[mk];
      delete mm.paid[id];delete mm.recv[id];delete mm.exc[id];delete mm.skip[id];
    });
  }
  if(extra)extra();
}
$("pDelete").onclick=()=>{
  const k=edit.kind, id=edit.id;
  let name="", note="";
  if(k==="income"||k==="expense"){
    const list=(k==="income")?state.income:state.expenses;
    const it=list.find(x=>x.id===id);
    name=it?it.label:"Post";
    note=" uit alle maanden verwijderd";
  }else if(k==="oneincome"||k==="oneexpense"){
    const it=readM(view).oneoff.find(x=>x.id===id);
    name=it?it.label:"Post";
  }else if(k==="sav"){
    const it=state.savings.find(x=>x.id===id);
    name=it?it.label:"Spaardoel";
  }else if(k==="cat"){
    const it=state.categories.find(x=>x.id===id);
    name=it?it.label:"Categorie";
    const used=txOfCat(id);
    const others=state.categories.filter(x=>x.id!==id);
    closePanel();
    if(!used){withUndo("“"+name+"” verwijderd",()=>dropItem(k,id));return;}
    /* boekingen niet stilletjes ontkoppelen: laat kiezen waar ze heen gaan */
    ask({
      title:"“"+name+"” verwijderen",
      body:used+" boeking"+(used>1?"en staan":" staat")+" op deze categorie. Kies waar "+(used>1?"ze":"hij")+" heen "+(used>1?"gaan":"gaat")+".",
      okLabel:"Verwijderen",
      danger:true,
      choiceLabel:"Boekingen verplaatsen naar",
      choices:others.map(c=>({value:c.id,label:c.label})).concat([{value:"",label:"Zonder categorie laten"}]),
      onOk:target=>withUndo("“"+name+"” verwijderd",()=>dropItem(k,id,()=>{
        if(target)moveTx(id,target);
      }))
    });
    return;
  }
  closePanel();
  withUndo("“"+name+"”"+(note||" verwijderd"),()=>dropItem(k,id));
};
$("pCancel").onclick=closePanel;
$("pSave").onclick=savePanel;
$("veil").addEventListener("click",e=>{if(e.target.id==="veil")closePanel();});

$("addIncR").onclick=()=>openPanel("newincome");
$("addIncO").onclick=()=>openPanel("newone","income");
$("addExpR").onclick=()=>openPanel("newexpense");
$("addExpO").onclick=()=>openPanel("newone","expense");
$("addCat").onclick=()=>openPanel("newcat");
$("addSav").onclick=()=>openPanel("newsav");
$("startBtn").onclick=()=>openPanel("start");
$("startPrompt").onclick=()=>openPanel("start");

let txDate=null, txPay="digital";

$("txDate").onclick=()=>openCal({mode:"date",value:txDate,month:view,onPick:v=>{txDate=v;render();}});
$("txPay").onclick=()=>{txPay=(txPay==="cash")?"digital":"cash";render();};
$("txAdd").onclick=()=>{
  const d=$("txDesc").value.trim();
  const a=parseAmt($("txAmt").value);
  if(!d||a===null||a<=0){toast("Vul een omschrijving en een bedrag in",null);return;}
  if(!state.categories.length){toast("Maak eerst een categorie aan",null);return;}
  const date=txDate||defaultDate();
  /* een boeking hoort bij de maand van haar eigen datum, niet bij de maand
     die je toevallig openhad */
  const home=ymOfDate(fromISO(date));
  editM(home).tx.push({id:uid(),label:d,amount:a,cat:$("txCat").value,date:date,pay:txPay});
  $("txDesc").value="";$("txAmt").value="";txDate=null;
  save();render();
  $("txDesc").focus();
  if(home!==view)toast("“"+d+"” staat in "+ymLabel(home),()=>{view=home;render();},"Ga erheen");
};

/* Enter bevestigt, zodat je op een telefoon het toetsenbord niet hoeft
   weg te tikken om op de knop te komen */
function submitOnEnter(ids,fire){
  ids.forEach(id=>$(id).addEventListener("keydown",e=>{
    if(e.key==="Enter"){e.preventDefault();fire();}
  }));
}
submitOnEnter(["txDesc","txAmt"],()=>$("txAdd").click());
submitOnEnter(["pLabel","pAmount","pCash","pTerm","pGoal"],()=>$("pSave").click());

document.body.addEventListener("click",e=>{
  const t=e.target.closest("[data-toggle]");
  if(t){
    const m=editM(view), id=t.dataset.id;
    const bag=t.dataset.toggle==="paid"?m.paid:m.recv;
    if(bag[id])delete bag[id];else bag[id]=true;
    if(navigator.vibrate)navigator.vibrate(8);
    save();render();return;
  }
  const ed=e.target.closest("[data-edit]");
  if(ed){openPanel(ed.dataset.edit,ed.dataset.id);return;}
  const nd=e.target.closest("[data-newdep]");
  if(nd){openPanel("newdep",nd.dataset.newdep);return;}
  const dd=e.target.closest("[data-deldep]");
  if(dd){
    const svId=dd.dataset.deldep, depId=dd.dataset.id;
    const sv=state.savings.find(x=>x.id===svId);
    const fl=sv&&flowsOf(sv).find(x=>x.id===depId);
    const what=(sv&&sv.kind==="term")?"Storting van ":"Boeking van ";
    withUndo(what+(fl?eur(Math.abs(fl.amount)):"")+" verwijderd",()=>{
      const t=state.savings.find(x=>x.id===svId);
      if(!t)return;
      if(t.kind==="term"){t.deposits=(t.deposits||[]).filter(x=>x.id!==depId);return;}
      /* bij een vrije rekening draait het saldo mee terug */
      const gone=(t.movements||[]).find(x=>x.id===depId);
      t.movements=(t.movements||[]).filter(x=>x.id!==depId);
      if(gone)t.amount=Math.round(((t.amount||0)-gone.amount)*100)/100;
    });
    return;
  }
  const del=e.target.closest("[data-del]");
  if(del){
    const id=del.dataset.id;
    const m=editM(view);
    const item=m.tx.find(x=>x.id===id);
    withUndo("“"+(item?item.label:"Boeking")+"” verwijderd",()=>{
      const mm=editM(view);mm.tx=mm.tx.filter(x=>x.id!==id);
    });
    return;
  }
});

/* ---------- gegevens ---------- */
function replaceState(next,msg){
  const snap=JSON.stringify(state);
  state=next;save();render();
  toast(msg,()=>{state=JSON.parse(snap);save();render();});
}
$("expBtn").onclick=()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="budget-"+isoOf(NOW)+".json";
  a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  state.lastExport=isoOf(NOW);save();render();
};
$("impBtn").onclick=()=>$("impFile").click();
$("impFile").onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    let d;
    try{
      d=JSON.parse(r.result);
      if(!d||!Array.isArray(d.income)||!Array.isArray(d.expenses))throw 0;
    }catch(err){toast("Dit bestand is geen geldige budget-export",null);return;}
    ask({
      title:"Gegevens vervangen",
      body:"Alles wat nu in deze browser staat wordt overschreven door "+f.name+". Je kunt dit met één tik ongedaan maken.",
      okLabel:"Vervangen",
      danger:true,
      onOk:()=>replaceState(fix(d),"Gegevens geïmporteerd")
    });
  };
  r.readAsText(f);
  e.target.value="";
};
$("wipeBtn").onclick=()=>ask({
  title:"Alles wissen",
  body:"Je inkomsten, vaste lasten, boekingen en spaardoelen verdwijnen en de app begint opnieuw met de standaardcategorieën.",
  okLabel:"Wissen",
  danger:true,
  onOk:()=>{view=TODAY_YM;replaceState(seed(),"Alles gewist");}
});

/* ---------- weergave ---------- */
function applyTheme(){
  const t=THEMES.includes(state.theme)?state.theme:"system";
  const root=document.documentElement;
  if(t==="system")root.removeAttribute("data-theme");else root.setAttribute("data-theme",t);
  /* de statusbalk van de telefoon moet dezelfde kleur krijgen als de pagina */
  $("themeColor").setAttribute("content",
    getComputedStyle(root).getPropertyValue("--wine-900").trim()||"#2E0B14");
}
function setTheme(t){
  state.theme=t;save();applyTheme();render();
}
$("thSystem").onclick=()=>setTheme("system");
$("thLight").onclick=()=>setTheme("light");
$("thDark").onclick=()=>setTheme("dark");
/* wisselt het systeem van stand, dan verandert --wine-900 mee */
if(window.matchMedia){
  const mq=window.matchMedia("(prefers-color-scheme: dark)");
  const onChange=()=>{if((state.theme||"system")==="system")applyTheme();};
  if(mq.addEventListener)mq.addEventListener("change",onChange);
  else if(mq.addListener)mq.addListener(onChange);
}

/* ---------- vegen tussen maanden ---------- */
(function swipe(){
  const SLOP=60, MAX_MS=700;
  let x0=null,y0=null,t0=0;
  const area=document.querySelector(".wrap");
  area.addEventListener("touchstart",e=>{
    x0=null;
    if(dialogs.length||e.touches.length!==1)return;
    /* niet kapen wat de gebruiker in een veld aan het doen is */
    if(e.target.closest("input,select,textarea"))return;
    x0=e.touches[0].clientX;y0=e.touches[0].clientY;t0=Date.now();
  },{passive:true});
  area.addEventListener("touchend",e=>{
    if(x0===null)return;
    const t=e.changedTouches[0], dx=t.clientX-x0, dy=t.clientY-y0;
    x0=null;
    if(Date.now()-t0>MAX_MS)return;
    /* duidelijk horizontaal, anders is het gewoon scrollen */
    if(Math.abs(dx)<SLOP||Math.abs(dx)<Math.abs(dy)*2)return;
    view=ymShift(view,dx<0?1:-1);
    render();
  },{passive:true});
})();

/* ---------- maandwissel terwijl de app open staat ---------- */
function refreshClock(){
  const n=startOfDay(new Date());
  if(n.getTime()===NOW.getTime())return;
  const wasNow=(view===TODAY_YM);
  NOW=n;TODAY_YM=ymOfDate(n);
  if(wasNow)view=TODAY_YM;
  render();
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshClock();});
window.addEventListener("focus",refreshClock);
setInterval(refreshClock,60000);

applyTheme();
render();
if(loadFailed){
  toast("Je opgeslagen gegevens konden niet worden gelezen. Er is nog niets overschreven: exporteer eerst of sluit dit tabblad.",null);
}

/* ---------- installeren en offline ---------- */
(function pwa(){
  const row=$("installRow"), btn=$("installBtn"), note=$("installNote");
  const mq=window.matchMedia?window.matchMedia("(display-mode: standalone)"):null;
  const standalone=(mq&&mq.matches)||window.navigator.standalone===true;
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)&&!window.MSStream;
  let prompt=null;

  function showIosHint(){
    row.style.display="flex";
    btn.style.display="none";
    note.style.display="block";
    note.textContent="Op iPhone en iPad: tik op Deel onderin Safari en kies Zet op beginscherm. Daarna telt Safari de zevendagenregel niet meer mee en blijven je gegevens staan.";
  }

  if(standalone){
    row.style.display="flex";btn.style.display="none";note.style.display="block";
    note.textContent="De app draait al vanaf je beginscherm.";
  }else if(ios){
    showIosHint();
  }

  window.addEventListener("beforeinstallprompt",e=>{
    e.preventDefault();prompt=e;
    row.style.display="flex";btn.style.display="";note.style.display="none";
  });
  btn.onclick=async()=>{
    if(!prompt){showIosHint();return;}
    prompt.prompt();
    const res=await prompt.userChoice;
    prompt=null;
    if(res.outcome==="accepted"){row.style.display="none";toast("Budget is geïnstalleerd",null);}
  };
  window.addEventListener("appinstalled",()=>{row.style.display="none";});

  if("serviceWorker" in navigator){
    window.addEventListener("load",()=>{
      navigator.serviceWorker.register("sw.js").then(reg=>{
        reg.addEventListener("updatefound",()=>{
          const sw=reg.installing;
          if(!sw)return;
          sw.addEventListener("statechange",()=>{
            if(sw.state==="installed"&&navigator.serviceWorker.controller){
              toast("Nieuwe versie klaar",()=>{sw.postMessage("skipWaiting");location.reload();},"Nu herladen");
            }
          });
        });
      }).catch(()=>{});
    });
  }
})();
