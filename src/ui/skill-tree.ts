import { FAMILIES, FAMILY_NAMES, FAMILY_WEAPON, TECHNIQUES, techniqueId, techniqueParents, familyOf, type Family, type TechniqueId } from '../sim/techniques';
import { CORE_IDS, CORES, SPELL_IDS, SPELLS, spellId, type AbilityId, type SpellId, type CoreId } from '../sim/abilities';
import { SKILLS, SKILL_BRANCHES, PREREQUISITES, canLearn, type SkillId } from '../sim/skills';
import type { Champion } from '../shared/protocol';
import { skillIcon } from './icons';
import type { WeaponId } from '../sim/weapons';
type Branch = Family | 'spells' | 'cores' | 'vows';
type Page = Branch | 'all';
type Node = { page: Branch; skill: SkillId; title: string; x: number; y: number; key: string; ability?: AbilityId; parents: SkillId[] };
export interface TreeActions {
  learn(id: SkillId): Promise<void>;
  spell(id: SpellId): Promise<void>;
  core(id: CoreId): Promise<void>;
  preview(id: AbilityId, weapon?: WeaponId): void;
}
const HOLD_MS = 1100;
const PAGES: Branch[] = [...FAMILIES, 'spells', 'cores', 'vows'];
const pageName = (p: Page) => p === 'all' ? 'All paths' : p === 'spells' ? 'Q · Spells' : p === 'cores' ? 'R · Ultimates' : p === 'vows' ? 'Soul vows' : FAMILY_NAMES[p];
const nodeKey = (n: Node) => `${n.page}:${n.skill}`;
export class SkillTree {
  private page: Page = 'sword';
  private selected: string | null = null;
  private champion!: Champion;
  private busy = false;
  private cancelHold = () => {};
  private initialized = false;
  private observer?: ResizeObserver;
  private camera = { x: 0, y: 0, scale: 1 };
  private resetCamera = true;
  constructor(private root: HTMLElement, private actions: TreeActions) {}
  render(champion: Champion, busy: boolean) {
    this.cancelHold(); this.observer?.disconnect();
    const theatre = document.querySelector<HTMLElement>('.skill-theatre');
    theatre?.remove();
    this.champion = champion; this.busy = busy;
    if (!this.initialized) { this.page = familyOf(champion.build.weaponId ?? 'starter'); this.initialized = true; }
    const nodes = this.nodes();
    if (!nodes.some(n => nodeKey(n) === this.selected)) this.selected = nodeKey(nodes[0]);
    const title = pageName(this.page), all = this.page === 'all';
    this.root.innerHTML = `<nav class="tree-tabs" aria-label="Skill categories"><button data-page="all" aria-pressed="${all}">ALL PATHS</button>${PAGES.map(p => `<button data-page="${p}" aria-pressed="${p === this.page}">${pageName(p)}${familyOf(champion.build.weaponId ?? 'starter') === p ? '<i>In hand</i>' : ''}</button>`).join('')}</nav>
      <div class="tree-heading"><div><span class="eyebrow">THE LIVING ARSENAL</span><h3>${title}</h3></div><p>Drag to explore · Scroll to zoom<br>Select a skill to see its weapon in motion.</p></div>
      <div class="tree-workspace"><div class="tree-explorer"><div class="tree-toolbar" aria-label="Tree navigation"><button data-camera="out" aria-label="Zoom out">−</button><output class="tree-zoom" aria-label="Zoom level">100%</output><button data-camera="in" aria-label="Zoom in">+</button><button data-camera="fit">Fit tree</button><button data-camera="selected">Find selected</button><span>${nodes.length} skills</span></div><div class="tree-viewport" tabindex="0" role="region" aria-label="${title} skill map. Arrow keys pan; plus and minus zoom; Home fits the tree."><div class="tree-map" style="width:${all?2800:800}px;height:${all?1620:500}px">
      ${all ? PAGES.map((p,i)=>`<button class="tree-branch-label" data-branch="${p}" style="left:${(i%4)*25+12.5}%;top:${Math.floor(i/4)*33.333+1.5}%">${pageName(p)} ↗</button>`).join('') : ''}
      <svg class="tree-links" viewBox="0 0 1000 460" preserveAspectRatio="none" aria-hidden="true">${!all?'<path class="tree-trunk" d="M500 460 Q500 420 500 380 M500 450 Q410 425 390 455 M500 440 Q570 420 620 455"/>':''}${nodes.map(n=>n.parents.map(p=>{ const parent=nodes.find(v=>v.skill===p&&v.page===n.page); if(!parent)return '';const x=parent.x*10,y=parent.y*4.6-10,nx=n.x*10,ny=n.y*4.6-10;return `<path class="${champion.skills.includes(n.skill)?'grown':champion.skills.includes(p)?'growing':''}" d="M${x} ${y} C${x} ${(y+ny)/2} ${nx} ${(y+ny)/2} ${nx} ${ny}"/>`;}).join('')).join('')}</svg>
      ${nodes.map(n=>`<button class="tree-node ${champion.skills.includes(n.skill)?'learned':canLearn(champion.skills,n.skill)?'reachable':'sealed'}" data-node="${nodeKey(n)}" title="${n.title}" style="left:${n.x}%;top:${n.y}%" aria-label="${n.title}${champion.skills.includes(n.skill)?', learned':', '+SKILLS[n.skill].cost+' coin'}" aria-pressed="${this.selected===nodeKey(n)}"><span class="node-orb">${skillIcon(n.skill)}<em>${n.key}</em></span><strong>${n.title}</strong><small>${champion.skills.includes(n.skill)?'LEARNED':SKILLS[n.skill].cost+' COIN'}</small></button>`).join('')}
      ${!all?'<span class="tree-root-label">EARNED IN THE DESCENT</span>':''}</div></div><p class="tree-map-hint">Mouse / touch: drag · Keyboard: arrows, + / −, Home · Tab: browse skills</p></div><div class="tree-side"><aside id="tree-detail" class="tree-detail" aria-live="polite"></aside></div></div>`;
    if (theatre) this.root.querySelector('.tree-side')!.prepend(theatre);
    const choosePage=(page:Page)=>{this.page=page;this.selected=null;this.resetCamera=true;this.render(this.champion,this.busy);};
    for(const b of this.root.querySelectorAll<HTMLButtonElement>('[data-page]')) b.onclick=()=>choosePage(b.dataset.page as Page);
    for(const b of this.root.querySelectorAll<HTMLButtonElement>('[data-branch]')) b.onclick=()=>choosePage(b.dataset.branch as Branch);
    for(const b of this.root.querySelectorAll<HTMLButtonElement>('[data-node]')) {
      b.onclick=()=>{this.cancelHold();this.selected=b.dataset.node!;for(const el of this.root.querySelectorAll('[data-node]'))el.setAttribute('aria-pressed',String(el===b));const n=nodes.find(n=>nodeKey(n)===this.selected)!;this.detail(n);this.previewNode(n);};
      b.onfocus=()=>this.reveal(b);
    }
    this.detail(nodes.find(n=>nodeKey(n)===this.selected)!);
    this.navigation();
    this.previewNode(nodes.find(n=>nodeKey(n)===this.selected)!);
  }
  focusWeapon(identity: WeaponId) {
    this.page = familyOf(identity); this.selected = null; this.resetCamera = true; this.initialized = true;
  }
  close() { this.cancelHold(); }
  private previewNode(n: Node) {
    if(n.ability) this.actions.preview(n.ability,FAMILIES.includes(n.page as Family)?(familyOf(this.champion.build.weaponId ?? "starter")===n.page?this.champion.build.weaponId ?? "starter":FAMILY_WEAPON[n.page as Family]):undefined);
  }
  private branchNodes(page: Branch): Node[] {
    if(FAMILIES.includes(page as Family))return [1,2,3,4].map((n,i)=>{const skill=`${page}-${n}` as TechniqueId;return {page,skill,title:TECHNIQUES[skill].name,x:[50,25,75,50][i],y:[78,47,47,16][i],key:String(n),ability:skill,parents:techniqueParents(skill)};});
    if(page==='spells')return SPELL_IDS.map((id,i)=>({page,skill:SPELLS[id].skill,title:SPELLS[id].name,x:20+i*30,y:i===1?27:57,key:'Q',ability:id,parents:[]}));
    if(page==='cores')return CORE_IDS.map((id,i)=>({page,skill:id,title:CORES[id].name,x:20+i*30,y:i===1?27:57,key:'R',ability:id,parents:[]}));
    return SKILL_BRANCHES.flatMap((b,i)=>b.skills.map((skill,j)=>({page,skill,title:SKILLS[skill].name,x:18+i*32,y:81-j*22,key:String(j+1),parents:PREREQUISITES[skill]?[PREREQUISITES[skill]!]:[]})));
  }
  private nodes(): Node[] {
    return this.page==='all'?PAGES.flatMap((p,i)=>this.branchNodes(p).map(n=>({...n,x:(i%4)*25+n.x*.25,y:Math.floor(i/4)*100/3+9+n.y*(p==='vows'?.29:.23)}))):this.branchNodes(this.page);
  }
  private reveal(node: HTMLElement) {
    const viewport=this.root.querySelector<HTMLElement>('.tree-viewport')!;
    const a=node.getBoundingClientRect(),b=viewport.getBoundingClientRect();
    if(a.left<b.left||a.right>b.right||a.top<b.top||a.bottom>b.bottom) {
      this.camera.x+=(b.left+b.right-a.left-a.right)/2;
      this.camera.y+=(b.top+b.bottom-a.top-a.bottom)/2;
      this.paintCamera();
    }
  }
  private paintCamera() {
    const map=this.root.querySelector<HTMLElement>('.tree-map')!;
    map.style.setProperty("--label-scale",String(Math.min(2,Math.max(1,1/this.camera.scale))));
    map.style.transform=`translate(${this.camera.x}px,${this.camera.y}px) scale(${this.camera.scale})`;
    this.root.querySelector('output')!.textContent=`${Math.round(this.camera.scale*100)}%`;
  }
  private navigation() {
    const viewport=this.root.querySelector<HTMLElement>('.tree-viewport')!,map=this.root.querySelector<HTMLElement>('.tree-map')!;
    const fit=()=>{const scale=Math.min((viewport.clientWidth-28)/map.offsetWidth,(viewport.clientHeight-28)/map.offsetHeight,1);this.camera={scale:Math.max(.12,scale),x:(viewport.clientWidth-map.offsetWidth*scale)/2,y:(viewport.clientHeight-map.offsetHeight*scale)/2};this.paintCamera();};
    const zoom=(factor:number,x=viewport.clientWidth/2,y=viewport.clientHeight/2)=>{const old=this.camera.scale,next=Math.max(.12,Math.min(2,old*factor));this.camera={scale:next,x:x-(x-this.camera.x)*next/old,y:y-(y-this.camera.y)*next/old};this.paintCamera();};
    // On a narrow screen the whole tree only fits at an unreadable size, so open on the selected (or first) skill instead.
    const open=()=>{fit();if(this.camera.scale<.6){const n=this.root.querySelector<HTMLElement>('[data-node][aria-pressed=true]')??this.root.querySelector<HTMLElement>('[data-node]');if(n){const s=.8;this.camera={scale:s,x:viewport.clientWidth/2-(n.offsetLeft+n.offsetWidth/2)*s,y:viewport.clientHeight/2-(n.offsetTop+n.offsetHeight/2)*s};this.paintCamera();}}};
    if(this.resetCamera){requestAnimationFrame(open);this.resetCamera=false;}else this.paintCamera();
    let lastWidth=viewport.clientWidth,lastHeight=viewport.clientHeight;
    this.observer=new ResizeObserver(()=>{if(viewport.clientWidth!==lastWidth||viewport.clientHeight!==lastHeight){lastWidth=viewport.clientWidth;lastHeight=viewport.clientHeight;open();}});this.observer.observe(viewport);
    for(const button of this.root.querySelectorAll<HTMLButtonElement>('[data-camera]'))button.onclick=()=>{
      const op=button.dataset.camera;
      if(op==='fit')fit();else if(op==='selected') {const n=this.root.querySelector<HTMLElement>('[data-node][aria-pressed=true]')!;this.camera.scale=1;this.camera.x=viewport.clientWidth/2-n.offsetLeft;this.camera.y=viewport.clientHeight/2-n.offsetTop;this.paintCamera();}else zoom(op==='in'?1.25:.8);
    };
    viewport.onwheel=e=>{e.preventDefault();const r=viewport.getBoundingClientRect();zoom(Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.004),e.clientX-r.left,e.clientY-r.top);};
    let pointer:number|null=null,lastX=0,lastY=0;
    viewport.onpointerdown=e=>{if(e.button!==0||(e.target as HTMLElement).closest('button'))return;pointer=e.pointerId;lastX=e.clientX;lastY=e.clientY;viewport.setPointerCapture(pointer);viewport.focus({preventScroll:true});viewport.classList.add('dragging');};
    viewport.onpointermove=e=>{if(e.pointerId!==pointer)return;this.camera.x+=e.clientX-lastX;this.camera.y+=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;this.paintCamera();};
    const stop=()=>{pointer=null;viewport.classList.remove('dragging');};viewport.onpointerup=stop;viewport.onpointercancel=stop;viewport.onlostpointercapture=stop;
    viewport.onkeydown=e=>{if(e.target!==viewport)return;const delta:Record<string,[number,number]>={ArrowLeft:[70,0],ArrowRight:[-70,0],ArrowUp:[0,70],ArrowDown:[0,-70]};if(delta[e.key]){e.preventDefault();this.camera.x+=delta[e.key][0];this.camera.y+=delta[e.key][1];this.paintCamera();}else if(['+','=','-','Home'].includes(e.key)){e.preventDefault();if(e.key==='Home')fit();else zoom(e.key==='-'?.8:1.25);}};
  }
  private detail(n: Node) {
    const page = n.page;
    const c = this.champion, known = c.skills.includes(n.skill), ready = canLearn(c.skills,n.skill), enough = c.coins >= SKILLS[n.skill].cost;
    const t = techniqueId(n.skill), spec = t ? TECHNIQUES[t] : null;
    const parents = t ? techniqueParents(t) : PREREQUISITES[n.skill] ? [PREREQUISITES[n.skill]!] : [];
    const current = page === 'cores' ? c.build.core === n.ability : page === 'spells' ? spellId(c.build.spell) === n.ability : false;
    const featureReady = !c.chain || c.chain.features?.includes('weapon_skills') || (!t && !n.skill.endsWith('-spell'));
    const blocked = this.busy || !!c.chain?.pending || !featureReady;
    const description = page === 'cores' ? CORES[n.ability as CoreId].description : page === 'spells' ? SPELLS[n.ability as SpellId].description : SKILLS[n.skill].description;
    const detail = this.root.querySelector<HTMLElement>('#tree-detail')!;
    detail.innerHTML = `<span class="eyebrow">${page === 'cores' ? 'ULTIMATE · R' : page === 'spells' ? 'SPELL · Q' : t ? 'WEAPON TECHNIQUE · '+n.key : 'PASSIVE VOW'}</span><h3>${n.title}</h3><p>${description}</p>${spec ? `<div class="technique-stats"><span><b>${spec.damage}</b>base damage / hit</span><span><b>${spec.cooldown}s</b>cooldown</span><span><b>${spec.pulses ?? 1}</b>contact${(spec.pulses ?? 1)>1?'s':''}</span></div><small>+2 damage per weapon level. +15% technique damage per circle rank. Active with ${FAMILY_NAMES[page as Family].toLowerCase()} in hand.</small>` : `<small>${SKILLS[n.skill].rank}</small>`}<p class="tree-requirement">${known ? 'Learned permanently. No additional NFT or mint required.' : !ready ? 'First learn: '+parents.filter(p=>!c.skills.includes(p)).map(p=>SKILLS[p].name).join(' + ') : !enough ? `You have ${c.coins} coin. Earn ${SKILLS[n.skill].cost-c.coins} more in Solo.` : 'Hold to learn. Release early to cancel.'}</p>${known ? (page === 'spells' || page === 'cores' ? `<button class="btn tree-select" ${blocked || current ? 'disabled':''}>${current?'EQUIPPED': 'EQUIP ON '+n.key}</button>` : '<span class="tree-learned">✓ LEARNED · '+(t?'READY ON '+n.key:'ALWAYS ACTIVE')+'</span>') : `<button class="btn hold-learn" ${blocked || !ready || !enough ? 'disabled':''} aria-label="Hold to learn ${n.title} for ${SKILLS[n.skill].cost} coin"><span class="hold-fill"></span><span class="hold-copy">${!featureReady?'UPDATE REQUIRED':blocked?'CONFIRMING…':`HOLD TO LEARN · ${SKILLS[n.skill].cost} COIN`}</span></button>`}${n.ability?'<button class="btn ghost tree-preview">REPLAY ANIMATION</button>':''}<span class="hold-status" role="status"></span>`;
    const preview = () => this.previewNode(n);
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
