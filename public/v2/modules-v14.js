/* kun online v14 — contextual explanations */
(function(){
  const HELP={
    'الرئيسية':'ملخص سريع لأهم مؤشرات المتجر والتنبيهات التي تحتاج تدخلًا.',
    'الطلبات':'إدارة دورة حياة الطلب من الاستلام وحتى التسليم أو الإرجاع.',
    'العملاء CRM':'ملف موحد للعميل يشمل الطلبات والقيمة والتواصل والملاحظات.',
    'نقطة البيع POS':'للمبيعات المباشرة داخل الفرع مع خصم المخزون تلقائيًا.',
    'صندوق الرسائل':'يجمع محادثات القنوات المختلفة بعد ربطها بالحساب.',
    'المخزون':'يعرض الرصيد الحالي وحد إعادة الطلب وحركة المخزون.',
    'المشتريات':'أوامر الشراء والاستلام من الموردين وتحديث المخزون.',
    'حسابات الموردين':'فواتير الموردين والمدفوعات ومرتجعات المشتريات وحساب الرصيد المستحق.',
    'تسويات COD':'مطابقة المبالغ المتوقع تحصيلها مع التحصيل الفعلي من شركة الشحن.',
    'الحملات':'مقارنة أداء الحملات عبر المنصات باستخدام الإنفاق والإيراد وROAS وCTR.',
    'Profit Intelligence':'تحليل الربحية بعد تكلفة المنتج والشحن والخصومات والمصاريف.',
    'الأتمتة':'قواعد Trigger → Conditions → Actions لتنفيذ الأعمال المتكررة.',
    'kun AI':'اقتراحات وتحليلات الذكاء الاصطناعي. الإجراءات الحساسة تحتاج موافقة بشرية.',
    'مركز الموافقات':'قائمة الإجراءات الحساسة التي تنتظر موافقة مستخدم لديه الصلاحية.',
    'مركز التشغيل':'مراقبة طابور التنفيذ والأخطاء والإشعارات وصحة التكاملات.',
    'سجل النشاط':'سجل Audit يوضح من قام بأي تغيير ومتى وعلى أي كيان.',
    'الحساب والتكاملات':'إدارة الخطة والاستخدام والمتاجر المتصلة والدعم الفني.',
    'ROAS':'العائد على الإنفاق الإعلاني = الإيراد المنسوب للحملة ÷ الإنفاق الإعلاني.',
    'CTR':'نسبة النقر = عدد النقرات ÷ مرات الظهور × 100.',
    'COGS':'تكلفة البضاعة المباعة للطلبات ضمن الفترة المحددة.',
    'صافي الربح':'الإيراد بعد الخصومات والاستردادات والتكاليف والمصاريف التشغيلية.',
    'Queued jobs':'إجراءات تمت الموافقة عليها وتنتظر التنفيذ بواسطة محرك الأتمتة.',
    'Failed / Dead letter':'مهام فشلت. Dead letter يعني أنها استنفدت عدد محاولات الإعادة.'
  };
  const pop=document.createElement('div');pop.className='help-popover';pop.id='kunHelpPopover';pop.innerHTML='<button class="help-close" aria-label="إغلاق">×</button><strong></strong><div class="meta"></div>';document.body.appendChild(pop);
  const close=()=>pop.classList.remove('show');pop.querySelector('.help-close').onclick=close;document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  function show(btn,title,text){pop.querySelector('strong').textContent=title;pop.querySelector('.meta').textContent=text;const r=btn.getBoundingClientRect();pop.style.top=`${Math.min(innerHeight-180,r.bottom+8)}px`;pop.style.left=`${Math.max(12,Math.min(innerWidth-372,r.left))}px`;pop.classList.add('show');}
  function decorate(root=document){root.querySelectorAll('.title,.k-label,th').forEach(el=>{if(el.dataset.helpDecorated)return;const label=el.textContent.trim();const text=HELP[label];if(!text)return;el.dataset.helpDecorated='1';const b=document.createElement('button');b.type='button';b.className='help-dot';b.textContent='?';b.title=text;b.setAttribute('aria-label',`شرح ${label}`);b.onclick=e=>{e.stopPropagation();show(b,label,text)};el.appendChild(b);});}
  function openCenter(){const drawer=document.getElementById('drawer'),back=document.getElementById('drawerBack');if(!drawer)return;drawer.innerHTML=`<div class="page-head"><div><div class="title">مركز المساعدة</div><div class="sub">شرح مختصر لأهم أجزاء Kun Online.</div></div></div><div class="help-center-list">${Object.entries(HELP).map(([k,v])=>`<div class="help-center-item"><strong>${k}</strong><div class="meta">${v}</div></div>`).join('')}</div>`;drawer.classList.add('open');back?.classList.add('show');decorate(drawer);}
  function init(){decorate();const root=document.getElementById('root');if(root)new MutationObserver(()=>decorate(root)).observe(root,{childList:true,subtree:true});const helpBtn=document.querySelector('.top button[title="مركز المساعدة"]');if(helpBtn)helpBtn.onclick=openCenter;document.addEventListener('click',e=>{if(pop.classList.contains('show')&&!e.target.closest('#kunHelpPopover')&&!e.target.closest('.help-dot'))close();});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
