// 原样摘录：Eleven-tz/laozu-solver-juexing index.html 中的 buildTalentMap / effBase（仅用于对拍测试，勿修改）
function buildTalentMap(ids){
  const m={},seen=new Set(),conv={2004:2001,2005:2002,2006:2003};
  for(const id of ids){if(!id||seen.has(String(id)))continue;seen.add(String(id));
    const t=TALENT_BY_ID[id];if(!t)continue;const ba=conv[t.attr];if(!ba)continue;
    (m[t.form]??={})[ba]=((m[t.form]??={})[ba]??0)+t.value;}
  return m;
}
function effBase(eq,starsMap,talentMap,attr,awakenMap){
  const b=eq.base.find(x=>x.attr===attr),bv=b?b.value:0;let o=0;
  // 原版逻辑：仅 quality===5 且有 elder 数据的红装吃星级加成，按装备 ID 查星级
  const stars=starsMap?(starsMap[eq.id]??0):0;
  if(eq.quality===5&&eq.elder&&eq.elder.starBonus&&stars>0){let s=0;for(const [th,v] of eq.elder.starBonus)if(th<=stars)s=v;o+=s/DE;}
  o+=((talentMap[eq.weaponForm]||{})[attr]??0)/DE;
  // 觉醒：自身基础属性提升与星级/天赋独立乘算（按觉醒等级查，1/2/3级累积）
  let aw=0;
  const awLv=awakenMap?(awakenMap[eq.id]??0):0;
  const awData=AWAKEN_DB[eq.id];
  if(awData){
    for(let lv=1;lv<=5&&lv<=awLv;lv++){
      const effs=awData.levels[lv];
      if(!effs)continue;
      for(const ef of effs)if(ef.type==="self_mult")aw+=ef.pct/DE;
    }
  }
  const v=bv*(1+o)*(1+aw);
  return v>bv?Math.floor(v):bv;
}
