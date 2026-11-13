import { FAMILIES, FAMILY_NAMES, FAMILY_WEAPON, TECHNIQUES, techniqueId, techniqueParents, familyOf, type Family, type TechniqueId } from '../sim/techniques';
import { CORE_IDS, CORES, SPELL_IDS, SPELLS, spellId, spellCooldown, type AbilityId, type SpellId, type CoreId } from '../sim/abilities';
import { SKILLS, SKILL_BRANCHES, PREREQUISITES, canLearn, type SkillId } from '../sim/skills';
import type { Champion } from '../shared/protocol';
import { skillIcon } from './icons';
import type { WeaponId } from '../sim/weapons';
import { weapon } from '../sim/weapons';
import type { LoadoutWeapon } from './loadout';
type Branch = Family | 'spells' | 'cores' | 'vows';
type Page = Branch | 'all';
type Node = { page: Branch; skill: SkillId; title: string; x: number; y: number; key: string; ability?: AbilityId; parents: SkillId[] };
export interface TreeActions {
  learn(id: SkillId): Promise<void>;
  spell(id: SpellId): Promise<void>;
  core(id: CoreId): Promise<void>;
  preview(id: AbilityId, weapon?: WeaponId): void;
  inventory(): Promise<LoadoutWeapon[]>;
  equip(tokenId: string): Promise<string>;
  market(): void;
}
const HOLD_MS = 1100;
const PAGES: Branch[] = [...FAMILIES, 'spells', 'cores', 'vows'];
const pageName = (p: Page) => p === 'all' ? 'All paths' : p === 'spells' ? 'Q · Spells' : p === 'cores' ? 'R · Ultimates' : p === 'vows' ? 'Soul vows' : FAMILY_NAMES[p];
const nodeKey = (n: Node) => `${n.page}:${n.skill}`;
export class SkillTree {
  private page: Page = 'all';
  private chosen = false;
  private regions: { page: Branch; x: number; y: number; width: number; color: string }[] = [];
  private selected: string | null = null;
  private champion!: Champion;
  private busy = false;
  private cancelHold = () => {};
  private observer?: ResizeObserver;
  private camera = { x: 0, y: 0, scale: 1 };
  private resetCamera = true;
  /** Skills known at the previous render; anything new gets a one-time bloom. */
  private known: Set<SkillId> | null = null;
  constructor(private root: HTMLElement, private actions: TreeActions) {}
  render(champion: Champion, busy: boolean) {
    this.cancelHold(); this.observer?.disconnect();
    const theatre = document.querySelector<HTMLElement>('.skill-theatre');
    theatre?.remove();
    this.champion = champion; this.busy = busy;
    if (!this.chosen) { this.page = familyOf(champion.build.weaponId ?? 'starter'); this.chosen = true; }
    const title = 'Skill paths', all = this.page === 'all';
    if (theatre) theatre.hidden = false;
    const width = 2160, height = 1320;
    const colors = ['#ce9b68','#bd8980','#a49fbc','#a0ae83','#81aaa7','#c27a64','#bdac75','#a196c0','#c79567','#aeaaa0'];
    const regions = PAGES.map((page,i)=>({page,x:(i%4)*540,y:Math.floor(i/4)*440,color:colors[i],width:page==='vows'?1100:520}));
    const nodes = regions.flatMap(r=>this.branchNodes(r.page).map(n=>({...n,x:(r.x+60+n.x*(r.page==='vows'?9.6:4.2))/width*100,y:(r.y+65+n.y*3.6)/height*100})));
    this.regions = regions;
    if (!nodes.some(n => nodeKey(n) === this.selected)) this.selected = nodeKey(nodes.find(n => n.page === this.page) ?? nodes[0]);
    const owned = (skill: SkillId) => champion.skills.includes(skill);
    const unique = [...new Set(nodes.map(n => n.skill))];
    const learned = unique.filter(owned).length;
    const ready = unique.filter(id => !owned(id) && canLearn(champion.skills, id) && champion.coins >= SKILLS[id].cost).length;
    const fresh = new Set(this.known ? unique.filter(id => owned(id) && !this.known!.has(id)) : []);
    if(!champion.chain?.pending)this.known = new Set(champion.skills);
    const inHand = familyOf(champion.build.weaponId ?? 'starter');
    const candidates=this.branchNodes(inHand).filter(n=>!owned(n.skill)&&canLearn(champion.skills,n.skill));
    const next=candidates.find(n=>champion.coins>=SKILLS[n.skill].cost);
    const shortfall=candidates.length?Math.max(0,Math.min(...candidates.map(n=>SKILLS[n.skill].cost))-champion.coins):0;
    const tab = (p: Branch) => { const ids = [...new Set(this.branchNodes(p).map(n => n.skill))], have = ids.filter(owned).length; return `<button data-page="${p}" aria-pressed="${p === this.page}" class="${have === ids.length ? 'complete' : ''}" style="--path-color:${colors[PAGES.indexOf(p)]}"><span>${pageName(p)}${inHand === p ? '<em>IN HAND</em>' : ''}</span><i><b style="width:${have / ids.length * 100}%"></b></i><small>${have} / ${ids.length}</small></button>`; };
    const summary = document.getElementById('forge-summary');
    if (summary) summary.innerHTML = `<div class="tree-progress"><b>${learned}</b><span>/ ${unique.length} LEARNED</span><i><b style="width:${learned / unique.length * 100}%"></b></i></div><p class="${ready ? 'ready' : ''}">${ready ? `<b>${ready}</b> ready to learn with your ${champion.coins} coin` : learned === unique.length ? 'Every path is complete.' : shortfall ? `${shortfall} more coin for your next ${FAMILY_NAMES[inHand].toLowerCase()} technique.` : 'Explore another path.'}</p>`;
    const spell = spellId(champion.build.spell), core = champion.build.core as CoreId | undefined;
    const slot = (key: string, jump: string, name: string, ready: boolean, note: string) => `<button class="loadout-slot ${ready ? 'ready' : 'empty'}${fresh.has(jump.split(':')[1] as SkillId) && !champion.chain?.pending ? ' just-learned' : ''}" data-jump="${jump}" aria-label="${key}: ${name}, ${note}"><kbd>${key}</kbd><span>${name}</span><small>${note}</small></button>`;
    const bar = [1, 2, 3, 4].map(n => { const id = `${inHand}-${n}` as TechniqueId; return slot(String(n), `${inHand}:${id}`, TECHNIQUES[id].name, owned(id), owned(id) ? 'READY' : `${SKILLS[id].cost} COIN`); }).join('')
      + slot('Q', `spells:${SPELLS[spell].skill}`, SPELLS[spell].name, owned(SPELLS[spell].skill), owned(SPELLS[spell].skill) ? 'SPELL' : 'NOT LEARNED')
      + slot('R', `cores:${core ?? CORE_IDS[0]}`, core ? CORES[core].name : 'No ultimate', !!core && owned(core), core ? 'ULTIMATE' : 'CHOOSE ONE');
    this.root.innerHTML = `
      <div class="tree-loadout"><div class="tree-loadout-title"><span class="eyebrow">YOUR ACTION BAR</span><p>${FAMILY_NAMES[inHand]} in hand · these are the keys you press in a fight</p></div><div class="tree-loadout-slots">${bar}</div></div>
      <nav class="tree-tabs" aria-label="Skill categories"><button data-page="all" aria-pressed="${all}" class="all"><span>ALL PATHS</span></button><span class="tree-tabs-label">WEAPONS</span>${FAMILIES.map(tab).join('')}<span class="tree-tabs-label">SOUL</span>${(['spells', 'cores', 'vows'] as const).map(tab).join('')}</nav>
      <div class="tree-workspace"><div class="tree-explorer"><div class="tree-toolbar" aria-label="Tree navigation"><button data-camera="out" aria-label="Zoom out">−</button><output class="tree-zoom" aria-label="Zoom level">100%</output><button data-camera="in" aria-label="Zoom in">+</button><button data-camera="fit">Fit tree</button><button data-camera="selected">Find selected</button><ul class="tree-legend" aria-label="Legend"><li class="learned">Learned</li><li class="reachable">Ready</li><li class="sealed">Locked</li></ul></div><div class="tree-viewport" tabindex="0" role="region" aria-label="${title} skill map. Arrow keys pan; plus and minus zoom; Home fits the tree."><div class="tree-map" style="width:${width}px;height:${height}px">
      ${regions.map(r=>`<section class="atlas-region" style="left:${r.x}px;top:${r.y}px;width:${r.width}px;--path-color:${r.color}"><h4>${pageName(r.page)}</h4>${r.page==='vows'?SKILL_BRANCHES.map((b,i)=>`<div class="vow-row-title" style="top:${65+(4+i*32)*3.6}px"><b>${b.name}</b><small>${b.subtitle}</small></div>`).join(''):''}</section>`).join('')}<svg class="tree-links" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${nodes.map(n=>n.parents.map(p=>{ const parent=nodes.find(v=>v.skill===p&&v.page===n.page); if(!parent)return '';const x=parent.x*width/100,y=parent.y*height/100,nx=n.x*width/100,ny=n.y*height/100;return `<path class="${champion.skills.includes(n.skill)?'grown':champion.skills.includes(p)?'growing':''}${fresh.has(n.skill)?' fresh':''}" d="M${x} ${y} C${(x+nx)/2} ${y} ${(x+nx)/2} ${ny} ${nx} ${ny}"/>`;}).join('')).join('')}</svg>
      ${nodes.map(n=>`<button class="tree-node ${n.page==='vows'?'vow-node':''} ${champion.skills.includes(n.skill)?'learned':canLearn(champion.skills,n.skill)?(champion.coins>=SKILLS[n.skill].cost?'reachable':'reachable costly'):'sealed'}${fresh.has(n.skill)?' fresh':''}" data-node="${nodeKey(n)}" title="${n.title} · ${owned(n.skill)?'Learned':SKILLS[n.skill].cost+' coin'} · ${SKILLS[n.skill].description}" style="left:${n.x}%;top:${n.y}%;--path-color:${colors[PAGES.indexOf(n.page)]}" aria-label="${n.title}${champion.skills.includes(n.skill)?', learned':', '+SKILLS[n.skill].cost+' coin'}" aria-pressed="${this.selected===nodeKey(n)}"><span class="node-orb">${skillIcon(n.skill)}<em>${n.key}</em></span><strong>${n.title}</strong><small>${n.skill===next?.skill?'NEXT · ':''}${champion.skills.includes(n.skill)?'LEARNED':SKILLS[n.skill].cost+' COIN'}</small></button>`).join('')}
      </div></div><p class="tree-map-hint">Drag to explore · Scroll to zoom · Select a skill, then hold to learn it</p></div><div class="tree-side"><aside id="tree-detail" class="tree-detail" aria-live="polite"></aside></div></div>`;
    if (theatre) this.root.querySelector('.tree-side')!.prepend(theatre);
    const overview = document.createElement('nav');
    overview.className = 'tree-minimap';
    overview.setAttribute('aria-label', 'Jump to a skill region');
    overview.innerHTML = `<div class="minimap-title"><span>ATLAS</span><span>${FAMILY_NAMES[inHand]}</span><button class="minimap-toggle" aria-label="Fold atlas" aria-expanded="true">−</button></div><div class="minimap-map">${regions.map(r=>`<button data-region="${r.page}" title="${pageName(r.page)}${r.page===inHand?' · In hand':''}" aria-label="${pageName(r.page)}${r.page===inHand?', in hand':''}" class="${r.page===inHand?'in-hand':''}" style="left:${r.x/width*100}%;top:${r.y/height*100}%;width:${r.width/width*100}%;--path-color:${r.color}">${skillIcon(this.branchNodes(r.page)[0].skill)}</button>`).join('')}<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><rect class="minimap-view"/></svg></div>`;
    this.root.querySelector('.tree-explorer')!.append(overview);
    const toggle=overview.querySelector<HTMLButtonElement>('.minimap-toggle')!, mini=overview.querySelector<HTMLElement>('.minimap-map')!;
    toggle.onclick=()=>{mini.hidden=!mini.hidden;toggle.textContent=mini.hidden?'+':'−';toggle.setAttribute('aria-expanded',String(!mini.hidden));toggle.setAttribute('aria-label',mini.hidden?'Expand atlas':'Fold atlas');};
    this.root.querySelectorAll<HTMLElement>('.atlas-region')[PAGES.indexOf(inHand)].classList.add('in-hand');
    const choosePage=(page:Page)=>{
      this.page=page;
      for(const b of this.root.querySelectorAll('[data-page]'))b.setAttribute('aria-pressed',String((b as HTMLElement).dataset.page===page));
      if(page==='all'){this.root.querySelector<HTMLButtonElement>('[data-camera="fit"]')!.click();return;}
      const n=nodes.find(n=>n.page===page)!;this.selected=nodeKey(n);
      this.root.querySelector<HTMLButtonElement>(`[data-node="${this.selected}"]`)!.click();
      this.focusRegion(true);
    };
    // The action bar: exactly what the keys do in a fight. Each slot jumps to its skill.
    for(const b of this.root.querySelectorAll<HTMLButtonElement>('[data-jump]')) b.onclick=()=>{
      const [page]=b.dataset.jump!.split(':');
      if(page==='spells'||page==='cores'){
        const previous=this.root.querySelector('.quick-equip');if(previous){previous.remove();return;}
        const picker=document.createElement('div');picker.className='quick-equip';picker.setAttribute('role','group');picker.setAttribute('aria-label',page==='spells'?'Equip spell':'Equip ultimate');
        const choices=nodes.filter(n=>n.page===page&&owned(n.skill));
        for(const n of choices){const option=document.createElement('button');option.textContent=n.title;option.disabled=this.busy||!!champion.chain?.pending;option.onclick=()=>{picker.remove();void(page==='spells'?this.actions.spell(n.ability as SpellId):this.actions.core(n.ability as CoreId));};picker.append(option);}
        const explore=document.createElement('button');explore.textContent='Explore this path ↗';explore.onclick=()=>{picker.remove();choosePage(page as Page);};picker.append(explore);
        b.after(picker);picker.querySelector('button')?.focus();
        picker.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();picker.remove();b.focus();}};

        return;
      }
      choosePage(page as Page);
      this.root.querySelector<HTMLButtonElement>(`[data-node="${b.dataset.jump}"]`)?.click();
    };
    this.root.onclick=e=>{
      const target=e.target as HTMLElement,picker=this.root.querySelector('.quick-equip');
      if(picker&&!picker.contains(target)&&!target.closest('[data-jump]'))picker.remove();
    };
    for(const b of this.root.querySelectorAll<HTMLButtonElement>('[data-page]')) b.onclick=()=>choosePage(b.dataset.page as Page);
    for(const b of overview.querySelectorAll<HTMLButtonElement>('[data-region]')) b.onclick=()=>choosePage(b.dataset.region as Page);
    for(const b of this.root.querySelectorAll<HTMLButtonElement>('[data-node]')) {
      b.onclick=()=>{this.cancelHold();this.selected=b.dataset.node!;for(const el of this.root.querySelectorAll('[data-node]'))el.setAttribute('aria-pressed',String(el===b));const n=nodes.find(n=>nodeKey(n)===this.selected)!;this.detail(n);this.previewNode(n);};
      b.onfocus=()=>this.reveal(b);
      b.onkeydown=e=>{const direction=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[e.key];if(!direction)return;e.preventDefault();const from=nodes.find(n=>nodeKey(n)===b.dataset.node)!;const candidate=nodes.filter(n=>n.page===from.page&&n!==from).map(n=>({n,dx:n.x-from.x,dy:n.y-from.y})).filter(v=>v.dx*direction[0]+v.dy*direction[1]>.01).sort((a,b)=>Math.hypot(a.dx,a.dy)+Math.abs(a.dx*direction[1]-a.dy*direction[0])*2-Math.hypot(b.dx,b.dy)-Math.abs(b.dx*direction[1]-b.dy*direction[0])*2)[0];if(candidate)this.root.querySelector<HTMLButtonElement>(`[data-node="${nodeKey(candidate.n)}"]`)?.focus();};
    }
    this.detail(nodes.find(n=>nodeKey(n)===this.selected)!);
    this.navigation();
    this.previewNode(nodes.find(n=>nodeKey(n)===this.selected)!);
  }
  /** Frame the current path so its names are readable without zooming. */
  private focusRegion(glide: boolean) {
    const r=this.regions.find(r=>r.page===this.page),vp=this.root.querySelector<HTMLElement>('.tree-viewport');
    if(!r||!vp||!vp.clientWidth)return;
    const scale=Math.min(1.5,(vp.clientWidth-40)/(r.width+20),(vp.clientHeight-30)/440);
    this.camera={scale,x:vp.clientWidth/2-(r.x+(r.width+20)/2)*scale,y:vp.clientHeight/2-(r.y+220)*scale};this.paintCamera(glide);
  }
  focusWeapon(identity: WeaponId) {
    this.page = familyOf(identity); this.chosen = true; this.selected = `${familyOf(identity)}:${familyOf(identity)}-1`; this.resetCamera = true;
  }
  close() { this.cancelHold(); this.observer?.disconnect(); this.resetCamera = true; }
  private previewNode(n: Node) {
    if(n.ability) this.actions.preview(n.ability,FAMILIES.includes(n.page as Family)?(familyOf(this.champion.build.weaponId ?? "starter")===n.page?this.champion.build.weaponId ?? "starter":FAMILY_WEAPON[n.page as Family]):undefined);
  }
  private branchNodes(page: Branch): Node[] {
    if(FAMILIES.includes(page as Family))return [1,2,3,4].map((n,i)=>{const skill=`${page}-${n}` as TechniqueId;return {page,skill,title:TECHNIQUES[skill].name,x:[9,46,46,88][i],y:[36,12,60,36][i],key:String(n),ability:skill,parents:techniqueParents(skill)};});
    if(page==='spells')return SPELL_IDS.map((id,i)=>({page,skill:SPELLS[id].skill,title:SPELLS[id].name,x:14+i*36,y:36,key:'Q',ability:id,parents:[]}));
    if(page==='cores')return CORE_IDS.map((id,i)=>({page,skill:id,title:CORES[id].name,x:14+i*36,y:36,key:'R',ability:id,parents:[]}));
    return SKILL_BRANCHES.flatMap((b,i)=>b.skills.map((skill,j)=>({page,skill,title:SKILLS[skill].name,x:22+j*24,y:4+i*32,key:String(j+1),parents:PREREQUISITES[skill]?[PREREQUISITES[skill]!]:[]})));
  }
  private reveal(node: HTMLElement) {
    const viewport=this.root.querySelector<HTMLElement>('.tree-viewport')!;
    const a=node.getBoundingClientRect(),b=viewport.getBoundingClientRect();
    if(a.left<b.left||a.right>b.right||a.top<b.top||a.bottom>b.bottom) {
      this.camera.x+=(b.left+b.right-a.left-a.right)/2;
      this.camera.y+=(b.top+b.bottom-a.top-a.bottom)/2;
      this.paintCamera(true);
    }
  }
  /** Programmatic moves glide so the eye can follow; drags and the wheel stay immediate. */
  private paintCamera(glide = false) {
    const map=this.root.querySelector<HTMLElement>('.tree-map')!;
    map.classList.toggle("glide",glide);
    map.classList.toggle("atlas-overview",this.camera.scale<.65);
    map.style.setProperty("--label-scale",String(Math.min(1.3,Math.max(1,1/this.camera.scale))));
    map.style.transform=`translate(${this.camera.x}px,${this.camera.y}px) scale(${this.camera.scale})`;
    this.root.querySelector('output')!.textContent=`${Math.round(this.camera.scale*100)}%`;
    const vp=this.root.querySelector<HTMLElement>('.tree-viewport')!, rect=this.root.querySelector('.minimap-view')!;
    const x=Math.max(0,Math.min(2160,-this.camera.x/this.camera.scale)), y=Math.max(0,Math.min(1320,-this.camera.y/this.camera.scale));
    const right=Math.max(x,Math.min(2160,(vp.clientWidth-this.camera.x)/this.camera.scale)), bottom=Math.max(y,Math.min(1320,(vp.clientHeight-this.camera.y)/this.camera.scale));
    for(const [key,value] of Object.entries({x,y,width:right-x,height:bottom-y}))rect.setAttribute(key,String(value));
    for(const b of this.root.querySelectorAll<HTMLElement>('[data-region]'))b.setAttribute('aria-current',String(b.dataset.region===this.page));
  }
  private navigation() {
    const viewport=this.root.querySelector<HTMLElement>('.tree-viewport')!,map=this.root.querySelector<HTMLElement>('.tree-map')!;
    const fit=(glide=false)=>{if(!viewport.clientWidth)return;this.page='all';for(const b of this.root.querySelectorAll<HTMLElement>('[data-page]'))b.setAttribute('aria-pressed',String(b.dataset.page==='all'));const scale=Math.max(.12,Math.min((viewport.clientWidth-28)/map.offsetWidth,(viewport.clientHeight-28)/map.offsetHeight,1));this.camera={scale,x:(viewport.clientWidth-map.offsetWidth*scale)/2,y:(viewport.clientHeight-map.offsetHeight*scale)/2};this.paintCamera(glide);};
    const zoom=(factor:number,x=viewport.clientWidth/2,y=viewport.clientHeight/2,glide=false)=>{const old=this.camera.scale,next=Math.max(.12,Math.min(2,old*factor));this.camera={scale:next,x:x-(x-this.camera.x)*next/old,y:y-(y-this.camera.y)*next/old};this.paintCamera(glide);};
    // Start with every region visible; category buttons focus a readable cluster.
    const open=()=>{ if(this.page==='all')fit(); else this.focusRegion(false); };
    if(this.resetCamera){requestAnimationFrame(open);this.resetCamera=false;}else this.paintCamera();
    let lastWidth=viewport.clientWidth,lastHeight=viewport.clientHeight;
    this.observer=new ResizeObserver(()=>{if(viewport.clientWidth!==lastWidth||viewport.clientHeight!==lastHeight){lastWidth=viewport.clientWidth;lastHeight=viewport.clientHeight;open();}});this.observer.observe(viewport);
    for(const button of this.root.querySelectorAll<HTMLButtonElement>('[data-camera]'))button.onclick=()=>{
      const op=button.dataset.camera;
      if(op==='fit')fit(true);else if(op==='selected') {const n=this.root.querySelector<HTMLElement>('[data-node][aria-pressed=true]')!;this.camera.scale=1;this.camera.x=viewport.clientWidth/2-n.offsetLeft;this.camera.y=viewport.clientHeight/2-n.offsetTop;this.paintCamera(true);}else zoom(op==='in'?1.25:.8,undefined,undefined,true);
    };
    viewport.onwheel=e=>{e.preventDefault();const r=viewport.getBoundingClientRect();zoom(Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.004),e.clientX-r.left,e.clientY-r.top);};
    let pointer:number|null=null,lastX=0,lastY=0;
    viewport.onpointerdown=e=>{if(e.button!==0||(e.target as HTMLElement).closest('button'))return;pointer=e.pointerId;lastX=e.clientX;lastY=e.clientY;viewport.setPointerCapture(pointer);viewport.focus({preventScroll:true});viewport.classList.add('dragging');};
    viewport.onpointermove=e=>{if(e.pointerId!==pointer)return;this.camera.x+=e.clientX-lastX;this.camera.y+=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;this.paintCamera();};
    const stop=()=>{pointer=null;viewport.classList.remove('dragging');};viewport.onpointerup=stop;viewport.onpointercancel=stop;viewport.onlostpointercapture=stop;
    viewport.onkeydown=e=>{if(e.target!==viewport)return;const delta:Record<string,[number,number]>={ArrowLeft:[70,0],ArrowRight:[-70,0],ArrowUp:[0,70],ArrowDown:[0,-70]};if(delta[e.key]){e.preventDefault();this.camera.x+=delta[e.key][0];this.camera.y+=delta[e.key][1];this.paintCamera();}else if(['+','=','-','Home'].includes(e.key)){e.preventDefault();if(e.key==='Home')fit(true);else zoom(e.key==='-'?.8:1.25,undefined,undefined,true);}};
  }
  private detail(n: Node) {
    const page = n.page;
    const theatre=this.root.querySelector<HTMLElement>('.skill-theatre');if(theatre)theatre.hidden=!n.ability;
    const c = this.champion, known = c.skills.includes(n.skill), ready = canLearn(c.skills,n.skill), enough = c.coins >= SKILLS[n.skill].cost;
    const t = techniqueId(n.skill), spec = t ? TECHNIQUES[t] : null;
    const parents = t ? techniqueParents(t) : PREREQUISITES[n.skill] ? [PREREQUISITES[n.skill]!] : [];
    const current = page === 'cores' ? c.build.core === n.ability : page === 'spells' ? spellId(c.build.spell) === n.ability : false;
    const featureReady = !c.chain || c.chain.features?.includes('weapon_skills') || (!t && !n.skill.endsWith('-spell'));
    const blocked = this.busy || !!c.chain?.pending || !featureReady;
    const description = page === 'cores' ? CORES[n.ability as CoreId].description : page === 'spells' ? SPELLS[n.ability as SpellId].description : SKILLS[n.skill].description;
    const detail = this.root.querySelector<HTMLElement>('#tree-detail')!;
    const inHand = !t || familyOf(c.build.weaponId ?? 'starter') === page;
    const level = inHand ? c.build.weaponLevel ?? 0 : 0;
    const missing = parents.filter(p=>!c.skills.includes(p));
    const requirement = known ? (t && !inHand ? `Equip ${FAMILY_NAMES[page as Family].toLowerCase()} to use this skill.` : '') :
      !ready ? `Requires ${missing.map(p=>SKILLS[p].name).join(' + ')}.` :
      !enough ? `${SKILLS[n.skill].cost-c.coins} more coin needed. Earn coin in Solo.` : '';
    detail.innerHTML = `<span class="eyebrow">${page === 'cores' ? 'ULTIMATE · R' : page === 'spells' ? 'SPELL · Q' : t ? 'WEAPON TECHNIQUE · '+n.key : 'PASSIVE VOW'}</span>
      <h3>${n.title}</h3><p>${description}</p>
      ${spec ? `<div class="technique-stats"><span><b>${spec.damage+level*2}</b>base damage / hit</span><span><b>${spec.cooldown}s</b>cooldown</span></div>` : page === 'spells' ? `<div class="technique-stats"><span><b>${spellCooldown(Object.fromEntries(c.skills.map(id=>[id,1]))).toFixed(1)}s</b>cooldown</span><span><b>+25%</b>next weapon hit</span></div>` : page === 'cores' ? '<p class="core-cost">Requires a full soul core. Charge it by dealing damage.</p>' : ''}
      ${requirement ? `<p class="tree-requirement">${requirement}</p>` : ''}
      ${known ? (page === 'spells' || page === 'cores' ? `<button class="btn tree-select" ${blocked || current ? 'disabled':''}>${current?'EQUIPPED ON '+n.key: 'EQUIP ON '+n.key}</button>` : `<span class="tree-learned">✓ ${t?(inHand?'READY ON '+n.key:'LEARNED'):'ALWAYS ACTIVE'}</span>`) : `<button class="btn hold-learn" ${blocked || !ready || !enough ? 'disabled':''} aria-label="Hold to learn ${n.title} for ${SKILLS[n.skill].cost} coin"><span class="hold-fill"></span><span class="hold-copy">${!featureReady?'UPDATE REQUIRED':blocked?'CONFIRMING…':`HOLD TO LEARN · ${SKILLS[n.skill].cost} COIN`}</span></button>`}
      ${n.ability?'<button class="tree-preview">↻ Replay animation</button>':''}
      <details class="tree-extra"><summary>Progression details</summary><p>${spec ? `Damage shown at weapon +${level}, circle rank 1. Each weapon level adds 2 damage; each additional circle rank adds 15%.` : SKILLS[n.skill].rank}${n.title!==SKILLS[n.skill].name?` Unlocks with ${SKILLS[n.skill].name}.`:''}</p></details><span class="hold-status" role="status"></span>`;
    const preview = () => this.previewNode(n);
    if (t && !inHand) {
      const change=document.createElement('button');change.className='btn ghost tree-weapon';change.textContent=`EQUIP ${FAMILY_NAMES[page as Family].toUpperCase()} ↗`;change.disabled=blocked;
      const picker=document.createElement('div');picker.className='tree-weapon-picker';picker.setAttribute('aria-live','polite');
      detail.querySelector('.tree-extra')!.before(change,picker);
      change.onclick=async()=>{
        change.disabled=true;picker.textContent='Finding your weapons…';
        try {
          const choices=(await this.actions.inventory()).filter(w=>familyOf(w.identity)===page);
          if(!change.isConnected)return;
          picker.replaceChildren();
          if(!choices.length){const empty=document.createElement('p');empty.textContent='You do not own this weapon family yet.';const market=document.createElement('button');market.className='tree-preview';market.textContent='Explore weapons ↗';market.onclick=()=>this.actions.market();picker.append(empty,market);}
          for(const w of choices){
            const option=document.createElement('button');option.className='tree-owned-weapon';option.disabled=w.blocked;
            const duplicate=choices.filter(v=>v.identity===w.identity&&v.level===w.level).length>1;
            option.textContent=`${weapon(w.identity).name} +${w.level}${duplicate?' · #'+w.tokenId.slice(-6):''}${w.blocked?' · Unavailable':' · Equip'}`;
            option.title=`${w.kills} kills · ${w.tokenId}${w.blocked?' · Listed or equipped on another champion':''}`;
            option.onclick=async()=>{for(const b of picker.querySelectorAll('button'))b.disabled=true;detail.querySelector('.hold-status')!.textContent='Equipping weapon…';try{const message=await this.actions.equip(w.tokenId);const status=this.root.querySelector('.hold-status');if(status)status.textContent=message;}catch(e){if(picker.isConnected){picker.textContent=(e as Error).message;detail.querySelector('.hold-status')!.textContent='';}}finally{if(change.isConnected)change.disabled=false;}};
            picker.append(option);
          }
        } catch(e){if(picker.isConnected)picker.textContent=(e as Error).message;}
        finally{if(change.isConnected)change.disabled=false;}
      };
    }
    detail.querySelector<HTMLButtonElement>('.tree-preview')?.addEventListener('click',preview);
    detail.querySelector<HTMLButtonElement>('.tree-select')?.addEventListener('click',()=>{ void (page === 'spells' ? this.actions.spell(n.ability as SpellId) : this.actions.core(n.ability as CoreId)); });
    const button = detail.querySelector<HTMLButtonElement>('.hold-learn');
    if (!button || button.disabled) return;
    let frame=0, start=0, active=false, finished=false;
    const reset=()=>{ cancelAnimationFrame(frame); active=false; (this.root.querySelector(`[data-node="${nodeKey(n)}"]`) as HTMLElement | null)?.style.setProperty("--learn", "0%"); button.style.setProperty('--learn','0%'); this.root.querySelector(`[data-node="${nodeKey(n)}"]`)?.classList.remove('learning'); };
    const cancel=()=>{ if (!finished) reset(); };
    const onBlur=()=>cancel(), onVisibility=()=>{ if(document.hidden) cancel(); };
    window.addEventListener('blur',onBlur); document.addEventListener('visibilitychange',onVisibility);
    this.cancelHold=()=>{cancel(); window.removeEventListener('blur',onBlur); document.removeEventListener('visibilitychange',onVisibility);};
    const tick=(now:number)=>{ if(!active) return; const fraction=Math.min(1,(now-start)/HOLD_MS); button.style.setProperty('--learn',`${fraction*100}%`); (this.root.querySelector(`[data-node="${nodeKey(n)}"]`) as HTMLElement | null)?.style.setProperty("--learn",`${fraction*100}%`); if(fraction<1) {frame=requestAnimationFrame(tick);return;} finished=true;active=false;button.disabled=true; detail.querySelector('.hold-copy')!.textContent='CONFIRMING…'; detail.querySelector('.hold-status')!.textContent='Saving your learned skill…'; void this.actions.learn(n.skill); };
    const begin=()=>{ if(active || finished || button.disabled)return; active=true;start=performance.now();this.root.querySelector(`[data-node="${nodeKey(n)}"]`)?.classList.add('learning'); frame=requestAnimationFrame(tick); };
    button.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();button.focus();button.setPointerCapture(e.pointerId);begin();};
    button.onpointerup=cancel;button.onpointercancel=cancel;button.onlostpointercapture=cancel;
    button.onkeydown=e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();if(!e.repeat)begin();}};
    button.onkeyup=e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();cancel();}};
    button.onblur=cancel;button.oncontextmenu=e=>e.preventDefault();
  }
}
