import assert from 'node:assert/strict';
import worker from '../src/index.js';

// The fake DB allows the setup count only. Invalid credentials must not touch
// authentication tables, increment rate limits, hash passwords or mutate users.
let countReads=0,unexpectedQueries=0;
const env={
  SESSION_SECRET:'qa-only-invalid-login-secret',
  DB:{prepare(sql){
    if(sql==='SELECT COUNT(*) AS n FROM users'){
      return {async first(){countReads++;return {n:0};}};
    }
    unexpectedQueries++;
    throw new Error('Unexpected DB access for malformed credentials: '+sql);
  }}
};
const invalidCases=[
  ['JSON null','null'],
  ['array','[]'],
  ['number','123'],
  ['boolean','true'],
  ['JSON string','"not credentials"'],
  ['object missing fields','{}'],
  ['email object with unsafe toString','{"email":{"toString":null},"password":"pass12345"}'],
  ['nested email array','{"email":["one@test.invalid"],"password":"pass12345"}'],
  ['password object','{"email":"user@test.invalid","password":{"value":"pass12345"}}'],
  ['password null','{"email":"user@test.invalid","password":null}'],
  ['empty email','{"email":"","password":"pass12345"}'],
  ['empty password','{"email":"user@test.invalid","password":""}'],
  ['oversized email',JSON.stringify({email:'x'.repeat(255)+'@test.invalid',password:'pass12345'})],
  ['oversized password',JSON.stringify({email:'user@test.invalid',password:'x'.repeat(4097)})],
  ['malformed JSON','{invalid']
];
for(const endpoint of ['/api/login','/api/setup']){
  for(const [label,payload] of invalidCases){
    const request=new Request('https://qa.example.test'+endpoint,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:payload
    });
    const response=await worker.fetch(request,env);
    assert.equal(response.status,400,endpoint+' should reject '+label+' as bad client input, not server failure');
    const data=await response.json();
    assert.ok(data.error,endpoint+' should return an actionable validation message');
    assert.equal(response.headers.get('Set-Cookie'),null,'invalid inputs must not issue sessions');
  }
}
assert.equal(unexpectedQueries,0,'malformed credentials must not query users/login_attempts or write data');
assert.equal(countReads,invalidCases.length,'setup may check whether an admin exists');
console.log('AUTH-03 isolated login/setup validation PASS: '+(invalidCases.length*2)+' malformed JSON cases return 400 without login side effects.');
