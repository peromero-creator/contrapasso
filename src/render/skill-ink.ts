import * as T from 'three';
import type { AbilityId } from '../sim/abilities';

/** Small shared ink masks. Each mark has a distinct family silhouette; no light or bloom. */
const masks = new Map<string,T.CanvasTexture>();
export function inkFamily(id: AbilityId): string {
  return id === 'ember' ? 'flame' : id === 'ash' ? 'orbit' : id === 'iron' ? 'ward' : id.startsWith('staff') || id.endsWith('spell') || id === 'lance' ? 'seal' : id.split('-')[0];
}
export function skillInk(id: AbilityId): T.CanvasTexture {
  const family=inkFamily(id); const old=masks.get(family);if(old)return old;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const c=canvas.getContext('2d')!;c.translate(128,128);c.strokeStyle='#fff';c.fillStyle='#fff';c.lineCap='round';
  const arc=(r:number,a:number,b:number,width:number)=>{c.lineWidth=width;c.beginPath();c.arc(0,0,r,a,b);c.stroke();};
  if(family==='hammer'||family==='axe') {
    for(let i=0;i<8;i++){c.save();c.rotate(i*Math.PI/4);c.lineWidth=i%2?3:6;c.beginPath();c.moveTo(12,0);c.lineTo(39,-8);c.lineTo(56,9);c.lineTo(85,4);c.lineTo(113,18);c.stroke();c.lineWidth=2;c.beginPath();c.moveTo(56,9);c.lineTo(67,35);c.stroke();c.restore();}
  } else if(family==='seal'||family==='ward') {
    arc(102,0,Math.PI*2,3);arc(86,0,Math.PI*2,2);
    for(let i=0;i<12;i++){c.save();c.rotate(i*Math.PI/6);c.lineWidth=3;c.beginPath();c.moveTo(86,0);c.lineTo(101,0);c.stroke();c.restore();}
    c.lineWidth=4;c.beginPath();for(let i=0;i<=6;i++){const a=i*Math.PI/3;c.lineTo(Math.cos(a)*66,Math.sin(a)*66);}c.stroke();
    if(family==='ward'){c.lineWidth=6;c.beginPath();c.moveTo(-30,-32);c.lineTo(30,-32);c.lineTo(24,20);c.lineTo(0,48);c.lineTo(-24,20);c.closePath();c.stroke();}
  } else if(family==='flame') {
    for(let i=0;i<9;i++){c.save();c.rotate(i*Math.PI*2/9);c.beginPath();c.moveTo(33,-6);c.bezierCurveTo(55,-28,70,12,111,-12);c.bezierCurveTo(83,25,52,19,33,6);c.fill();c.restore();}
  } else if(family==='orbit'||family==='dagger') {
    for(let i=0;i<3;i++){c.save();c.rotate(i*Math.PI*2/3);arc(78+i*8,-.8,.65,family==='dagger'?3:6);c.restore();}
  } else if(family==='spear'||family==='crossbow') {
    for(const y of [-15,0,15]){c.lineWidth=y?2:7;c.beginPath();c.moveTo(-108,y);c.lineTo(85,y);c.lineTo(65,y-9);c.moveTo(85,y);c.lineTo(65,y+9);c.stroke();}
  } else {arc(101,-1.25,1.25,6);arc(84,-1.05,1.1,3);arc(66,-.8,.9,2);}
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;masks.set(family,texture);return texture;
}
