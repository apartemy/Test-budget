"use strict";

/* ---------- basis ---------- */
const MONTHS=["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
const DOW=["ma","di","wo","do","vr","za","zo"];
const KEY="budget_v8";

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

let state=load();

function load(){
  try{
    const raw=localStorage.getItem(KEY);
    if(raw){const d=JSON.parse(raw);return fix(d);}
  }catch(e){}
  return seed();
}
function fix(d){
  d.income=d.income||[];d.expenses=d.expenses||[];
  d.categories=d.categories||[];d.savings=d.savings||[];d.months=d.months||{};
  d.expenses.forEach(e=>{if(!e.pay)e.pay="digital";});
  d.savings.forEach(sv=>{
    if(!sv.kind)sv.kind="free";
    if(sv.kind==="term"){sv.deposits=sv.deposits||[];sv.termMonths=sv.termMonths||12;}
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
  return d;
}
function save(){
  try{localStorage.setItem(KEY,JSON.stringify(state));}
  catch(e){toast("Opslaan lukt niet. De opslag is vol of je bent in privémodus.",null);}
}
const blankMonth=()=>({start:null,paid:{},recv:{},exc:{},skip:{},oneoff:[],tx:[]});
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
  state.savings.forEach(sv=>depositsOf(sv).forEach(dp=>{
    const dd=fromISO(dp.date);
    if(!dd||ymOfDate(dd)!==k)return;
    savMonth+=dp.amount;
    if(dp.pay==="cash")savC+=dp.amount;else savD+=dp.amount;
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
    }
    h+="</div>";
  });
  $("savList").innerHTML=h||'<div class="empty">Nog geen spaardoel. Voeg er een toe, vrij opneembaar of met een vaste looptijd.</div>';
  $("savTot").textContent=withCash(savSum,c.savMonth," deze maand");

  /* instellingen */
  $("startMonthLbl").textContent=ymLabel(k);
  $("startBtn").textContent=eur(c.start.d)+" + "+eur(c.start.c)+" contant";
  const explicit=hasStart(k);
  $("startPrompt").style.display=(!explicit&&c.start.d===0&&c.start.c===0)?"block":"none";
  $("startNote").textContent=explicit
    ? "Handmatig ingesteld. Dit is het bedrag waarmee de maand begint."
    : "Automatisch overgenomen uit de vorige maand. Tik om je werkelijke saldo in te vullen.";

  $("txDate").innerHTML=txDate?dayLabel(fromISO(txDate)):'<span class="ph">Datum</span>';
  $("txPay").textContent=txPay==="cash"?"Contant":"Rekening";
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
  const sub=x.date?dayLabel(x.date):"Geen datum";
  return '<div class="row'+(x.paid?" done":"")+'">'+
    '<button class="check'+(x.paid?" on":"")+'" data-toggle="paid" data-id="'+x.id+
    '" aria-pressed="'+(x.paid?"true":"false")+'" aria-label="Markeer als betaald">✓</button>'+
    '<div class="rinfo tap" data-edit="'+(x.rec?"expense":"oneexpense")+'" data-id="'+x.id+'">'+
    '<div class="rname">'+esc(x.label)+excTag+cashTag+'</div><div class="rsub">'+sub+'</div></div>'+
    '<div class="ramt num">'+eur(x.amount)+"</div></div>";
}

/* ---------- kalender ---------- */
let calCtx=null, calMonth=null;
function openCal(opts){
  calCtx=opts;
  calMonth=opts.value?ymOfDate(fromISO(opts.value)):(opts.month||view);
  $("calveil").classList.add("open");
  drawCal();
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
function closeCal(){$("calveil").classList.remove("open");calCtx=null;}
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
  ["fType","fLabel","fAmount","fKind","fPay","fCash","fDay","fDate","fShift","fExc","fSkip","fGoal","fSavKind","fTerm"].forEach(f=>show(f,false));
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
      show("fExc",true);show("fSkip",true);
    }else{edit.day=1;}
    setPay(edit.pay);setSkip(edit.skip);
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
    edit.savId=id;
    $("pTitle").textContent="Storting op "+(sv?sv.label:"spaarrekening");
    $("lblAmount").textContent="Bedrag";
    show("fAmount",true);show("fDate",true);show("fPay",true);
    edit.rec=false;
    edit.date=defaultDate();
    setPay("digital");
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
  $("veil").classList.add("open");
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
function setSavKind(k){
  edit.savKind=k;
  setSegPair("segSF","segST",k==="term");
  show("fTerm",k==="term");
  show("fAmount",k!=="term");
  $("savKindHint").textContent=(k==="term")
    ? "Je voegt losse stortingen toe. Elke storting staat vanaf zijn eigen datum vast en krijgt een eigen vrijvaldatum."
    : "Je houdt één saldo bij dat je zelf aanpast.";
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
  show("fShift",edit.rec&&(k==="income"||k==="newincome")&&!!edit.day);
  $("pDay").innerHTML=edit.day?("Dag "+edit.day):'<span class="ph">Geen vaste dag</span>';
  $("pDate").innerHTML=edit.date?dayLabel(fromISO(edit.date)):'<span class="ph">Vandaag</span>';
  $("pExc").innerHTML=edit.exc?dayLabel(fromISO(edit.exc)):'<span class="ph">Geen afwijking</span>';
  $("excClear").style.display=edit.exc?"":"none";
  $("dayHint").style.display=(k==="income"||k==="newincome")?"":"none";
}
function closePanel(){$("veil").classList.remove("open");edit=null;}

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
    if(sv){sv.deposits=sv.deposits||[];sv.deposits.push({id:uid(),amount:amt,date:iso,pay:edit.pay});}
    save();render();closePanel();
    toast("Storting vast tot "+fullDate(addMonths(fromISO(iso),(sv&&sv.termMonths)||12)),null);
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
        amount:isTerm?0:bal,termMonths:term,deposits:isTerm?[]:undefined});
    }else{
      const it=state.savings.find(x=>x.id===edit.id);
      it.label=label;it.goal=goal;it.kind=isTerm?"term":"free";it.termMonths=term;
      if(isTerm)it.deposits=it.deposits||[];else it.amount=bal;
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
    else state.expenses.push({id:uid(),label:label,amount:amt,day:edit.day,pay:edit.pay});
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
      state.expenses.push({id:uid(),label:label,amount:amt,day:edit.day,pay:edit.pay});
    }else{
      const it=state.expenses.find(x=>x.id===edit.id);
      it.label=label;it.amount=amt;it.day=edit.day;it.pay=edit.pay;
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
$("segKA").onclick=()=>setSkip(false);
$("segKS").onclick=()=>setSkip(true);
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
  }else if(k==="cat"){
    const it=state.categories.find(x=>x.id===id);
    name=it?it.label:"Categorie";
    const used=readM(view).tx.filter(t=>t.cat===id).length;
    if(used)note=", "+used+" boeking"+(used>1?"en":"")+" blijft staan zonder categorie";
  }else if(k==="sav"){
    const it=state.savings.find(x=>x.id===id);
    name=it?it.label:"Spaardoel";
  }
  closePanel();
  withUndo("“"+name+"”"+(note||" verwijderd"),()=>{
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
  });
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
  editM(view).tx.push({id:uid(),label:d,amount:a,cat:$("txCat").value,date:date,pay:txPay});
  $("txDesc").value="";$("txAmt").value="";txDate=null;
  save();render();
};

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
    const dp=sv&&(sv.deposits||[]).find(x=>x.id===depId);
    withUndo("Storting van "+(dp?eur(dp.amount):"")+" verwijderd",()=>{
      const t=state.savings.find(x=>x.id===svId);
      if(t)t.deposits=(t.deposits||[]).filter(x=>x.id!==depId);
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
$("expBtn").onclick=()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="budget-"+isoOf(NOW)+".json";
  a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
};
$("impBtn").onclick=()=>$("impFile").click();
$("impFile").onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const d=JSON.parse(r.result);
      if(!d||!Array.isArray(d.income)||!Array.isArray(d.expenses))throw 0;
      if(!confirm("Dit vervangt je huidige gegevens. Doorgaan?"))return;
      const snap=JSON.stringify(state);
      state=fix(d);save();render();
      toast("Gegevens geïmporteerd",()=>{state=JSON.parse(snap);save();render();});
    }catch(err){toast("Dit bestand is geen geldige budget-export",null);}
  };
  r.readAsText(f);
  e.target.value="";
};
$("wipeBtn").onclick=()=>{
  if(!confirm("Alles wissen en opnieuw beginnen met de standaardgegevens?"))return;
  const snap=JSON.stringify(state);
  state=seed();save();view=TODAY_YM;render();
  toast("Alles gewist",()=>{state=JSON.parse(snap);save();render();});
};

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

render();

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
