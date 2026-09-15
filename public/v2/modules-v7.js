/* kun online v7 — theme switcher + mobile navigation */
(function(){
  const THEMES=['light','gray','dark'];
  const labels={light:'فاتح',gray:'رمادي',dark:'داكن'};
  const icons={light:'☀',gray:'◐',dark:'☾'};
  const storageKey='kun-theme';

  function preferred(){
    const saved=localStorage.getItem(storageKey);
    if(THEMES.includes(saved))return saved;
    return window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  }
  function apply(theme){
    if(!THEMES.includes(theme))theme='light';
    document.body.dataset.theme=theme;
    document.documentElement.dataset.theme=theme;
    localStorage.setItem(storageKey,theme);
    document.querySelectorAll('[data-theme-choice]').forEach(b=>{
      const active=b.dataset.themeChoice===theme;
      b.classList.toggle('active',active);
      b.setAttribute('aria-pressed',active?'true':'false');
    });
  }
  function buildThemeSwitcher(){
    const top=document.querySelector('.top');
    if(!top||document.getElementById('themeSwitcher'))return;
    const wrap=document.createElement('div');
    wrap.id='themeSwitcher';wrap.className='theme-switcher';wrap.setAttribute('aria-label','اختيار مظهر النظام');
    THEMES.forEach(theme=>{
      const b=document.createElement('button');
      b.type='button';b.dataset.themeChoice=theme;b.title=`الوضع ${labels[theme]}`;b.setAttribute('aria-label',`الوضع ${labels[theme]}`);
      b.textContent=icons[theme];b.addEventListener('click',()=>apply(theme));wrap.appendChild(b);
    });
    const quick=document.getElementById('quickBtn');
    top.insertBefore(wrap,quick||null);
    apply(preferred());
  }
  function buildMobileNav(){
    const top=document.querySelector('.top'),side=document.querySelector('.side');
    if(!top||!side||document.getElementById('mobileMenuBtn'))return;
    const btn=document.createElement('button');
    btn.id='mobileMenuBtn';btn.className='btn soft mobile-menu';btn.type='button';btn.textContent='☰';btn.title='القائمة';btn.setAttribute('aria-label','فتح القائمة');
    top.prepend(btn);
    let overlay=document.getElementById('mobileNavBack');
    if(!overlay){overlay=document.createElement('div');overlay.id='mobileNavBack';overlay.className='drawer-back';document.body.appendChild(overlay);}
    const close=()=>{side.classList.remove('mobile-open');overlay.classList.remove('show');btn.setAttribute('aria-expanded','false')};
    const open=()=>{side.classList.add('mobile-open');overlay.classList.add('show');btn.setAttribute('aria-expanded','true')};
    btn.addEventListener('click',()=>side.classList.contains('mobile-open')?close():open());
    overlay.addEventListener('click',close);
    side.querySelectorAll('.nav button').forEach(x=>x.addEventListener('click',()=>{if(innerWidth<=820)close()}));
    window.addEventListener('resize',()=>{if(innerWidth>820)close()});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  }
  function init(){buildThemeSwitcher();buildMobileNav()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
