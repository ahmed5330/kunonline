// Preserve v21's existing key precedence and derivation for stored ciphertext.
export function withLegacySecretEncryption(env){
  if(env.TOKEN_ENC_KEY)return env;
  const inherited=Object.create(env);
  if(env.INTEGRATION_ENCRYPTION_KEY)inherited.TOKEN_ENC_KEY=`legacy-state:${env.INTEGRATION_ENCRYPTION_KEY}`;
  else if(env.SESSION_SECRET)inherited.TOKEN_ENC_KEY=`legacy-state:${env.SESSION_SECRET}`;
  else throw Object.assign(new Error('تعذر حفظ أسرار التكامل: مفتاح التشفير غير مهيأ.'),{status:503,code:'LEGACY_ENCRYPTION_KEY_MISSING'});
  return inherited;
}
