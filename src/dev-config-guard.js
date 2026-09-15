const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

export default {
  fetch(){
    return json({
      ok:false,
      code:'KUN_LOCAL_CONFIG_GUARD',
      message:'هذا Worker حارس أمان فقط. استخدم npm run dev للتطوير و npm run deploy:preview لنشر Preview. لا تستخدم wrangler deploy بدون --config.'
    },503);
  },
  scheduled(){
    return {ok:false,code:'KUN_LOCAL_CONFIG_GUARD'};
  }
};
