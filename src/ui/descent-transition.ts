/** A presentation curtain; never changes inputs or rewards. */
export class DescentTransition {
  private node = document.createElement('div');
  private timer = 0;
  constructor() { this.node.id='descent-curtain';this.node.setAttribute('aria-hidden','true');document.body.append(this.node); }
  play(label:string, returning=false) {
    clearTimeout(this.timer);this.node.textContent=label;
    this.node.className='';void this.node.offsetWidth;
    this.node.className=returning?'returning':'descending';
    const duration=document.documentElement.classList.contains('calm')?0:720;
    this.timer=window.setTimeout(()=>this.node.className='',duration);
    return duration/1000;
  }
}
