import { availableSpell } from '../sim/abilities.ts';
import { rank } from '../sim/skills.ts';
import { weaponTechniques } from '../sim/techniques.ts';
import { DT, type Player, type Input } from '../sim/world.ts';

type SkillPress = 'cast' | 'ultimate' | number;
const BUFFER_TICKS = 14; // 233 ms, measured in simulation time, including hit-stop.
/** One deliberate next action, never a backlog of skills or repeated casts. */
export class SkillInputBuffer {
  private pending: SkillPress | null = null;
  private ticks = 0;
  press(action: SkillPress) { this.pending=action; this.ticks=BUFFER_TICKS; }
  clear() { this.pending=null;this.ticks=0; }
  take(p: Player, dash: boolean): Pick<Input, 'cast' | 'ultimate' | 'technique'> {
    const action=this.pending;
    if (dash) this.clear();
    if (this.pending===null || action===null) return {};
    let ready=false, valid=false;
    if (action==='cast') { valid=availableSpell(p.spell,p.skills);ready=p.spellCd<=DT; }
    else if (action==='ultimate') { valid=!!p.core && p.charge>=100;ready=valid; }
    else if (Number.isInteger(action) && action>=1 && action<=4) {
      valid=rank(p.skills,weaponTechniques(p.weaponId)[action-1])>0;
      ready=p.techniqueCd[action-1]<=DT;
    }
    if (!valid) { this.clear();return {}; }
    if (ready && p.swingT<=DT && p.castT<=DT && p.dashT<=0 && p.jumpT<=0) {
      this.clear();
      return typeof action==='number'?{technique:action}:action==='cast'?{cast:true}:{ultimate:true};
    }
    if (--this.ticks<=0) this.clear();
    return {};
  }
}
