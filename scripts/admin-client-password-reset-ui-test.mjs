import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('../public/v2/modules-v23-admin.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const overviewCalls=[],passwordCalls=[],messages=[];
let anchor={page:'client-one'},open=true;
const cards=[];
class Input{
  constructor(id){this.id=id;this.value='';this.type=id==='v23ResetPassword'?'password':'text';this.textContent='';this.style={};this.attributes={};this.disabled=false;this.dataset={};this.isConnected=true}
  setAttribute(k,v){this.attributes[k]=v}
  removeAttribute(k){delete this.attributes[k]}
  focus(){}
  blur(){}
}
const drawer={
  classList:{contains:k=>k==='open'&&open},
  get firstElementChild(){return anchor},
  querySelector(selector){return selector==='#v23ClientAdminActions'?cards[0]||null:null},
  appendChild(card){cards.push(card)}
};
const document={
  getElementById:id=>id==='drawer'?drawer:id==='kunAdminClientCommandV74Loader'?{}:null,
  querySelector:()=>null,
  addEventListener(){},
  createElement(){
    const nodes=new Map();
    const card=new Input('v23ClientAdminActions');
    card.querySelector=selector=>{
      const id=selector.slice(1);
      if(!nodes.has(id))nodes.set(id,new Input(id));
      return nodes.get(id);
    };
    return card;
  },
  body:{}
};
const K={
  esc:s=>String(s??''),
  notify:s=>messages.push(String(s)),
  field:(label,id)=>`<label>${label}<input id="${id}"></label>`,
  randomPassword:()=> 'Kun!ValidPassword2026',
  api:(path,options={})=>{
    if(path.endsWith('/overview')){const p=deferred();overviewCalls.push({path,p});return p.promise}
    if(path.endsWith('/reset-owner-password')){const p=deferred();passwordCalls.push({path,options,p});return p.promise}
    return Promise.resolve({ok:true});
  },
  close(){}
};
const ctx={window:{KunActionsV23:K},document,MutationObserver:class {observe(){}},setTimeout:()=>0,clearTimeout:()=>{},console};
runInNewContext(script,ctx,{filename:'modules-v23-admin.js'});

const a=K.enhanceClientDrawer('CLIENT_ONE');
const b=K.enhanceClientDrawer('CLIENT_ONE');
const c=K.enhanceClientDrawer('CLIENT_ONE');
assert.equal(overviewCalls.length,1,'only one overview request is issued for simultaneous enhances');
overviewCalls[0].p.resolve({ownerName:'Demo',ownerEmail:'owner@example.com',status:'active',wallet:{baseOrderFee:2}});
await Promise.all([a,b,c]);
assert.equal(cards.length,1,'only one account management card is rendered');
await K.enhanceClientDrawer('CLIENT_ONE');
assert.equal(cards.length,1,'repeated enhance does not append a second card');
const card=cards[0];
assert.match(card.innerHTML,/id="v23ResetPassword" type="password"/,'password defaults to masked');
assert.equal(card.dataset.clientId,'CLIENT_ONE');
const reset=card.querySelector('#v23ResetOwner'),input=card.querySelector('#v23ResetPassword');
const status=card.querySelector('#v23PasswordStatus');
input.value='short';
await reset.onclick({preventDefault(){}});
assert.equal(passwordCalls.length,0,'short password never reaches API');
assert.match(status.textContent,/8/);
input.value='LongSecret#2026';
const req1=reset.onclick({preventDefault(){}});
const req2=reset.onclick({preventDefault(){}});
assert.equal(passwordCalls.length,1,'rapid double clicks send one reset');
assert.equal(reset.disabled,true);
assert.equal(passwordCalls[0].path,'/api/admin/clients/CLIENT_ONE/reset-owner-password');
assert.equal(JSON.parse(passwordCalls[0].options.body).password,'LongSecret#2026');
passwordCalls[0].p.resolve({ok:true,email:'owner@example.com'});
await Promise.all([req1,req2]);
assert.equal(reset.disabled,false);
assert.match(status.textContent,/نجاح/);
assert.equal(input.value,'','password field clears after success');
const copy=card.querySelector('#v23ToggleResetVisibility');
copy.onclick();
assert.equal(input.type,'text');
copy.onclick();
assert.equal(input.type,'password');

// A stale response must never append controls for the previously selected client.
cards.length=0;
anchor={page:'stale'};
const stale=K.enhanceClientDrawer('STALE');
anchor={page:'new'};
const fresh=K.enhanceClientDrawer('FRESH');
assert.equal(overviewCalls.length,3);
overviewCalls[1].p.resolve({ownerName:'Old'});
await stale;
assert.equal(cards.length,0,'stale overview does not render');
overviewCalls[2].p.resolve({ownerName:'New'});
await fresh;
assert.equal(cards.length,1);
assert.equal(cards[0].dataset.clientId,'FRESH');

// Server errors are visible and never presented as successful password changes.
input.value='Unused';
const newest=cards[0];
const freshInput=newest.querySelector('#v23ResetPassword');
const freshButton=newest.querySelector('#v23ResetOwner');
freshInput.value='AnotherValid#2026';
const failed=freshButton.onclick({preventDefault(){}});
passwordCalls[1].p.reject(new Error('Unable to save password'));
await failed;
assert.match(newest.querySelector('#v23PasswordStatus').textContent,/Unable to save password/);
assert.equal(freshButton.disabled,false);
console.log('Admin client owner password UI: concurrency, reset, errors, and stale drawers OK');
