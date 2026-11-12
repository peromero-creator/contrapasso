import { FAMILIES, FAMILY_NAMES, FAMILY_WEAPON, TECHNIQUES, techniqueId, techniqueParents, familyOf, type Family, type TechniqueId } from '../sim/techniques';
import { CORE_IDS, CORES, SPELL_IDS, SPELLS, spellId, type AbilityId, type SpellId, type CoreId } from '../sim/abilities';
import { SKILLS, SKILL_BRANCHES, PREREQUISITES, canLearn, type SkillId } from '../sim/skills';
import type { Champion } from '../shared/protocol';
import { skillIcon } from './icons';
import type { WeaponId } from '../sim/weapons';

type Page = Family | 'spells' | 'cores' | 'vows';
type Node = { skill: SkillId; title: string; x: number; y: number; key: string; ability?: AbilityId; parents: SkillId[] };
export interface TreeActions {
  learn(id: SkillId): Promise<void>;
  spell(id: SpellId): Promise<void>;
  core(id: CoreId): Promise<void>;
  preview(id: AbilityId, weapon?: WeaponId): void;
}
const HOLD_MS = 1100;
export class SkillTree {
  private page: Page = 'sword';
  private selected: SkillId | null = null;
  private champion!: Champion;
  private busy = false;
  private cancelHold = () => {};
  private initialized = false;
  constructor(private root: HTMLElement, private actions: TreeActions) {}
  render(champion: Champion, busy: boolean) {
    this.cancelHold();
    this.champion = champion; this.busy = busy;
    if (!this.initialized) { this.page = familyOf(champion.build.weaponId ?? 'starter'); this.initialized = true; }
    const nodes = this.nodes();
    if (!nodes.some(n => n.skill === this.selected)) this.selected = nodes[0].skill;
    const title = this.page === 'spells' ? 'The spell you carry' : this.page === 'cores' ? 'The heart of your build' : this.page === 'vows' ? 'Roots of the soul' : FAMILY_NAMES[this.page];
    this.root.innerHTML = `<nav class="tree-tabs" aria-label="Skill categories">${FAMILIES.map(f => `<button data-page="${f}" aria-pressed="${f === this.page}">${FAMILY_NAMES[f]}${familyOf(champion.build.weaponId ?? 'starter') === f ? '<i>Equipped</i>' : ''}</button>`).join('')}<button data-page="spells" aria-pressed="${this.page === 'spells'}">Q · Spells</button><button data-page="cores" aria-pressed="${this.page === 'cores'}">R · Ultimates</button><button data-page="vows" aria-pressed="${this.page === 'vows'}">Soul vows</button></nav>
      <div class="tree-heading"><div><span class="eyebrow">THE LIVING ARSENAL</span><h3>${title}</h3></div><p>${this.page === 'vows' ? 'Permanent foundations shared by every weapon.' : this.page === 'cores' ? 'Choose one ultimate. Damage fills its charge.' : this.page === 'spells' ? 'Choose one learned spell for Q.' : 'One weapon. Four techniques. A path carved with earned coin.'}</p></div>
      <div class="tree-workspace"><div class="tree-map" aria-label="${title} skill tree"><svg class="tree-links" viewBox="0 0 1000 460" preserveAspectRatio="none" aria-hidden="true"><path class="tree-trunk" d="M500 460 Q500 420 500 380 M500 450 Q410 425 390 455 M500 440 Q570 420 620 455"/>${nodes.map(n => n.parents.map(p => { const parent = nodes.find(v => v.skill === p); if (!parent) return ''; const x = parent.x * 10, y = parent.y * 4.6 - 18, nx = n.x * 10, ny = n.y * 4.6 - 18; return `<path class="${champion.skills.includes(n.skill) ? 'grown' : champion.skills.includes(p) ? 'growing' : ''}" d="M${x} ${y} C${x} ${(y+ny)/2} ${nx} ${(y+ny)/2} ${nx} ${ny}"/>`; }).join('')).join('')}</svg>${nodes.map(n => `<button class="tree-node ${champion.skills.includes(n.skill) ? 'learned' : canLearn(champion.skills,n.skill) ? 'reachable' : 'sealed'}" data-node="${n.skill}" style="left:${n.x}%;top:${n.y}%" aria-label="${n.title}${champion.skills.includes(n.skill) ? ', learned' : ', '+SKILLS[n.skill].cost+' coin'}" aria-pressed="${this.selected === n.skill}"><span class="node-orb">${skillIcon(n.skill)}<em>${n.key}</em></span><strong>${n.title}</strong><small>${champion.skills.includes(n.skill) ? 'LEARNED' : SKILLS[n.skill].cost+' COIN'}</small></button>`).join('')}<span class="tree-root-label">${this.page === 'vows' ? 'YOUR SOUL' : this.page === 'cores' || this.page === 'spells' ? 'CHOOSE YOUR EXPRESSION' : 'WEAPON MASTERY'}</span></div><aside id="tree-detail" class="tree-detail" aria-live="polite"></aside></div>`;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-page]')) b.onclick = () => { this.page = b.dataset.page as Page; this.selected = null; this.render(this.champion,this.busy); };
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-node]')) b.onclick = () => { this.cancelHold(); this.selected = b.dataset.node as SkillId; for (const el of this.root.querySelectorAll('[data-node]')) el.setAttribute('aria-pressed', String(el === b)); this.detail(nodes.find(n => n.skill === this.selected)!); };
    this.detail(nodes.find(n => n.skill === this.selected)!);
  }
  close() { this.cancelHold(); }
  private nodes(): Node[] {
    if (FAMILIES.includes(this.page as Family)) return [1,2,3,4].map((n,i) => { const skill = `${this.page}-${n}` as TechniqueId; return { skill, title: TECHNIQUES[skill].name, x: [50,25,75,50][i], y: [78,47,47,16][i], key: String(n), ability: skill, parents: techniqueParents(skill) }; });
    if (this.page === 'spells') return SPELL_IDS.map((id,i) => ({ skill: SPELLS[id].skill, title: SPELLS[id].name, x: 20+i*30, y: i===1 ? 27 : 57, key: 'Q', ability:id, parents:[] }));
    if (this.page === 'cores') return CORE_IDS.map((id,i) => ({ skill:id, title:CORES[id].name, x:20+i*30,y:i===1?27:57,key:'R',ability:id,parents:[] }));
    return SKILL_BRANCHES.flatMap((b,i) => b.skills.map((skill,j) => ({ skill, title:SKILLS[skill].name,x:18+i*32,y:81-j*22,key:String(j+1),parents:PREREQUISITES[skill]?[PREREQUISITES[skill]!]:[] })));
  }
  private detail(n: Node) {
    const c = this.champion, known = c.skills.includes(n.skill), ready = canLearn(c.skills,n.skill), enough = c.coins >= SKILLS[n.skill].cost;
    const t = techniqueId(n.skill), spec = t ? TECHNIQUES[t] : null;
    const parents = t ? techniqueParents(t) : PREREQUISITES[n.skill] ? [PREREQUISITES[n.skill]!] : [];
    const current = this.page === 'cores' ? c.build.core === n.ability : this.page === 'spells' ? spellId(c.build.spell) === n.ability : false;
    const featureReady = !c.chain || c.chain.features?.includes('weapon_skills') || (!t && !n.skill.endsWith('-spell'));
    const blocked = this.busy || !!c.chain?.pending || !featureReady;
    const description = this.page === 'cores' ? CORES[n.ability as CoreId].description : this.page === 'spells' ? SPELLS[n.ability as SpellId].description : SKILLS[n.skill].description;
    const detail = this.root.querySelector<HTMLElement>('#tree-detail')!;
    detail.innerHTML = `<span class="eyebrow">${this.page === 'cores' ? 'ULTIMATE · R' : this.page === 'spells' ? 'SPELL · Q' : t ? 'WEAPON TECHNIQUE · '+n.key : 'PASSIVE VOW'}</span><h3>${n.title}</h3><p>${description}</p>${spec ? `<div class="technique-stats"><span><b>${spec.damage}</b>base damage / hit</span><span><b>${spec.cooldown}s</b>cooldown</span><span><b>${spec.pulses ?? 1}</b>contact${(spec.pulses ?? 1)>1?'s':''}</span></div><small>+2 damage per weapon level. +15% technique damage per circle rank. Active with ${FAMILY_NAMES[this.page as Family].toLowerCase()} in hand.</small>` : `<small>${SKILLS[n.skill].rank}</small>`}<p class="tree-requirement">${known ? 'Learned permanently. No additional NFT or mint required.' : !ready ? 'First learn: '+parents.filter(p=>!c.skills.includes(p)).map(p=>SKILLS[p].name).join(' + ') : !enough ? `You have ${c.coins} coin. Earn ${SKILLS[n.skill].cost-c.coins} more in Solo.` : 'Hold to learn. Release early to cancel.'}</p>${known ? (this.page === 'spells' || this.page === 'cores' ? `<button class="btn tree-select" ${blocked || current ? 'disabled':''}>${current?'EQUIPPED': 'EQUIP ON '+n.key}</button>` : '<span class="tree-learned">✓ LEARNED · '+(t?'READY ON '+n.key:'ALWAYS ACTIVE')+'</span>') : `<button class="btn hold-learn" ${blocked || !ready || !enough ? 'disabled':''} aria-label="Hold to learn ${n.title} for ${SKILLS[n.skill].cost} coin"><span class="hold-fill"></span><span class="hold-copy">${!featureReady?'UPDATE REQUIRED':blocked?'CONFIRMING…':`HOLD TO LEARN · ${SKILLS[n.skill].cost} COIN`}</span></button>`}${n.ability?'<button class="btn ghost tree-preview">WATCH ANIMATION ↗</button>':''}<span class="hold-status" role="status"></span>`;
    const preview = () => { if (n.ability) this.actions.preview(n.ability,FAMILIES.includes(this.page as Family)?FAMILY_WEAPON[this.page as Family]:undefined); };
    detail.querySelector<HTMLButtonElement>('.tree-preview')?.addEventListener('click',preview);
    detail.querySelector<HTMLButtonElement>('.tree-select')?.addEventListener('click',()=>{ void (this.page === 'spells' ? this.actions.spell(n.ability as SpellId) : this.actions.core(n.ability as CoreId)); });
    const button = detail.querySelector<HTMLButtonElement>('.hold-learn');
    if (!button || button.disabled) return;
    let frame=0, start=0, active=false, finished=false;
    const reset=()=>{ cancelAnimationFrame(frame); active=false; (this.root.querySelector(`[data-node="${n.skill}"]`) as HTMLElement | null)?.style.setProperty("--learn", "0%"); button.style.setProperty('--learn','0%'); this.root.querySelector(`[data-node="${n.skill}"]`)?.classList.remove('learning'); };
    const cancel=()=>{ if (!finished) reset(); };
    const onBlur=()=>cancel(), onVisibility=()=>{ if(document.hidden) cancel(); };
    window.addEventListener('blur',onBlur); document.addEventListener('visibilitychange',onVisibility);
    this.cancelHold=()=>{cancel(); window.removeEventListener('blur',onBlur); document.removeEventListener('visibilitychange',onVisibility);};
    const tick=(now:number)=>{ if(!active) return; const fraction=Math.min(1,(now-start)/HOLD_MS); button.style.setProperty('--learn',`${fraction*100}%`); (this.root.querySelector(`[data-node="${n.skill}"]`) as HTMLElement | null)?.style.setProperty("--learn",`${fraction*100}%`); if(fraction<1) {frame=requestAnimationFrame(tick);return;} finished=true;active=false;button.disabled=true; detail.querySelector('.hold-copy')!.textContent='CONFIRMING…'; detail.querySelector('.hold-status')!.textContent='Saving your learned skill…'; void this.actions.learn(n.skill); };
    const begin=()=>{ if(active || finished || button.disabled)return; active=true;start=performance.now();this.root.querySelector(`[data-node="${n.skill}"]`)?.classList.add('learning'); frame=requestAnimationFrame(tick); };
    button.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();button.focus();button.setPointerCapture(e.pointerId);begin();};
    button.onpointerup=cancel;button.onpointercancel=cancel;button.onlostpointercapture=cancel;
    button.onkeydown=e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();if(!e.repeat)begin();}};
    button.onkeyup=e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();cancel();}};
    button.onblur=cancel;button.oncontextmenu=e=>e.preventDefault();
  }
}
