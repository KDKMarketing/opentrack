import test from 'node:test';
import assert from 'node:assert/strict';
import {csv} from '../core.mjs';
import {today,day,metrics,intervalPosition} from '../public/dates.js';
test('workspace midnight in Jaipur',()=>assert.equal(today('Asia/Kolkata',new Date('2026-11-19T19:00Z')),'2026-11-20'));
test('on hold remains overdue, closed stops ageing',()=>{
 const m={status:'On Hold',deadline:'2026-11-19',updated:'2026-11-17',ended:null,owner_id:'me'};
 assert.equal(metrics(m,'2026-11-20','me','UTC').overdue,true);
 assert.equal(metrics({...m,ended:'2026-11-20',status:'Closed'},'2026-11-20','me','UTC').overdue,false);
});
test('timeline includes single day closures and reopened intervals',()=>{
 const start=day('2026-11-01');
 assert.deepEqual(intervalPosition({starts:'2026-11-01',ends:'2026-11-01'},start,'2026-11-20',10),{left:0,width:10});
 assert.deepEqual(intervalPosition({starts:'2026-11-15'},start,'2026-11-20',10),{left:140,width:60});
});
test('CSV quotes multiline titles, escapes quotes and neutralizes formulas',()=>{const value=csv([{title:' =SUM(1)',description:'A,"B"\nC'}]);assert.ok(value.includes('"\' =SUM(1)"'));assert.ok(value.includes('"A,""B""\nC"'));});
