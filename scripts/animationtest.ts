import assert from "node:assert/strict";
import * as THREE from "three";
import { AnimatedModel } from "../src/render/assets.ts";
const scene = new THREE.Group(),
  mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  );
mesh.name = "blade";
scene.add(mesh);
const clip = new THREE.AnimationClip("attack", 1, [
  new THREE.NumberKeyframeTrack("blade.rotation[x]", [0, 1], [0, 1]),
]);
const model = new AnimatedModel({ scene, animations: [clip] } as any, 1, 0);
model.play("attack", 0.2);
model.update(0.25);
const blade = model.root.getObjectByName("blade")!;
assert.ok(blade.rotation.x > 0.95);
model.play("attack", 0.2, true);
model.update(0.05);
assert.ok(
  blade.rotation.x < 0.5,
  "back-to-back attack restarts instead of freezing on final pose",
);
model.update(0.2);
assert.ok(blade.rotation.x > 0.95);
model.dispose();
mesh.geometry.dispose();
mesh.material.dispose();
console.log(
  "Animation: PASS (back-to-back attack restarts at gameplay duration)",
);

// A shared renderer clock must preserve the referee's contact time and clear its pose.
const { motionClock, clipContact, combatPose, previewVolley } = await import('../src/render/combat-motion.ts');
const { WEAPON_IDS } = await import('../src/sim/weapons.ts');
const { TECHNIQUES, FAMILY_WEAPON } = await import('../src/sim/techniques.ts');
const { abilityClip, mountGrip, starterWeapon } = await import('../src/render/weapon-pose.ts');
for (const [id, spec] of Object.entries(TECHNIQUES)) {
  const identity = FAMILY_WEAPON[id.split('-')[0] as keyof typeof FAMILY_WEAPON];
  const action = { weapon:identity, ability:id as keyof typeof TECHNIQUES, elapsed:0, combo:1 };
  let previous=-1;
  for(let i=0;i<=100;i++) {const clock=motionClock({...action,elapsed:spec.duration*i/100});assert.ok(clock>=previous&&clock>=0&&clock<=1);previous=clock;}
  assert.ok(Math.abs(motionClock({...action,elapsed:spec.contact},abilityClip(action.ability,identity))-clipContact(abilityClip(action.ability,identity)))<1e-10,`${id} aligns release with contact`);
  assert.equal(motionClock({...action,elapsed:spec.duration}),1);
  assert.ok(abilityClip(action.ability,identity));
}
assert.equal(previewVolley('lance','starter')!.count,1);
assert.equal(previewVolley('lance','vesper-reed')!.count,3);
assert.equal(previewVolley('crossbow-2','gravewhisper')!.count,5);
assert.equal(previewVolley('staff-3','vesper-reed'),null);
assert.equal(new Set(WEAPON_IDS.filter(id=>id!=='cinder-requiem').map(id=>JSON.stringify(combatPose({weapon:id,combo:2,elapsed:.08})))).size,7);
const rig = new THREE.Group(), spine = new THREE.Bone(); spine.name='Spine'; rig.add(spine);
const rigClip = new THREE.AnimationClip('attack',1,[new THREE.QuaternionKeyframeTrack('Spine.quaternion',[0,1],[0,0,0,1,0,0,0,1])]);
const actor = new AnimatedModel({scene:rig,animations:[rigClip]} as any,1,0);
actor.play('attack',1);
actor.update(.1,{weapon:'tollkeeper',combo:3,elapsed:.12});
assert.ok(actor.bone('Spine')!.quaternion.angleTo(new THREE.Quaternion())>.01);
actor.update(0);
assert.ok(actor.bone('Spine')!.quaternion.angleTo(new THREE.Quaternion())<1e-7,'an additive accent never leaks into the next pose');
const hand = new THREE.Group(), grip = new THREE.Group(); hand.scale.setScalar(.012);
mountGrip(hand,grip);grip.add(starterWeapon());hand.updateMatrixWorld(true);
assert.ok(grip.getWorldScale(new THREE.Vector3()).distanceTo(new THREE.Vector3(1,1,1))<1e-7,'held prop keeps its world size on a normalized rig');
actor.dispose();
console.log('Combat presentation: PASS (28 contact clocks, family accents, pose reset, matching volley counts, shared hand scale)');
const aimRig=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(.5,2.2,.4),new THREE.MeshStandardMaterial());body.position.y=1.1;aimRig.add(body);
const upper=new THREE.Bone(),fore=new THREE.Bone(),handBone=new THREE.Bone();upper.name='RightArm';fore.name='RightForeArm';handBone.name='RightHand';upper.position.set(0,1.4,.1);fore.position.set(.35,0,0);handBone.position.set(.3,0,0);upper.add(fore);fore.add(handBone);aimRig.add(upper);
const leftHand=new THREE.Bone();leftHand.name='LeftHand';leftHand.position.set(.25,1.5,-.25);aimRig.add(leftHand);
const aiming=new AnimatedModel({scene:aimRig,animations:[new THREE.AnimationClip('cast',1,[new THREE.QuaternionKeyframeTrack('RightArm.quaternion',[0,1],[0,0,0,1,0,0,0,1])]),new THREE.AnimationClip('attack-hammer',1,[new THREE.QuaternionKeyframeTrack('RightArm.quaternion',[0,1],[0,0,0,1,0,0,0,1])])]} as any,2.2,0);
aiming.root.rotation.y=.8;aiming.play('cast',1);
for(const id of ['vesper-reed','gravewhisper'] as const) {
  const a=aiming.bone('RightArm')!,b=aiming.bone('RightForeArm')!,h=aiming.bone('RightHand')!;
  aiming.root.updateMatrixWorld(true);
  const before=a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()));
  aiming.update(.1,{weapon:id,ability:'lance',elapsed:.38,combo:1});
  const axis=new THREE.Vector3(id==='gravewhisper'?-1:0,0,id==='gravewhisper'?0:1).applyQuaternion(h.getWorldQuaternion(new THREE.Quaternion()));
  const target=new THREE.Vector3(1,.04,0).normalize().transformDirection(aiming.root.matrixWorld);
  assert.ok(axis.dot(target)>.999,'ranged hand follows the rotated actor firing direction');
  assert.ok(Math.abs(before-a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3())))<1e-7,'aim correction preserves arm length');
  aiming.update(0);
  assert.ok(h.quaternion.angleTo(new THREE.Quaternion())<1e-7,'hand correction resets after casting');
}
aiming.play('attack-hammer',.8,true);aiming.update(.1,{weapon:'tollkeeper',ability:'hammer-1',elapsed:.5,combo:1});
const palm=aiming.bone('RightHand')!,other=aiming.bone('LeftHand')!;
const shaft=new THREE.Vector3(0,0,1).applyQuaternion(palm.getWorldQuaternion(new THREE.Quaternion()));
const palms=other.getWorldPosition(new THREE.Vector3()).sub(palm.getWorldPosition(new THREE.Vector3())).normalize();
assert.ok(shaft.dot(palms)>.999,'a heavy weapon shaft crosses both palms');
// The same aimed actor must plant, gather and release without losing its weapon axis.
for(const id of ['staff-1','staff-2','staff-3','staff-4','ember','ash','iron'] as const) {
  const { abilityContact }=await import('../src/sim/abilities.ts');
  const { staffGesture }=await import('../src/render/combat-motion.ts');
  const elapsed=abilityContact(id),motion={weapon:'vesper-reed' as const,ability:id,elapsed,combo:1};
  aiming.play('cast',1,true);aiming.update(.1,motion);
  const direction=new THREE.Vector3(...staffGesture(motion).direction).normalize().transformDirection(aiming.root.matrixWorld);
  const shaft=new THREE.Vector3(0,0,1).applyQuaternion(aiming.bone('RightHand')!.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(shaft.dot(direction)>.999,`${id}: shaft follows its release gesture on a rotated actor`);
  const focus=aiming.root.getObjectByName('staff-charge')!;
  const tip=aiming.bone('RightHand')!.getWorldPosition(new THREE.Vector3()).addScaledVector(shaft,1.65);
  assert.ok(focus.getWorldPosition(new THREE.Vector3()).distanceTo(tip)<1e-6,`${id}: focus stays at the real staff crown`);
  aiming.update(0);assert.equal(focus.visible,false,'no lingering charge after interruption or weapon switch');
}
aiming.dispose();body.geometry.dispose();body.material.dispose();
console.log('Ranged hand posing: PASS (rotated actor, forward muzzle, unchanged limb lengths, clean recovery)');

const { abilityDuration, abilityContact } = await import('../src/sim/abilities.ts');
const { combatLift } = await import('../src/render/combat-motion.ts');
assert.ok(combatLift({weapon:'tollkeeper',ability:'hammer-4',elapsed:.32,combo:1})>.7);
assert.ok(combatLift({weapon:'tollkeeper',ability:'hammer-4',elapsed:.65,combo:1})<1e-8);
assert.equal(combatLift(),0);
for(const id of ['hammer-4','sword-4','staff-4','ember'] as const) {
  const duration=abilityDuration(id),contact=abilityContact(id),clip=abilityClip(id,'tollkeeper');
  let last=-1;
  for(let i=0;i<=100;i++) {const now=motionClock({weapon:'tollkeeper',ability:id,elapsed:duration*i/100,combo:1},clip);assert.ok(now>=last && now<=1);last=now;}
  assert.equal(motionClock({weapon:'tollkeeper',ability:id,elapsed:contact,combo:1},clip),clipContact(clip));
}
console.log('Signature motion: PASS (airborne reset, grounded contact, monotonic windup/impact/recovery)');

const { ritualPulse, ritualCharge, bloodThread }=await import('../src/render/signatures.ts');
for(const signature of [ritualCharge(0x88aaaa),bloodThread(0xaa6677),...(['furnace','harvest','orbit','covenant'] as const).map(kind=>ritualPulse(kind,4.5,0x889999))]) {
  for(let i=0;i<=100;i++) {
    signature.animate(i/100);signature.root.updateMatrixWorld(true);
    signature.root.traverse(n=>{
      assert.ok(n.matrixWorld.elements.every(Number.isFinite),'effect remains finite through its full lifetime');
      if(n instanceof THREE.Mesh){assert.equal(n.material.blending,THREE.NormalBlending);assert.ok(n.userData.fade>=0&&n.userData.fade<=1);}
    });
  }
  signature.root.traverse(n=>{if(n instanceof THREE.Mesh){n.geometry.dispose();n.material.dispose();}});
}
console.log('Spell presentation: PASS (staff release directions, attached focus, interruption reset, finite bounded fades, normal blending)');
